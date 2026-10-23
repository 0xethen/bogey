import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { myTeamQueryOptions } from "@bogey/db/queries/teams";
import {
  answerTeamRequestFn,
  inviteToTeamFn,
  requestToJoinTeamFn,
  saveTeamOpeningFn,
  saveTeamSeekerFn,
  teamBoardOpeningsQueryOptions,
  teamBoardPeopleQueryOptions,
  teamRequestsQueryOptions,
  withdrawTeamRequestFn,
  type SeekerCard,
  type TeamOpening,
  type TeamRequest,
} from "@bogey/db/queries/team-board";
import { joinLabels, parseLabels } from "@bogey/utils/team-matcher";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { useT, type T } from "#/lib/translate.tsx";

function failure(error: unknown): Error | null {
  return error instanceof Error ? error : null;
}

function useBoardRefresh(eventId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["team-board", eventId] }),
      queryClient.invalidateQueries({ queryKey: myTeamQueryOptions(eventId).queryKey }),
    ]);
}

function Labels({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} variant="outline">
          {label}
        </Badge>
      ))}
    </span>
  );
}

export function TeamBoard({
  eventId,
  team,
}: {
  eventId: string;
  team: { full: boolean; editable: boolean } | null;
}) {
  const requests = useQuery(teamRequestsQueryOptions(eventId));
  const recruiting = team !== null && team.editable && !team.full;
  return (
    <>
      <Requests eventId={eventId} rows={requests.data ?? []} />
      {team === null && <FindATeam eventId={eventId} />}
      {recruiting && <FindTeammates eventId={eventId} />}
    </>
  );
}

function Requests({ eventId, rows }: { eventId: string; rows: readonly TeamRequest[] }) {
  const t = useT();
  const refresh = useBoardRefresh(eventId);
  const answer = useMutation({
    mutationFn: async (input: { requestId: string; accept: boolean }) =>
      unwrap(await answerTeamRequestFn({ data: input })),
    onSettled: refresh,
  });
  const withdraw = useMutation({
    mutationFn: async (requestId: string) =>
      unwrap(await withdrawTeamRequestFn({ data: requestId })),
    onSettled: refresh,
  });
  if (rows.length === 0) return null;
  return (
    <Screen.Section id="requests" title={t("teamBoard.requests")}>
      <ErrorAlert error={answer.error ?? withdraw.error} title={t("teamBoard.answerFailed")} />
      <RowList>
        {rows.map((row) => (
          <DisclosureRow
            key={row.id}
            title={
              row.direction === "request"
                ? t("teamBoard.asked", { person: row.user_name, team: row.team_name })
                : t("teamBoard.invited", { person: row.user_name, team: row.team_name })
            }
            meta={row.message || undefined}
            actions={
              row.status !== "pending" ? (
                <Badge variant="secondary">{statusLabel(t, row.status)}</Badge>
              ) : row.decide ? (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ requestId: row.id, accept: true })}
                  >
                    {t("teamBoard.accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ requestId: row.id, accept: false })}
                  >
                    {t("teamBoard.decline")}
                  </Button>
                </span>
              ) : row.sent ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={withdraw.isPending}
                  onClick={() => withdraw.mutate(row.id)}
                >
                  {t("teamBoard.withdraw")}
                </Button>
              ) : (
                <Badge variant="outline">{t("teamBoard.waiting")}</Badge>
              )
            }
          />
        ))}
      </RowList>
    </Screen.Section>
  );
}

function statusLabel(t: T, status: TeamRequest["status"]): string {
  switch (status) {
    case "accepted":
      return t("teamBoard.accepted");
    case "declined":
      return t("teamBoard.declined");
    case "withdrawn":
      return t("teamBoard.withdrawn");
    case "pending":
      return t("teamBoard.waiting");
  }
}

const seekerSchema = (t: T) =>
  z.object({
    skills: z
      .string()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("teamBoard.skills"), placeholder: t("teamBoard.skillsPlaceholder") })
      .describe(t("teamBoard.labelsHelp")),
    interests: z
      .string()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("teamBoard.interests"), placeholder: t("teamBoard.interestsPlaceholder") }),
    timezone: z
      .string()
      .trim()
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("teamBoard.timezone"), placeholder: "America/New_York" }),
    blurb: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("teamBoard.blurb"), placeholder: t("teamBoard.blurbPlaceholder") }),
    looking: z
      .boolean()
      .meta({ label: t("teamBoard.looking") })
      .describe(t("teamBoard.lookingHelp")),
  });

function SeekerForm({ eventId, card }: { eventId: string; card: SeekerCard | undefined }) {
  const t = useT();
  const schema = useMemo(() => seekerSchema(t), [t]);
  const refresh = useBoardRefresh(eventId);
  const form = useAppForm({
    defaultValues: {
      skills: joinLabels(card?.skills ?? []),
      interests: joinLabels(card?.interests ?? []),
      timezone: card?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      blurb: card?.blurb ?? "",
      looking: card?.looking ?? true,
    },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await saveTeamSeekerFn({
        data: {
          eventId,
          skills: parseLabels(value.skills),
          interests: parseLabels(value.interests),
          timezone: value.timezone,
          blurb: value.blurb,
          looking: value.looking,
        },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await refresh();
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-4">
        <form.Field name="skills">{(field) => <field.TextField />}</form.Field>
        <form.Field name="interests">{(field) => <field.TextField />}</form.Field>
        <form.Field name="timezone">{(field) => <field.TextField />}</form.Field>
        <form.Field name="blurb">{(field) => <field.TextAreaField rows={2} />}</form.Field>
        <form.Field name="looking">{(field) => <field.SwitchField />}</form.Field>
        <form.FormAlert title={t("teamBoard.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function FindATeam({ eventId }: { eventId: string }) {
  const t = useT();
  const refresh = useBoardRefresh(eventId);
  const people = useQuery(teamBoardPeopleQueryOptions(eventId));
  const openings = useQuery(teamBoardOpeningsQueryOptions(eventId));
  const ask = useMutation({
    mutationFn: async (teamId: string) =>
      unwrap(await requestToJoinTeamFn({ data: { eventId, teamId, message: "" } })),
    onSettled: refresh,
  });
  const card = people.data?.find((row) => row.mine);
  const teams = openings.data?.filter((row) => !row.mine) ?? [];
  return (
    <>
      <Screen.Section
        id="your-card"
        title={t("teamBoard.cardTitle")}
        description={t("teamBoard.cardHelp")}
      >
        <ErrorAlert error={failure(people.error)} title={t("teamBoard.loadFailed")} />
        {people.data && <SeekerForm key={card?.user_id ?? "new"} eventId={eventId} card={card} />}
      </Screen.Section>
      <Screen.Section id="teams-looking" title={t("teamBoard.teamsTitle")}>
        <ErrorAlert error={failure(openings.error) ?? ask.error} title={t("teamBoard.askFailed")} />
        {openings.data && teams.length === 0 && (
          <p className="text-sm text-muted-fg">{t("teamBoard.noTeams")}</p>
        )}
        {teams.length > 0 && (
          <RowList>
            {teams.map((row: TeamOpening) => (
              <DisclosureRow
                key={row.team_id}
                title={row.team_name}
                meta={t("roster.of", { count: row.members, capacity: row.max_members })}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={row.requested || ask.isPending}
                    onClick={() => ask.mutate(row.team_id)}
                  >
                    {row.requested ? t("teamBoard.askedButton") : t("teamBoard.ask")}
                  </Button>
                }
              >
                <div className="flex flex-col gap-2 text-sm">
                  {row.blurb && <p>{row.blurb}</p>}
                  <Labels labels={row.wanted} />
                </div>
              </DisclosureRow>
            ))}
          </RowList>
        )}
      </Screen.Section>
    </>
  );
}

const openingSchema = (t: T) =>
  z.object({
    blurb: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("teamBoard.building"), placeholder: t("teamBoard.buildingPlaceholder") }),
    wanted: z
      .string()
      .max(1000, t("form.maxLength", { max: 1000 }))
      .meta({ label: t("teamBoard.wanted"), placeholder: t("teamBoard.wantedPlaceholder") })
      .describe(t("teamBoard.labelsHelp")),
    open: z
      .boolean()
      .meta({ label: t("teamBoard.open") })
      .describe(t("teamBoard.openHelp")),
  });

function OpeningForm({ eventId, post }: { eventId: string; post: TeamOpening | undefined }) {
  const t = useT();
  const schema = useMemo(() => openingSchema(t), [t]);
  const refresh = useBoardRefresh(eventId);
  const form = useAppForm({
    defaultValues: {
      blurb: post?.blurb ?? "",
      wanted: joinLabels(post?.wanted ?? []),
      open: post?.open ?? false,
    },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await saveTeamOpeningFn({
        data: { eventId, blurb: value.blurb, wanted: parseLabels(value.wanted), open: value.open },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await refresh();
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-4">
        <form.Field name="open">{(field) => <field.SwitchField />}</form.Field>
        <form.Field name="blurb">{(field) => <field.TextAreaField rows={2} />}</form.Field>
        <form.Field name="wanted">{(field) => <field.TextField />}</form.Field>
        <form.FormAlert title={t("teamBoard.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function FindTeammates({ eventId }: { eventId: string }) {
  const t = useT();
  const refresh = useBoardRefresh(eventId);
  const people = useQuery(teamBoardPeopleQueryOptions(eventId));
  const openings = useQuery(teamBoardOpeningsQueryOptions(eventId));
  const invite = useMutation({
    mutationFn: async (userId: string) =>
      unwrap(await inviteToTeamFn({ data: { eventId, userId, message: "" } })),
    onSettled: refresh,
  });
  const post = openings.data?.find((row) => row.mine);
  const others = people.data?.filter((row) => !row.mine) ?? [];
  return (
    <>
      <Screen.Section
        id="team-post"
        title={t("teamBoard.postTitle")}
        description={t("teamBoard.postHelp")}
      >
        {openings.data && (
          <OpeningForm key={post?.team_id ?? "new"} eventId={eventId} post={post} />
        )}
      </Screen.Section>
      <Screen.Section id="people-looking" title={t("teamBoard.peopleTitle")}>
        <ErrorAlert
          error={failure(people.error) ?? invite.error}
          title={t("teamBoard.inviteFailed")}
        />
        {people.data && others.length === 0 && (
          <p className="text-sm text-muted-fg">{t("teamBoard.noPeople")}</p>
        )}
        {others.length > 0 && (
          <RowList>
            {others.map((row) => (
              <DisclosureRow
                key={row.user_id}
                title={row.display_name}
                meta={row.timezone || undefined}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={invite.isPending}
                    onClick={() => invite.mutate(row.user_id)}
                  >
                    {t("teamBoard.invite")}
                  </Button>
                }
              >
                <div className="flex flex-col gap-2 text-sm">
                  {row.blurb && <p>{row.blurb}</p>}
                  <Labels labels={row.skills} />
                  <Labels labels={row.interests} />
                </div>
              </DisclosureRow>
            ))}
          </RowList>
        )}
      </Screen.Section>
    </>
  );
}
