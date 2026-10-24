import { useRoleLabel } from "#/lib/roles.ts";
import { IconDownload } from "@tabler/icons-react";
import { exportHref } from "#/lib/exports.ts";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  fromLink,
  moveDivision,
  splitsTeam,
  usePeopleMutation,
} from "./-components/people-shared.ts";
import { eventInviteLinksQueryOptions } from "@bogey/db/queries/invites";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  eventPeopleQueryOptions,
  manageSummaryQueryOptions,
  type EventPeople,
  removeMemberFn,
  setExtraRolesFn,
  setMemberRoleFn,
} from "@bogey/db/queries/manage";
import { pluginRoles } from "@bogey/plugins";
import { MultiSelect, type SearchSelectOption } from "@bogey/ui/components/search-select";
import {
  checkinRosterQueryOptions,
  isCheckedIn,
  type RosterEntry,
} from "@bogey/db/queries/checkin";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { rosterOverlapsQueryOptions, type RosterOverlap } from "@bogey/db/queries/roster";
import { RosterImport } from "./-components/roster-import.tsx";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { z } from "zod";
import { unwrap } from "@bogey/db/errors";
import type { EventRole } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { OptSelect } from "@bogey/ui/components/opt-select";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@bogey/ui/components/alert-dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import {
  DataTable,
  dataColumns,
  type DataTableFilter,
  type DataTableGroups,
} from "@bogey/ui/components/data-table";
import { checkInFn } from "@bogey/db/queries/checkin";
import { Facts } from "@bogey/ui/components/facts";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { tagHoldersQueryOptions, tagsQueryOptions, type Tag } from "@bogey/db/queries/tags";
import { TagPicker } from "#/components/tags/tags.tsx";
import { isOrgAdmin } from "@bogey/db/auth";

export const Route = createFileRoute("/_authed/events/$slug/manage/people/")({
  staticData: {
    title: msg("adminTab.people"),
    settings: (t) => [
      searchSection(t("managePeople.roster"), {
        keywords: ["import", "csv", "spreadsheet"],
        id: "add-people-from-a-roster",
      }),
    ],
  },
  validateSearch: z.object({
    link: z.uuid().optional().catch(undefined),
    group: z.enum(["team", "role", "division"]).optional().catch(undefined),
  }),
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...eventInviteLinksQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...eventPeopleQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...eventDivisionsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...rosterOverlapsQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...checkinRosterQueryOptions(context.event.id), staleTime: "static" }),
      context.query.query({ ...tagScopeQueries(context.event).tags, staleTime: "static" }),
      context.query.query({ ...tagScopeQueries(context.event).holders, staleTime: "static" }),
      context.query.query({
        ...settingsQueryOptions({ eventId: context.event.id }, ["tags"]),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const NO_DIVISION = "none";

function tagScopeQueries(event: { id: string; org_id: string }) {
  const scope = { orgId: event.org_id, eventId: event.id };
  return { tags: tagsQueryOptions(scope), holders: tagHoldersQueryOptions(scope) };
}

const ROLES: Tuple<EventRole> = ["participant", "judge", "staff", "organizer"];

function RouteComponent() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const { event, session, plugins } = Route.useRouteContext();
  const { link: linkId, group: grouping = "none" } = Route.useSearch();
  const { data: everyone } = useSuspenseQuery(eventPeopleQueryOptions(event.id));
  const { data: links } = useSuspenseQuery(eventInviteLinksQueryOptions(event.id));
  const link = linkId ? links.find((each) => each.id === linkId) : undefined;
  const people = useMemo(() => (link ? fromLink(everyone, link.id) : everyone), [everyone, link]);
  useLiveInvalidate("registrations", eventPeopleQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });

  const setRole = usePeopleMutation(event.id, async (input: { userId: string; role: EventRole }) =>
    unwrap(await setMemberRoleFn({ data: { eventId: event.id, ...input } })),
  );
  const setExtraRoles = usePeopleMutation(
    event.id,
    async (input: { userId: string; roles: string[] }) =>
      unwrap(await setExtraRolesFn({ data: { eventId: event.id, ...input } })),
  );
  const pluginRoleOptions = useMemo(
    (): SearchSelectOption[] =>
      pluginRoles(plugins).map((role) => ({
        value: role.key,
        label: role.label,
        group: plugins.find((plugin) => plugin.key === role.source)?.name ?? role.source,
      })),
    [plugins],
  );
  const remove = usePeopleMutation(event.id, async (userId: string) =>
    unwrap(await removeMemberFn({ data: { eventId: event.id, userId } })),
  );
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const place = usePeopleMutation(
    event.id,
    async (input: { members: Member[]; divisionId: string | undefined; wholeTeams: boolean }) => {
      const failed = await moveDivision(
        event.id,
        input.members,
        input.divisionId,
        input.wholeTeams,
      );
      if (failed > 0) throw new Error(t("managePeople.bulkFailed", { count: failed }));
    },
  );
  const { data: tags } = useSuspenseQuery(tagScopeQueries(event).tags);
  const { data: holders } = useSuspenseQuery(tagScopeQueries(event).holders);
  const { data: tagSettings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["tags"]),
  );
  const eventTags = tagSettings.tags.eventTags;
  const usableTags = useMemo(
    () => tags.filter((tag) => !tag.event_id || eventTags),
    [tags, eventTags],
  );
  const heldBy = useMemo(() => {
    const byUser = new Map<string, string[]>();
    for (const each of holders)
      byUser.set(each.userId, [...(byUser.get(each.userId) ?? []), each.tagId]);
    return byUser;
  }, [holders]);
  const { data: roster } = useSuspenseQuery(checkinRosterQueryOptions(event.id));
  const arrival = useMemo(() => new Map(roster.map((entry) => [entry.userId, entry])), [roster]);
  const rows = useStableRows(people.members, arrival, heldBy);
  const [confirming, setConfirming] = useState<{
    title: string;
    description: string;
    run: () => void;
    label?: string;
    // a second way forward, next to the main one
    alternative?: { label: string; run: () => void };
  } | null>(null);

  const [pickedMembers, setPickedMembers] = useState<ReadonlySet<string>>(new Set());
  const picked = people.members
    .filter((member) => pickedMembers.has(member.userId))
    .map((member) => member.userId);

  // the mutation objects are new every render; their mutate functions and flags aren't
  const { mutate: changeRole, isPending: changingRole } = setRole;
  const { mutate: placeIn, isPending: placing } = place;
  // a team shares one division, so splitting one asks whether the whole team moves
  const askDivision = useCallback(
    (members: Member[], divisionId: string | undefined, onSuccess?: () => void) => {
      const moving = members.filter((member) => (member.divisionId ?? undefined) !== divisionId);
      if (moving.length === 0) return;
      const run = (wholeTeams: boolean) =>
        placeIn({ members: moving, divisionId, wholeTeams }, { onSuccess });
      if (!splitsTeam(moving)) return run(true);
      const division =
        divisions.find((each) => each.id === divisionId)?.name ?? t("checkin.noDivision");
      const [one] = moving;
      const teams = new Set(moving.map((member) => member.teamId).filter(Boolean)).size;
      setConfirming(
        moving.length === 1 && one
          ? {
              title: t("managePeople.divisionTeamTitle", { name: one.name }),
              description: t("managePeople.divisionTeamAsk", {
                name: one.name,
                team: one.team ?? "",
                division,
              }),
              label: t("managePeople.divisionWholeTeam", { team: one.team ?? "" }),
              run: () => run(true),
              alternative: {
                label: t("managePeople.divisionOnlyThem", { name: one.name }),
                run: () => run(false),
              },
            }
          : {
              title: t("managePeople.divisionTeamsTitle", { count: moving.length }),
              description: t("managePeople.divisionTeamsAsk", { teams, division }),
              label: t("managePeople.divisionWholeTeams", { count: teams }),
              run: () => run(true),
              alternative: {
                label: t("managePeople.divisionOnlyPicked"),
                run: () => run(false),
              },
            },
      );
    },
    [placeIn, divisions, t],
  );
  const { mutate: changeExtraRoles } = setExtraRoles;
  const { mutate: removeMember, isPending: removing } = remove;
  const you = session.user.id;
  const orgAdmin = isOrgAdmin(session);
  const columns = useMemo(
    () =>
      memberColumns({
        t,
        roleLabel,
        you,
        slug: event.slug,
        divisions,
        pluginRoleOptions,
        onRole: (member, role) => {
          const change = () => changeRole({ userId: member.userId, role });
          if (member.teamId && member.role === "participant" && role !== "participant") {
            setConfirming({
              title: t("managePeople.roleTeamTitle", { name: member.name }),
              description: t("managePeople.roleTeamBody", {
                name: member.name,
                team: member.team ?? "",
                role: roleLabel(role),
              }),
              run: change,
            });
          } else change();
        },
        onDivision: (member, divisionId) => askDivision([member], divisionId),
        onExtraRoles: (userId, roles) => changeExtraRoles({ userId, roles }),
        tags: {
          orgId: event.org_id,
          eventId: event.id,
          all: usableTags,
          orgAdmin,
          eventTags,
        },
        onRemove: (userId) => removeMember(userId),
      }),
    [
      t,
      roleLabel,
      you,
      divisions,
      pluginRoleOptions,
      event.slug,
      changeRole,
      askDivision,
      changeExtraRoles,
      removeMember,
      event.org_id,
      event.id,
      usableTags,
      orgAdmin,
      eventTags,
      setConfirming,
    ],
  );
  const filters = useMemo(
    (): DataTableFilter[] => [
      {
        column: "checkin",
        title: t("managePeople.show"),
        single: { all: t("badges.everyone") },
        options: [
          { value: HERE, label: t("session.checkedIn") },
          { value: ABSENT, label: t("managePeople.notCheckedIn") },
        ],
      },
      {
        column: "role",
        title: t("managePeople.roleColumn"),
        options: [
          ...ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
          ...pluginRoleOptions,
        ],
      },
      ...(divisions.length > 0
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
        : []),
    ],
    [t, roleLabel, pluginRoleOptions, divisions],
  );
  const navigate = Route.useNavigate();
  const groups = useMemo(
    () => personGroups(grouping, { t, roleLabel, divisions }),
    [grouping, t, roleLabel, divisions],
  );
  return (
    <Screen
      title={t("adminTab.people")}
      width="embedded"
      description={
        link && (
          <>
            {link.label
              ? t("managePeople.showingLink", { label: link.label })
              : t("managePeople.showingOneLink")}{" "}
            <Link to="/events/$slug/manage/people" params={{ slug: event.slug }}>
              {t("managePeople.showEveryone")}
            </Link>
          </>
        )
      }
    >
      {!link && <RosterImport eventId={event.id} maxTeamSize={event.team_size_max} />}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            {confirming?.alternative && (
              <Button
                variant="outline"
                onClick={() => {
                  confirming.alternative?.run();
                  setConfirming(null);
                }}
              >
                {confirming.alternative.label}
              </Button>
            )}
            <Button
              onClick={() => {
                confirming?.run();
                setConfirming(null);
              }}
            >
              {confirming?.label ?? t("common.continue")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ErrorAlert
        error={setRole.error ?? setExtraRoles.error ?? remove.error ?? place.error}
        title={t("managePeople.failed")}
      />

      <Screen.Section
        id="in-this-event"
        title={t("managePeople.inEvent")}
        description={t("managePeople.count", { count: people.members.length })}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/events/$slug/badges" params={{ slug: event.slug }} />}
              nativeButton={false}
            >
              {t("managePeople.printBadges")}...
            </Button>
            <Button
              size="sm"
              variant="outline"
              render={<a href={exportHref(event.slug, "members")} download />}
              nativeButton={false}
            >
              <IconDownload />
              {t("manageTeams.export")}
            </Button>
          </>
        }
      >
        {people.members.length === 0 ? (
          <p className="text-sm text-muted-fg">{t("managePeople.none")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {picked.length > 0 && (
              <BulkMembers
                eventId={event.id}
                you={session.user.id}
                userIds={picked}
                divisions={divisions}
                onDivision={(divisionId) =>
                  askDivision(
                    people.members.filter(
                      (member) => pickedMembers.has(member.userId) && member.userId !== you,
                    ),
                    divisionId,
                    () => setPickedMembers(new Set()),
                  )
                }
                onDone={() => setPickedMembers(new Set())}
              />
            )}
            <Busy value={changingRole || placing || removing}>
              <DataTable
                columns={columns}
                data={rows}
                getRowId={rowId}
                selection={{
                  selected: pickedMembers,
                  onChange: setPickedMembers,
                  label: rowName,
                }}
                search={{ text: searchText, placeholder: `${t("managePeople.search")}...` }}
                filters={filters}
                columnsMenu
                groups={groups}
                toolbar={
                  <OptSelect
                    size="sm"
                    ariaLabel={t("managePeople.groupBy")}
                    value={grouping}
                    options={[
                      { value: "none", label: t("managePeople.groupNone") },
                      { value: "team", label: t("managePeople.groupTeam") },
                      { value: "role", label: t("managePeople.groupRole") },
                      ...(divisions.length > 0
                        ? [{ value: "division" as const, label: t("managePeople.groupDivision") }]
                        : []),
                    ]}
                    onChange={(next) =>
                      void navigate({
                        search: (prev) => ({ ...prev, group: next === "none" ? undefined : next }),
                        replace: true,
                      })
                    }
                  />
                }
                empty={t("managePeople.noneShown")}
                pageSize={25}
              />
            </Busy>
          </div>
        )}
      </Screen.Section>

      <Overlaps eventId={event.id} />
      <PluginSettingSections page="people" />
    </Screen>
  );
}

const NO_TAGS: Tuple<string> = [];
const HERE = "here";
const ABSENT = "absent";

type Member = EventPeople["members"][number];
type Division = { id: string; name: string };
type Grouping = "team" | "role" | "division";

/** A person's row: the member, plus their check-in and tags, kept apart so each can be compared. */
interface PersonRow {
  member: Member;
  here: RosterEntry | undefined;
  tags: Tuple<string>;
}

const rowId = (row: PersonRow) => row.member.userId;
const rowName = (row: PersonRow) => row.member.name;
const searchText = (row: PersonRow) =>
  `${row.member.name} ${row.member.email ?? ""} ${row.member.team ?? ""}`;

// rows keep their identity while nothing about that person changed, so the table
// only redraws the rows that did
function useStableRows(
  members: Tuple<Member>,
  arrival: ReadonlyMap<string, RosterEntry>,
  heldBy: ReadonlyMap<string, Tuple<string>>,
): PersonRow[] {
  const [cache] = useState(() => new Map<string, PersonRow>());
  return useMemo(
    () =>
      members.map((member) => {
        const here = arrival.get(member.userId);
        const tags = heldBy.get(member.userId) ?? NO_TAGS;
        const before = cache.get(member.userId);
        if (
          before &&
          before.member === member &&
          before.here === here &&
          sameList(before.tags, tags)
        ) {
          return before;
        }
        const row = { member, here, tags };
        cache.set(member.userId, row);
        return row;
      }),
    [members, arrival, heldBy, cache],
  );
}

function sameList(a: Tuple<string>, b: Tuple<string>) {
  return a.length === b.length && a.every((each, index) => each === b[index]);
}

function personGroups(
  grouping: Grouping | "none",
  context: { t: T; roleLabel: (role: string) => string; divisions: Tuple<Division> },
): DataTableGroups<PersonRow> | undefined {
  const { t, roleLabel, divisions } = context;
  // the "nobody" group goes last
  const lastIfEmpty = (a: string, b: string) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b));
  switch (grouping) {
    case "team":
      return {
        by: (row) => row.member.team ?? "",
        label: (key) => key || t("managePeople.noTeam"),
        compare: lastIfEmpty,
      };
    case "role":
      return {
        by: (row) => row.member.role,
        label: (key) => roleLabel(key),
        compare: (a, b) =>
          ROLES.findIndex((role) => role === a) - ROLES.findIndex((role) => role === b),
      };
    case "division": {
      const names = new Map(divisions.map((division) => [division.id, division.name]));
      return {
        by: (row) => row.member.divisionId ?? "",
        label: (key) => names.get(key) ?? t("checkin.noDivision"),
        compare: (a, b) => lastIfEmpty(names.get(a) ?? "", names.get(b) ?? ""),
      };
    }
    case "none":
      return undefined;
  }
}

// whether a change is saving; cells read it so rows needn't redraw for it
const BusyContext = createContext(false);
const Busy = BusyContext.Provider;

const memberColumn = dataColumns<PersonRow>();

function memberColumns(options: {
  t: T;
  roleLabel: (role: string) => string;
  you: string;
  slug: string;
  divisions: Tuple<Division>;
  pluginRoleOptions: Tuple<SearchSelectOption>;
  onRole: (member: Member, role: EventRole) => void;
  onDivision: (member: Member, divisionId: string | undefined) => void;
  onExtraRoles: (userId: string, roles: string[]) => void;
  onRemove: (userId: string) => void;
  tags: {
    orgId: string;
    eventId: string;
    all: Tuple<Tag>;
    orgAdmin: boolean;
    eventTags: boolean;
  };
}) {
  const { t } = options;
  return memberColumn.columns([
    memberColumn.accessor((row) => row.member.name, {
      id: "name",
      header: t("checkin.name"),
      enableHiding: false,
      cell: (info) => {
        const member = info.row.original.member;
        return (
          <span className="flex min-w-48 items-center gap-3">
            <NameAvatar name={member.name} />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {member.name}
                {member.userId === options.you && (
                  <span className="font-normal text-muted-fg"> {t("welcome.you")}</span>
                )}
              </span>
              {member.email && (
                <span className="break-all text-xs text-muted-fg">{member.email}</span>
              )}
            </span>
          </span>
        );
      },
    }),
    memberColumn.accessor((row) => options.roleLabel(row.member.role), {
      id: "role",
      header: t("managePeople.roleColumn"),
      getUniqueValues: (row) => [row.member.role, ...row.member.extraRoles],
      cell: (info) => (
        <RoleCell
          member={info.row.original.member}
          roleLabel={options.roleLabel}
          pluginRoleOptions={options.pluginRoleOptions}
          onRole={options.onRole}
          onExtraRoles={options.onExtraRoles}
        />
      ),
    }),
    ...(options.tags.all.length > 0
      ? [
          memberColumn.display({
            id: "tags",
            header: t("tags.column"),
            cell: (info) => {
              const { member, tags } = info.row.original;
              return (
                <TagPicker
                  orgId={options.tags.orgId}
                  eventId={options.tags.eventId}
                  userId={member.userId}
                  name={member.name}
                  tags={options.tags.all}
                  held={tags}
                  editableScopes={{
                    // org tags go on org members, which participants aren't
                    org: options.tags.orgAdmin && member.role !== "participant",
                    event: options.tags.eventTags,
                  }}
                />
              );
            },
          }),
        ]
      : []),
    memberColumn.accessor((row) => row.member.team ?? "", {
      id: "team",
      header: t("managePeople.teamColumn"),
      cell: (info) => {
        const member = info.row.original.member;
        return member.teamId ? (
          <Link
            to="/events/$slug/manage/teams"
            params={{ slug: options.slug }}
            hash={member.teamId}
            className="link"
          >
            {info.getValue()}
          </Link>
        ) : (
          <span className="text-muted-fg">–</span>
        );
      },
    }),
    ...(options.divisions.length > 0
      ? [
          memberColumn.accessor(
            (row) =>
              options.divisions.find((division) => division.id === row.member.divisionId)?.name ??
              "",
            {
              id: "division",
              header: t("managePeople.divisionColumn"),
              getUniqueValues: (row) => [row.member.divisionId ?? NO_DIVISION],
              cell: (info) => (
                <DivisionCell
                  member={info.row.original.member}
                  divisions={options.divisions}
                  onDivision={options.onDivision}
                />
              ),
            },
          ),
        ]
      : []),
    memberColumn.accessor((row) => checkInText(row.here, t) ?? "", {
      id: "checkin",
      header: t("managePeople.checkInColumn"),
      getUniqueValues: (row) => [row.here && isCheckedIn(row.here) ? HERE : ABSENT],
      cell: (info) => (
        <span className="whitespace-nowrap text-muted-fg">{info.getValue() || "–"}</span>
      ),
    }),
    memberColumn.display({
      id: "actions",
      header: () => <span className="sr-only">{t("adminPeople.actions")}</span>,
      enableHiding: false,
      cell: (info) => (
        <RemoveCell
          member={info.row.original.member}
          you={info.row.original.member.userId === options.you}
          onRemove={options.onRemove}
        />
      ),
    }),
  ]);
}

function RoleCell({
  member,
  roleLabel,
  pluginRoleOptions,
  onRole,
  onExtraRoles,
}: {
  member: Member;
  roleLabel: (role: string) => string;
  pluginRoleOptions: Tuple<SearchSelectOption>;
  onRole: (member: Member, role: EventRole) => void;
  onExtraRoles: (userId: string, roles: string[]) => void;
}) {
  const t = useT();
  const busy = useContext(BusyContext);
  return (
    <div className="flex flex-col gap-1.5">
      <OptSelect
        size="sm"
        ariaLabel={t("members.roleFor", { name: member.name })}
        value={member.role}
        options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
        disabled={busy}
        onChange={(role) => onRole(member, role)}
      />
      {pluginRoleOptions.length > 0 && (
        <div className="min-w-48">
          <label htmlFor={`extra-roles-${member.userId}`} className="sr-only">
            {t("managePeople.extraRolesFor", { name: member.name })}
          </label>
          <MultiSelect
            id={`extra-roles-${member.userId}`}
            options={pluginRoleOptions}
            value={member.extraRoles}
            placeholder={t("managePeople.extraRoles")}
            onValueChange={(roles) => onExtraRoles(member.userId, roles)}
          />
        </div>
      )}
    </div>
  );
}

function DivisionCell({
  member,
  divisions,
  onDivision,
}: {
  member: Member;
  divisions: Tuple<Division>;
  onDivision: (member: Member, divisionId: string | undefined) => void;
}) {
  const t = useT();
  const busy = useContext(BusyContext);
  if (member.role !== "participant") return <span className="text-muted-fg">–</span>;
  return (
    <OptSelect
      size="sm"
      ariaLabel={t("managePeople.divisionFor", { name: member.name })}
      value={member.divisionId ?? NO_DIVISION}
      options={[
        { value: NO_DIVISION, label: t("checkin.noDivision") },
        ...divisions.map((division) => ({ value: division.id, label: division.name })),
      ]}
      disabled={busy}
      onChange={(next) => onDivision(member, next === NO_DIVISION ? undefined : next)}
    />
  );
}

function RemoveCell({
  member,
  you,
  onRemove,
}: {
  member: Member;
  you: boolean;
  onRemove: (userId: string) => void;
}) {
  const t = useT();
  const busy = useContext(BusyContext);
  return (
    <div className="flex justify-end">
      <Button
        variant="ghost-destructive"
        size="sm"
        disabled={busy}
        confirm={{
          title: you
            ? t("managePeople.removeSelfTitle")
            : t("members.removeTitle", { name: member.name }),
          description: you
            ? t("managePeople.removeSelfBody")
            : t("managePeople.removeBody", { name: member.name }),
          label: t("twoFactor.remove"),
        }}
        onClick={() => onRemove(member.userId)}
      >
        {t("managePeople.removeButton")}...
      </Button>
    </div>
  );
}

const KEEP = "keep";

// actions on every checked person at once; you're left out of role changes and removal
function BulkMembers({
  eventId,
  you,
  userIds,
  divisions,
  onDivision,
  onDone,
}: {
  eventId: string;
  you: string;
  userIds: Tuple<string>;
  divisions: Tuple<Division>;
  onDivision: (divisionId: string | undefined) => void;
  onDone: () => void;
}) {
  const t = useT();
  const roleLabel = useRoleLabel();
  const queryClient = useQueryClient();
  const others = userIds.filter((id) => id !== you);
  const run = useMutation({
    mutationFn: async (action: (userId: string) => Promise<unknown>) => {
      const results = await Promise.allSettled(others.map((userId) => action(userId)));
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) throw new Error(t("managePeople.bulkFailed", { count: failed }));
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: checkinRosterQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: manageSummaryQueryOptions(eventId).queryKey }),
      ]),
    onSuccess: onDone,
  });
  const checkIn = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        userIds.map(async (userId) =>
          unwrap(await checkInFn({ data: { eventId, userId, method: "desk" } })),
        ),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed > 0) throw new Error(t("managePeople.bulkFailed", { count: failed }));
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: checkinRosterQueryOptions(eventId).queryKey }),
    onSuccess: onDone,
  });
  const busy = run.isPending || checkIn.isPending;
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {t("managePeople.selectedCount", { count: userIds.length })}
        </span>
        <OptSelect
          size="sm"
          ariaLabel={`${t("managePeople.bulkRole")}...`}
          value={KEEP}
          disabled={busy || others.length === 0}
          options={[
            { value: KEEP, label: `${t("managePeople.bulkRole")}...` },
            ...ROLES.map((role) => ({ value: role, label: roleLabel(role) })),
          ]}
          onChange={(role) => {
            const next = ROLES.find((each) => each === role);
            if (next) {
              run.mutate(async (userId) =>
                unwrap(await setMemberRoleFn({ data: { eventId, userId, role: next } })),
              );
            }
          }}
        />
        {divisions.length > 0 && (
          <OptSelect
            size="sm"
            ariaLabel={`${t("managePeople.bulkDivision")}...`}
            value={KEEP}
            disabled={busy}
            options={[
              { value: KEEP, label: `${t("managePeople.bulkDivision")}...` },
              { value: NO_DIVISION, label: t("checkin.noDivision") },
              ...divisions.map((division) => ({ value: division.id, label: division.name })),
            ]}
            onChange={(next) => {
              if (next !== KEEP) onDivision(next === NO_DIVISION ? undefined : next);
            }}
          />
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => checkIn.mutate()}>
          {t("checkin.checkIn")}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || others.length === 0}
          confirm={{
            title: t("managePeople.bulkRemoveTitle", { count: others.length }),
            description: t("managePeople.bulkRemoveBody"),
            label: t("twoFactor.remove"),
          }}
          onClick={() =>
            run.mutate(async (userId) =>
              unwrap(await removeMemberFn({ data: { eventId, userId } })),
            )
          }
        >
          {t("managePeople.removeButton")}...
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={onDone}>
          {t("managePeople.clearSelection")}
        </Button>
      </div>
      {others.length < userIds.length && (
        <p className="text-xs text-muted-fg">{t("managePeople.bulkNotYou")}</p>
      )}
      <ErrorAlert error={run.error ?? checkIn.error} title={t("managePeople.failed")} />
    </div>
  );
}

function Overlaps({ eventId }: { eventId: string }) {
  const t = useT();
  const { data: overlaps } = useSuspenseQuery(rosterOverlapsQueryOptions(eventId));
  if (!overlaps.length) return null;
  const byEmail = new Map<string, RosterOverlap[]>();
  for (const overlap of overlaps) {
    byEmail.set(overlap.email, [...(byEmail.get(overlap.email) ?? []), overlap]);
  }

  return (
    <Screen.Section
      id="also-in-other-events"
      title={t("managePeople.overlaps")}
      description={t("managePeople.overlapsHelp")}
    >
      <RowList>
        {[...byEmail].map(([email, others]) => {
          const differs = others.some((other) => other.nameDiffers);
          return (
            <DisclosureRow
              key={email}
              leading={
                <StatusDot
                  tone={differs ? "attention" : "idle"}
                  label={differs ? t("managePeople.differ") : t("managePeople.same")}
                />
              }
              title={email}
              meta={`${others.map((other) => other.eventName).join(", ")}${differs ? ` · ${t("managePeople.nameDiffers")}` : ""}`}
            >
              <Facts
                className="pl-5"
                facts={[
                  {
                    label: t("managePeople.here"),
                    value: others[0]?.name ?? t("managePeople.noName"),
                  },
                  ...others.map((other) => ({
                    label: other.eventName,
                    value: `${other.otherName ?? t("managePeople.noName")} (${other.status})`,
                  })),
                ]}
              />
            </DisclosureRow>
          );
        })}
      </RowList>
    </Screen.Section>
  );
}

function checkInText(entry: RosterEntry | undefined, t: T): string | undefined {
  if (!entry) return undefined;
  if (isCheckedIn(entry)) return t("session.checkedIn");
  return entry.checkedOutAt ? t("checkin.left") : t("managePeople.notCheckedIn");
}
