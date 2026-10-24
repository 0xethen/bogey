import { exportHref } from "#/lib/exports.ts";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  disbandTeamFn,
  eventTeamsQueryOptions,
  organizerCreateTeamFn,
  setTeamMembershipFn,
  setTeamsDivisionFn,
  updateTeamFn,
  type RosterTeam,
} from "@bogey/db/queries/roster";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { eventPeopleQueryOptions } from "@bogey/db/queries/manage";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { DataTable, dataColumns, type DataTableFilter } from "@bogey/ui/components/data-table";
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
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "teams",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const NO_TEAM = "none";
const NO_DIVISION = "none";
const KEEP = "keep";

const nameSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("manageTeams.nameIt"))
      .max(60, t("form.maxLength", { max: 60 }))
      .meta({ label: t("teamForm.name") }),
  });

type Division = { id: string; name: string };

interface TeamActions {
  divisions: Tuple<Division>;
  busy: boolean;
  moveSelect: (userId: string, name: string, current: string | null) => ReactNode;
  onDivision: (teamIds: string[], divisionId: string | undefined) => void;
  onLock: (id: string, locked: boolean) => void;
  onDisband: (id: string) => void;
}

const TeamActionsContext = createContext<TeamActions | null>(null);

function useTeamActions() {
  const actions = useContext(TeamActionsContext);
  if (!actions) throw new Error("useTeamActions needs TeamActionsContext");
  return actions;
}

const teamColumn = dataColumns<RosterTeam>();
const searchText = (team: RosterTeam) =>
  `${team.name} ${team.members.map((member) => member.name).join(" ")}`;
const teamId = (team: RosterTeam) => team.id;
const teamName = (team: RosterTeam) => team.name;
const teamDetail = (team: RosterTeam) => <TeamDetail team={team} />;

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const options = eventTeamsQueryOptions(event.id);
  const { data } = useSuspenseQuery(options);
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const [creating, setCreating] = useState(false);
  const [matching, setMatching] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
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
  const place = useMutation({
    mutationFn: async (change: { teamIds: string[]; divisionId: string | undefined }) =>
      unwrap(await setTeamsDivisionFn({ data: { eventId: event.id, ...change } })),
    onSettled: () =>
      Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(event.id).queryKey }),
      ]),
  });
  const error = move.error ?? update.error ?? disband.error ?? place.error;
  const unassigned = usePaged(data.unassigned);
  // a link from People lands on its team: first in the list
  const linked = useLocation({ select: (location) => decodeURIComponent(location.hash) });
  const ordered = useMemo(
    () => [
      ...data.teams.filter((team) => team.id === linked),
      ...data.teams.filter((team) => team.id !== linked),
    ],
    [data.teams, linked],
  );
  const pickedTeams = data.teams.filter((team) => picked.has(team.id)).map((team) => team.id);

  const { mutate: moveMember, isPending: moving } = move;
  const { mutate: placeTeams, isPending: placing } = place;
  const { mutate: lockTeam, isPending: locking } = update;
  const { mutate: disbandTeam, isPending: disbanding } = disband;
  const actions = useMemo((): TeamActions => {
    const destinations = (current: string | null) => [
      { value: NO_TEAM, label: t("manageTeams.noTeam") },
      ...data.teams
        .filter((team) => team.id === current || team.members.length < event.team_size_max)
        .map((team) => ({
          value: team.id,
          label: team.name,
          description: t("roster.of", {
            count: team.members.length,
            capacity: event.team_size_max,
          }),
        })),
    ];
    return {
      divisions,
      busy: moving || placing || locking || disbanding,
      moveSelect: (userId, name, current) => (
        <OptSelect
          size="sm"
          ariaLabel={t("manageTeams.teamFor", { name })}
          value={current ?? NO_TEAM}
          options={destinations(current)}
          disabled={moving}
          onChange={(next) => moveMember({ userId, teamId: next === NO_TEAM ? null : next })}
        />
      ),
      onDivision: (teamIds, divisionId) => placeTeams({ teamIds, divisionId }),
      onLock: (id, locked) => lockTeam({ id, locked }),
      onDisband: (id) => disbandTeam(id),
    };
  }, [
    t,
    data.teams,
    event.team_size_max,
    divisions,
    moving,
    placing,
    locking,
    disbanding,
    moveMember,
    placeTeams,
    lockTeam,
    disbandTeam,
  ]);

  const columns = useMemo(
    () =>
      teamColumn.columns([
        teamColumn.accessor("name", {
          header: t("manageTeams.nameColumn"),
          enableHiding: false,
          cell: (info) => <TeamName team={info.row.original} />,
        }),
        teamColumn.accessor((team) => team.members.length, {
          id: "members",
          header: t("manageTeams.membersColumn"),
          cell: (info) => <TeamSize team={info.row.original} />,
        }),
        ...(divisions.length > 0
          ? [
              teamColumn.accessor(
                (team) => divisions.find((division) => division.id === team.divisionId)?.name ?? "",
                {
                  id: "division",
                  header: t("managePeople.divisionColumn"),
                  getUniqueValues: (team) => [team.divisionId ?? NO_DIVISION],
                  cell: (info) => <DivisionCell team={info.row.original} />,
                },
              ),
            ]
          : []),
      ]),
    [t, divisions],
  );
  const filters = useMemo(
    (): DataTableFilter[] =>
      divisions.length > 0
        ? [
            {
              column: "division",
              title: t("managePeople.divisionColumn"),
              options: [
                { value: NO_DIVISION, label: t("checkin.noDivision") },
                ...divisions.map((division) => ({ value: division.id, label: division.name })),
              ],
            },
          ]
        : [],
    [t, divisions],
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
      <TeamMatcher open={matching} onOpenChange={setMatching} />

      <TeamActionsContext value={actions}>
        {data.unassigned.length > 0 && (
          <Screen.Section
            id="not-on-a-team"
            title={t("manageTeams.unassigned")}
            description={t("manageTeams.participants", { count: data.unassigned.length })}
            actions={
              <Button size="sm" variant="outline" onClick={() => setMatching(true)}>
                <IconUsersGroup />
                {t("teamMatch.open")}...
              </Button>
            }
          >
            <RowList>
              {unassigned.shown.map((person) => (
                <DisclosureRow
                  key={person.userId}
                  leading={<NameAvatar name={person.name} />}
                  title={person.name}
                  actions={actions.moveSelect(person.userId, person.name, null)}
                />
              ))}
            </RowList>
            <PageControls paging={unassigned.paging} />
          </Screen.Section>
        )}

        {data.teams.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("manageTeams.none")}</p>
        ) : (
          <Screen.Section
            id="teams"
            title={t("manageTeams.teamCount", { count: data.teams.length })}
            description={divisions.length > 0 ? t("manageTeams.divisionHelp") : undefined}
          >
            <div className="flex flex-col gap-3">
              {pickedTeams.length > 0 && divisions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/50 p-3">
                  <span className="text-sm font-medium">
                    {t("managePeople.selectedCount", { count: pickedTeams.length })}
                  </span>
                  <OptSelect
                    size="sm"
                    ariaLabel={`${t("managePeople.bulkDivision")}...`}
                    value={KEEP}
                    disabled={placing}
                    options={[
                      { value: KEEP, label: `${t("managePeople.bulkDivision")}...` },
                      { value: NO_DIVISION, label: t("checkin.noDivision") },
                      ...divisions.map((division) => ({
                        value: division.id,
                        label: division.name,
                      })),
                    ]}
                    onChange={(next) => {
                      if (next === KEEP) return;
                      placeTeams(
                        {
                          teamIds: pickedTeams,
                          divisionId: next === NO_DIVISION ? undefined : next,
                        },
                        { onSuccess: () => setPicked(new Set()) },
                      );
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setPicked(new Set())}
                  >
                    {t("managePeople.clearSelection")}
                  </Button>
                </div>
              )}
              <DataTable
                columns={columns}
                data={ordered}
                getRowId={teamId}
                pageSize={25}
                selection={
                  divisions.length > 0
                    ? { selected: picked, onChange: setPicked, label: teamName }
                    : undefined
                }
                search={{ text: searchText, placeholder: `${t("manageTeams.search")}...` }}
                filters={filters}
                detail={teamDetail}
              />
            </div>
          </Screen.Section>
        )}
      </TeamActionsContext>

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

function TeamName({ team }: { team: RosterTeam }) {
  const t = useT();
  const { event } = Route.useRouteContext();
  const bigEnough = team.members.length >= event.team_size_min;
  return (
    <span className="flex items-center gap-2">
      <StatusDot
        tone={bigEnough ? "done" : "attention"}
        label={bigEnough ? t("manageTeams.bigEnough") : t("manageTeams.tooSmall")}
      />
      <span className="truncate font-medium">{team.name}</span>
      {team.locked && (
        <IconLock className="size-3.5 shrink-0 text-muted-fg" aria-label={t("settingRow.locked")} />
      )}
    </span>
  );
}

function TeamSize({ team }: { team: RosterTeam }) {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <span className="text-sm text-muted-fg">
      {t("roster.of", { count: team.members.length, capacity: event.team_size_max })}
      {team.members.length < event.team_size_min &&
        `, ${t("manageTeams.needs", { min: event.team_size_min })}`}
    </span>
  );
}

function DivisionCell({ team }: { team: RosterTeam }) {
  const t = useT();
  const { divisions, busy, onDivision } = useTeamActions();
  return (
    <OptSelect
      size="sm"
      ariaLabel={t("manageTeams.divisionFor", { team: team.name })}
      value={team.divisionId ?? NO_DIVISION}
      options={[
        { value: NO_DIVISION, label: t("checkin.noDivision") },
        ...divisions.map((division) => ({ value: division.id, label: division.name })),
      ]}
      disabled={busy}
      onChange={(next) => onDivision([team.id], next === NO_DIVISION ? undefined : next)}
    />
  );
}

function TeamDetail({ team }: { team: RosterTeam }) {
  const t = useT();
  const { moveSelect, busy, onLock, onDisband } = useTeamActions();
  return (
    <div className="flex flex-col gap-4">
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
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onLock(team.id, !team.locked)}
        >
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
          onClick={() => onDisband(team.id)}
        >
          {t("manageTeams.disbandButton")}...
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
          <form.Submit size="sm" variant="outline" pending={`${t("team.renaming")}...`}>
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
          <form.Submit pending={`${t("teamForm.creating")}...`}>{t("teamForm.create")}</form.Submit>
          <Button type="button" variant="ghost" onClick={onDone}>
            {t("common.cancel")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
}
