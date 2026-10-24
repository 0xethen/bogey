import { useState } from "react";
import { useNow } from "@bogey/ui/hooks/now";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  disbandMyTeamFn,
  leaveTeamFn,
  myTeamQueryOptions,
  newTeamCodeFn,
  renameTeamFn,
  type MyTeam,
} from "@bogey/db/queries/teams";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { useCan } from "@bogey/db/permissions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { mayStart } from "#/lib/messaging.ts";
import { formatDateTime, formatRelative } from "@bogey/utils/time";
import { useLocale } from "@bogey/ui/lib/locale";
import { useT } from "#/lib/translate.tsx";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { Button } from "@bogey/ui/components/button";
import { Badge } from "@bogey/ui/components/badge";
import { Roster } from "#/components/event/team/roster.tsx";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { Screen } from "@bogey/ui/components/screen";
import {
  StartOrJoinTeam,
  teamNameCheck,
  teamNameSchema,
} from "#/components/event/team/team-forms.tsx";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { hasTeamPage, inEvent, useEvent } from "#/lib/viewer.ts";
import { IconCopy, IconCopyCheck, IconRefresh, IconUserQuestion } from "@tabler/icons-react";
import { TeamBoard } from "./-components/team-board.tsx";

export const Route = createFileRoute("/_authed/events/$slug/team")({
  staticData: { title: "Team", command: { when: inEvent(hasTeamPage) } },
  beforeLoad: ({ context, params }) => {
    if (context.event.team_size_max === 1) {
      throw Route.redirect({ to: "/events/$slug", params, replace: true });
    }
    return { participant: context.access.role === "participant" };
  },
  loader: ({ context }) =>
    Promise.all([
      context.participant
        ? context.query.query({ ...myTeamQueryOptions(context.event.id), staleTime: "static" })
        : null,
      context.query.query({ ...eventWindowsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({
        ...settingsQueryOptions({ eventId: context.event.id }, ["teams"]),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
});

function useTeamMutation<T>(run: (eventId: string, input: T) => Promise<unknown>) {
  const eventId = useEvent().id;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: T) => run(eventId, input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: myTeamQueryOptions(eventId).queryKey }),
  });
}

function RouteComponent() {
  const t = useT();
  const { event, participant } = Route.useRouteContext();
  const manages = useCan("event.manage");

  if (!participant) {
    return (
      <Screen.Fallback
        icon={<IconUserQuestion />}
        title={t("team.forParticipants")}
        description={
          <>
            {t("team.forParticipantsBody1")}
            <br />
            <br />
            {t("team.forParticipantsBody2")}
          </>
        }
      >
        {manages && (
          <Screen.Actions>
            <Button
              render={<Route.Link to="/events/$slug/manage/teams" params={{ slug: event.slug }} />}
              nativeButton={false}
            >
              {t("team.seeEvery")}
            </Button>
          </Screen.Actions>
        )}
      </Screen.Fallback>
    );
  }

  return <ParticipantTeam />;
}

function ParticipantTeam() {
  const t = useT();
  const locale = useLocale();
  const { event } = Route.useRouteContext();
  const time = useTimeFormat();
  const { data: mine } = useSuspenseQuery(myTeamQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["teams"]),
  );
  useLiveInvalidate("team_members", myTeamQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });

  const window = windowByKey(windows, "teams");
  const teamsOpen = isWindowOpen(window);
  const now = useNow(60_000);
  const opensAt =
    !teamsOpen &&
    !window?.override &&
    window?.opens_at &&
    now !== null &&
    new Date(window.opens_at).getTime() > now
      ? window.opens_at
      : null;
  const size = t("team.size", {
    size:
      event.team_size_min === event.team_size_max
        ? event.team_size_max
        : `${event.team_size_min}–${event.team_size_max}`,
  });
  const closed = opensAt
    ? t("team.opens", { when: formatDateTime(opensAt, time) })
    : t("team.locked");

  return (
    <Screen
      title={mine ? mine.team.name : t("team.title")}
      description={teamsOpen ? size : `${size} ${closed}`}
    >
      {mine ? (
        <>
          <YourTeam mine={mine} teamsOpen={teamsOpen} />
          {settings.teams.board && teamsOpen && (
            <TeamBoard
              team={{
                full: mine.members.length >= event.team_size_max,
                editable: !mine.team.locked_at,
              }}
            />
          )}
        </>
      ) : teamsOpen ? (
        <>
          <StartOrJoinTeam />
          {settings.teams.board && <TeamBoard team={null} />}
        </>
      ) : (
        <Screen.Section title={t("team.notYet")}>
          <p className="text-sm text-muted-fg">
            {opensAt
              ? t("team.opensLater", { when: formatRelative(opensAt, undefined, locale) })
              : t("team.lockedBody")}
          </p>
          <div>
            <Button
              variant="outline"
              render={<Link to="/events/$slug/messages" params={{ slug: event.slug }} />}
              nativeButton={false}
            >
              {t("team.messages")}
            </Button>
          </div>
        </Screen.Section>
      )}
    </Screen>
  );
}

function YourTeam({ mine, teamsOpen }: { mine: MyTeam; teamsOpen: boolean }) {
  const t = useT();
  const { session, event, access, chat } = Route.useRouteContext();
  const eventId = event.id;
  const max = event.team_size_max;
  const isCaptain = mine.members.some(
    (member) => member.userId === session.user.id && member.role === "captain",
  );
  const leave = useTeamMutation(async (id) => unwrap(await leaveTeamFn({ data: id })));
  const disband = useTeamMutation(async (id) => unwrap(await disbandMyTeamFn({ data: id })));
  const { data: settings } = useSuspenseQuery(settingsQueryOptions({ eventId }, ["teams"]));
  const canDisband =
    mine.members.length > 1 &&
    (settings.teams.disband === "members" || (settings.teams.disband === "captain" && isCaptain));
  const full = mine.members.length >= max;
  const editable = teamsOpen && !mine.team.locked_at;
  const limit = settings.teams.leaveLimit;
  const leavesLeft = limit > 0 ? Math.max(limit - mine.timesLeft, 0) : null;
  // Leaving and disbanding both take someone off the team, so they share the switching rule and limit
  const mayLeave = settings.teams.switching && leavesLeft !== 0;

  return (
    <>
      <Screen.Section title={t("team.members")}>
        <Roster
          capacity={max}
          members={mine.members.map((member) => ({
            key: member.userId,
            name: member.name,
            note: member.userId === session.user.id ? t("team.you") : undefined,
            badge:
              member.role === "captain" ? (
                <Badge variant="secondary">{t("team.captain")}</Badge>
              ) : undefined,
          }))}
          openSeat={
            editable && !full ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <span>{t("team.shareCode")}</span>
                <InviteCode code={mine.team.invite_code} renew={isCaptain} />
              </div>
            ) : undefined
          }
        />
        {!editable && <p className="text-sm text-muted-fg">{t("team.lockedMembers")}</p>}
      </Screen.Section>

      {editable && (
        <Screen.Section title={t("team.settings")}>
          <RowList>
            {isCaptain && (
              <DisclosureRow title={t("team.rename")} meta={mine.team.name}>
                <RenameTeam mine={mine} />
              </DisclosureRow>
            )}
            {!mayLeave && (
              <div className="flex flex-col items-start gap-2 text-sm text-muted-fg">
                <p>
                  {settings.teams.switching ? t("team.leaveLimitReached") : t("team.switchingOff")}
                </p>
                {settings.teams.askOrganizer && mayStart(access, chat, "organizers") && (
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link to="/events/$slug/messages" params={{ slug: event.slug }} />}
                    nativeButton={false}
                  >
                    {t("team.messageOrganizers")}
                  </Button>
                )}
              </div>
            )}
            {mayLeave && (
              <DisclosureRow
                title={t("team.leaveRow")}
                meta={
                  mine.members.length === 1
                    ? t("team.leaveOnly")
                    : isCaptain
                      ? t("team.leaveCaptain")
                      : t("team.leaveOther")
                }
              >
                <div className="flex flex-col gap-2">
                  <div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={leave.isPending}
                      confirm={{
                        title: t("team.leaveTitle"),
                        description: [
                          mine.members.length === 1 ? t("team.leaveOnly") : t("team.leaveBody"),
                          leavesLeft === null
                            ? ""
                            : t("team.leavesLeft", { count: leavesLeft - 1 }),
                        ]
                          .filter(Boolean)
                          .join(" "),
                        label: t("team.leaveLabel"),
                      }}
                      onClick={() => leave.mutate(undefined)}
                    >
                      {leave.isPending ? `${t("team.leaving")}...` : `${t("team.leaveButton")}...`}
                    </Button>
                  </div>
                  <ErrorAlert error={leave.error} title={t("team.leaveFailed")} />
                </div>
              </DisclosureRow>
            )}
            {canDisband && mayLeave && (
              <DisclosureRow title={t("team.disbandRow")} meta={t("team.disbandMeta")}>
                <div className="flex flex-col gap-2">
                  <div>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={disband.isPending}
                      confirm={{
                        title: t("team.disbandTitle", { team: mine.team.name }),
                        description: t("team.disbandBody", { count: mine.members.length }),
                        label: t("team.disbandLabel"),
                      }}
                      onClick={() => disband.mutate(undefined)}
                    >
                      {disband.isPending
                        ? `${t("team.disbanding")}...`
                        : `${t("team.disbandButton")}...`}
                    </Button>
                  </div>
                  <ErrorAlert error={disband.error} title={t("team.disbandFailed")} />
                </div>
              </DisclosureRow>
            )}
          </RowList>
        </Screen.Section>
      )}
    </>
  );
}

function InviteCode({ code, renew }: { code: string; renew: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const renewCode = useTeamMutation(async (id) => unwrap(await newTeamCodeFn({ data: id })));
  return (
    <div className="flex items-center gap-2">
      <code className="rounded-md bg-muted px-2.5 py-1 font-mono text-base tracking-widest text-fg">
        {code}
      </code>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => setCopied(true));
          }}
          tooltip={copied ? t("team.copied") : t("team.copyCode")}
          aria-label={copied ? t("team.copied") : t("team.copyCode")}
        >
          {copied ? <IconCopyCheck className="size-4" /> : <IconCopy className="size-4" />}
        </Button>
        {renew && (
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={renewCode.isPending}
            tooltip={renewCode.error ? renewCode.error.message : `${t("team.newCode")}...`}
            aria-label={renewCode.error ? renewCode.error.message : `${t("team.newCode")}...`}
            confirm={{
              title: t("team.newCodeTitle"),
              description: t("team.newCodeBody"),
              label: t("team.newCodeLabel"),
            }}
            onClick={() => {
              setCopied(false);
              renewCode.mutate(undefined);
            }}
          >
            <IconRefresh className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function RenameTeam({ mine }: { mine: MyTeam }) {
  const eventId = useEvent().id;
  const t = useT();
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { name: mine.team.name },
    errorVisibility,
    validators: [
      rewardEarlyPunishLate(
        z.object({ name: teamNameSchema(t).meta({ label: t("teamForm.name") }) }),
      ),
    ],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await renameTeamFn({ data: { teamId: mine.team.id, name: value.name } }).catch(
        requestFailure,
      );
      if (!result.ok) {
        return result.error.code === "conflict"
          ? createValidationError({ fields: { name: result.error.message } })
          : createValidationError(result.error.message);
      }
      formApi.reset({ name: result.data.name });
      await queryClient.invalidateQueries({ queryKey: myTeamQueryOptions(eventId).queryKey });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <form.Field name="name" validators={[teamNameCheck(eventId, t, mine.team.id)]}>
            {(field) => (
              <field.Field className="flex-1">
                <field.Label className="sr-only" />
                <field.TextInput maxLength={60} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Submit pending={`${t("team.renaming")}...`}>{t("team.renameButton")}</form.Submit>
        </div>
        <form.FormAlert title={t("team.renameFailed")} />
      </form.Form>
    </form.AppForm>
  );
}
