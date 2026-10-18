import { exportHref } from "#/lib/exports.ts";
import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  disbandTeamFn,
  eventTeamsQueryOptions,
  organizerCreateTeamFn,
  setTeamMembershipFn,
  updateTeamFn,
  type RosterTeam,
} from "@bogey/db/queries/roster";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { PageControls, usePaged } from "@bogey/ui/components/page-controls";
import { Screen } from "@bogey/ui/components/screen";
import { IconDownload, IconLock, IconPlus, IconUsersGroup } from "@tabler/icons-react";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { inEvent } from "#/lib/viewer.ts";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { TeamMatcher } from "./-components/team-matcher.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/teams")({
  staticData: {
    title: msg("facts.teams"),
    command: { when: inEvent(({ event }) => event.team_size_max > 1) },
    settings: (t) => [
      searchSection(t("manageTeams.unassigned"), { id: "not-on-a-team" }),
      searchSection(t("manageTeams.rules"), { id: "rules" }),
      ...searchSettings(
        "teams",
        ["creation", "switching", "leaveLimit", "askOrganizer", "disband", "board"],
        t,
      ),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventTeamsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "teams",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const NO_TEAM = "none";

const nameSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("manageTeams.nameIt"))
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("teamForm.name") }),
  });

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const options = eventTeamsQueryOptions(event.id);
  const { data } = useSuspenseQuery(options);
  const [creating, setCreating] = useState(false);
  const [matching, setMatching] = useState(false);
  useLiveInvalidate("team_members", options.queryKey, { filter: `event_id=eq.${event.id}` });
  useLiveInvalidate("teams", options.queryKey, { filter: `event_id=eq.${event.id}` });

  const refresh = () => queryClient.invalidateQueries({ queryKey: options.queryKey });
  const move = useMutation({
    mutationFn: async (change: { userId: string; teamId: string | null }) =>
      unwrap(await setTeamMembershipFn({ data: { eventId: event.id, ...change } })),
    onSettled: refresh,
  });
  const update = useMutation({
    mutationFn: async (change: { id: string; locked?: boolean }) =>
      unwrap(await updateTeamFn({ data: change })),
    onSettled: refresh,
  });
  const disband = useMutation({
    mutationFn: async (id: string) => unwrap(await disbandTeamFn({ data: id })),
    onSettled: refresh,
  });
  const error = move.error ?? update.error ?? disband.error;
  const unassigned = usePaged(data.unassigned);
  const teams = usePaged(data.teams);

  const destinations = (current: string | null) => [
    { value: NO_TEAM, label: t("manageTeams.noTeam") },
    ...data.teams
      .filter((team) => team.id === current || team.members.length < event.team_size_max)
      .map((team) => ({
        value: team.id,
        label: team.name,
        description: t("roster.of", { count: team.members.length, capacity: event.team_size_max }),
      })),
  ];

  const moveSelect = (userId: string, name: string, current: string | null) => (
    <OptSelect
      size="sm"
      ariaLabel={t("manageTeams.teamFor", { name })}
      value={current ?? NO_TEAM}
      options={destinations(current)}
      disabled={move.isPending}
      onChange={(teamId) => move.mutate({ userId, teamId: teamId === NO_TEAM ? null : teamId })}
    />
  );

  return (
    <Screen
      title={t("facts.teams")}
      description={t("manageTeams.intro", {
        size:
          event.team_size_min === event.team_size_max
            ? String(event.team_size_max)
            : t("manageTeams.sizeRange", { min: event.team_size_min, max: event.team_size_max }),
      })}
      width="embedded"
      actions={
        !creating && (
          <>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={exportHref(event.slug, "teams")} download />}
            >
              <IconDownload />
              {t("manageTeams.export")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <IconPlus />
              {t("manageTeams.new")}
            </Button>
          </>
        )
      }
    >
      {creating && <CreateTeam onDone={() => setCreating(false)} />}
      <ErrorAlert error={error} title={t("manageTeams.changeFailed")} />

      {data.unassigned.length > 0 && (
        <Screen.Section
          id="not-on-a-team"
          title={t("manageTeams.unassigned")}
          description={t("manageTeams.participants", { count: data.unassigned.length })}
          actions={
            !matching && (
              <Button size="sm" variant="outline" onClick={() => setMatching(true)}>
                <IconUsersGroup />
                {t("teamMatch.open")}
              </Button>
            )
          }
        >
          {matching && <TeamMatcher eventId={event.id} onDone={() => setMatching(false)} />}
          <DisclosureList>
            {unassigned.shown.map((person) => (
              <DisclosureRow
                key={person.userId}
                leading={<NameAvatar name={person.name} />}
                title={person.name}
                actions={moveSelect(person.userId, person.name, null)}
              />
            ))}
          </DisclosureList>
          <PageControls paging={unassigned.paging} />
        </Screen.Section>
      )}

      {data.teams.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageTeams.none")}</p>
      ) : (
        <Screen.Section id="teams" title={t("manageTeams.teamCount", { count: data.teams.length })}>
          <DisclosureList>
            {teams.shown.map((team) => (
              <DisclosureRow
                key={team.id}
                leading={
                  <StatusDot
                    tone={team.members.length >= event.team_size_min ? "done" : "attention"}
                    label={
                      team.members.length >= event.team_size_min
                        ? t("manageTeams.bigEnough")
                        : t("manageTeams.tooSmall")
                    }
                  />
                }
                title={
                  <>
                    {team.name}
                    {team.locked && (
                      <IconLock
                        className="ml-1.5 inline size-3.5 text-muted-fg"
                        aria-label={t("settingRow.locked")}
                      />
                    )}
                  </>
                }
                meta={`${t("roster.of", { count: team.members.length, capacity: event.team_size_max })}${team.members.length < event.team_size_min ? `, ${t("manageTeams.needs", { min: event.team_size_min })}` : ""}`}
              >
                <TeamDetail
                  team={team}
                  moveSelect={moveSelect}
                  busy={update.isPending || disband.isPending}
                  onLock={(locked) => update.mutate({ id: team.id, locked })}
                  onDisband={() => disband.mutate(team.id)}
                />
              </DisclosureRow>
            ))}
          </DisclosureList>
          <PageControls paging={teams.paging} />
        </Screen.Section>
      )}

      <Screen.Section id="rules" title={t("manageTeams.rules")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="teams"
          keys={["creation", "switching", "leaveLimit", "askOrganizer", "disband", "board"]}
        />
      </Screen.Section>
      <PluginSettingSections page="teams" />
    </Screen>
  );
}

function TeamDetail({
  team,
  moveSelect,
  busy,
  onLock,
  onDisband,
}: {
  team: RosterTeam;
  moveSelect: (userId: string, name: string, current: string | null) => ReactNode;
  busy: boolean;
  onLock: (locked: boolean) => void;
  onDisband: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4 pl-5">
      <ul className="flex flex-col gap-2">
        {team.members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-3">
            <NameAvatar name={member.name} />
            <span className="min-w-0 flex-1 truncate text-sm">
              {member.name}
              {member.captain && (
                <Badge variant="secondary" className="ml-2">
                  {t("welcome.captain")}
                </Badge>
              )}
            </span>
            {moveSelect(member.userId, member.name, team.id)}
          </li>
        ))}
      </ul>
      <RenameTeam team={team} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onLock(!team.locked)}>
          {team.locked ? t("manageTeams.unlock") : t("manageTeams.lock")}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          confirm={{
            title: t("manageTeams.disbandTitle", { team: team.name }),
            description: t("manageTeams.disbandBody"),
            label: t("manageTeams.disband"),
          }}
          onClick={onDisband}
        >
          {t("manageTeams.disbandButton")}
        </Button>
        <p className="w-full text-xs text-muted-fg">{t("manageTeams.lockHelp")}</p>
      </div>
    </div>
  );
}

function RenameTeam({ team }: { team: RosterTeam }) {
  const t = useT();
  const schema = useMemo(() => nameSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { name: team.name },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await updateTeamFn({ data: { id: team.id, name: value.name } }).catch(
        requestFailure,
      );
      if (!result.ok) {
        return result.error.code === "conflict"
          ? createValidationError({ fields: { name: result.error.message } })
          : createValidationError(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: eventTeamsQueryOptions(event.id).queryKey });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-2">
          <form.Field name="name">
            {(field) => (
              <field.Field className="min-w-48 flex-1">
                <field.Label className="sr-only" />
                <field.TextInput maxLength={60} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.Submit size="sm" variant="outline" pending={t("team.renaming")}>
            {t("team.renameButton")}
          </form.Submit>
        </div>
        <form.FormAlert title={t("manageTeams.renameFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function CreateTeam({ onDone }: { onDone: () => void }) {
  const t = useT();
  const schema = useMemo(() => nameSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { name: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await organizerCreateTeamFn({
        data: { eventId: event.id, name: value.name },
      }).catch(requestFailure);
      if (!result.ok) {
        return result.error.code === "conflict"
          ? createValidationError({ fields: { name: result.error.message } })
          : createValidationError(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: eventTeamsQueryOptions(event.id).queryKey });
      onDone();
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <form.Field name="name">
          {(field) => <field.TextField required description={t("manageTeams.startsEmpty")} />}
        </form.Field>
        <form.FormAlert title={t("teamForm.createFailed")} />
        <div className="flex gap-2">
          <form.Submit pending={t("teamForm.creating")}>{t("teamForm.create")}</form.Submit>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
