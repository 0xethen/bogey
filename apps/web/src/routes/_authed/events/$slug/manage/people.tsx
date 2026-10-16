import { useRoleLabel } from "#/lib/roles.ts";
import { IconDownload } from "@tabler/icons-react";
import { exportHref } from "#/lib/exports.ts";
import { useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { eventInviteLinksQueryOptions } from "@bogey/db/queries/invites";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  eventPeopleQueryOptions,
  manageSummaryQueryOptions,
  type EventPeople,
  removeMemberFn,
  reviewRegistrationFn,
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
import { eventDivisionsQueryOptions, setDivisionFn } from "@bogey/db/queries/divisions";
import { rosterOverlapsQueryOptions, type RosterOverlap } from "@bogey/db/queries/roster";
import { RosterImport } from "./-components/roster-import.tsx";
import { BulkReview } from "./-components/bulk-review.tsx";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { StatusDot } from "@bogey/ui/components/status-dot";
import { z } from "zod";
import { browserClient } from "@bogey/db/browser";
import { unwrap } from "@bogey/db/errors";
import type { EventRole } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { Badge } from "@bogey/ui/components/badge";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { checkInFn } from "@bogey/db/queries/checkin";
import { Facts, type Fact } from "@bogey/ui/components/facts";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/people")({
  staticData: {
    title: msg("adminTab.people"),
    settings: (t) => [
      searchSection(t("managePeople.waiting"), {
        keywords: ["approve", "pending"],
        id: "waiting-for-review",
      }),
      searchSection(t("managePeople.waitlist"), { id: "waitlist" }),
      searchSection(t("managePeople.invited"), { id: "invited" }),
      searchSection(t("managePeople.roster"), {
        keywords: ["import", "csv", "spreadsheet"],
        id: "add-people-from-a-roster",
      }),
    ],
  },
  validateSearch: z.object({ link: z.uuid().optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventInviteLinksQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPeopleQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventDivisionsQueryOptions(context.event.id)),
      context.query.ensureQueryData(rosterOverlapsQueryOptions(context.event.id)),
      context.query.ensureQueryData(checkinRosterQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const NO_DIVISION = "none";

const ROLES: Tuple<EventRole> = ["participant", "judge", "staff", "organizer"];

function fromLink(people: EventPeople, linkId: string): EventPeople {
  const registrations = people.registrations.filter((row) => row.invite_link_id === linkId);
  const users = new Set(registrations.map((row) => row.user_id));
  return {
    ...people,
    registrations,
    members: people.members.filter((member) => users.has(member.userId)),
  };
}

function usePeopleMutation<T, R>(eventId: string, run: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: manageSummaryQueryOptions(eventId).queryKey }),
      ]),
  });
}

function RouteComponent() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const { event, session, plugins } = Route.useRouteContext();
  const { link: linkId } = Route.useSearch();
  const { data: everyone } = useSuspenseQuery(eventPeopleQueryOptions(event.id));
  const { data: links } = useSuspenseQuery(eventInviteLinksQueryOptions(event.id));
  const link = linkId ? links.find((each) => each.id === linkId) : undefined;
  const people = link ? fromLink(everyone, link.id) : everyone;
  useLiveInvalidate("registrations", eventPeopleQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });

  const review = usePeopleMutation(
    event.id,
    async (input: { id: string; decision: "approved" | "rejected" }) =>
      unwrap(
        await reviewRegistrationFn({
          data: { registrationId: input.id, decision: input.decision },
        }),
      ),
  );
  const setRole = usePeopleMutation(event.id, async (input: { userId: string; role: EventRole }) =>
    unwrap(await setMemberRoleFn({ data: { eventId: event.id, ...input } })),
  );
  const setExtraRoles = usePeopleMutation(
    event.id,
    async (input: { userId: string; roles: string[] }) =>
      unwrap(await setExtraRolesFn({ data: { eventId: event.id, ...input } })),
  );
  const pluginRoleOptions: SearchSelectOption[] = pluginRoles(plugins).map((role) => ({
    value: role.key,
    label: role.label,
    group: plugins.find((plugin) => plugin.key === role.source)?.name ?? role.source,
  }));
  const remove = usePeopleMutation(event.id, async (userId: string) =>
    unwrap(await removeMemberFn({ data: { eventId: event.id, userId } })),
  );
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const place = usePeopleMutation(
    event.id,
    async (input: { userId: string; divisionId: string | undefined }) =>
      unwrap(await setDivisionFn({ data: { eventId: event.id, ...input } })),
  );
  const { data: roster } = useSuspenseQuery(checkinRosterQueryOptions(event.id));
  const arrival = new Map(roster.map((entry) => [entry.userId, entry]));
  const [filter, setFilter] = useState<"everyone" | "absent" | "here">("everyone");
  const shown = people.members.filter((member) => {
    const here = arrival.get(member.userId);
    if (filter === "here") return here ? isCheckedIn(here) : false;
    if (filter === "absent") return !here || !isCheckedIn(here);
    return true;
  });

  const [pickedMembers, setPickedMembers] = useState<ReadonlySet<string>>(new Set());
  const picked = people.members
    .filter((member) => pickedMembers.has(member.userId))
    .map((member) => member.userId);

  const pending = people.registrations.filter((row) => row.status === "pending");
  const waitlist = people.registrations
    .filter((row) => row.status === "waitlisted")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const chosen = [...selected].filter((id) =>
    people.registrations.some(
      (row) => row.id === id && ["pending", "waitlisted"].includes(row.status),
    ),
  );
  const waiting = people.registrations.filter((row) => row.status === "approved" && !row.user_id);
  const error = review.error ?? setRole.error ?? remove.error ?? place.error;

  const reviewRow = (row: EventPeople["registrations"][number], index: number, queued: boolean) => {
    const answers = answerFacts(row.answers, t);
    return (
      <DisclosureRow
        key={row.id}
        leading={
          <span className="flex items-center gap-3">
            <Checkbox
              checked={selected.has(row.id)}
              onCheckedChange={() => toggle(row.id)}
              aria-label={t("managePeople.select", { name: row.full_name ?? String(row.email) })}
            />
            <NameAvatar name={row.full_name ?? String(row.email)} />
          </span>
        }
        title={row.full_name ?? String(row.email)}
        meta={
          <>
            {queued ? `#${index + 1}, ` : ""}
            {row.full_name ? `${String(row.email)}, ` : ""}
            {t("managePeople.registered")} <RelativeTime value={row.created_at} />
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              disabled={review.isPending}
              onClick={() => review.mutate({ id: row.id, decision: "approved" })}
            >
              {queued ? t("managePeople.approveAnyway") : t("managePeople.approve")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={review.isPending}
              confirm={{
                title: t("managePeople.declineTitle", { name: row.full_name ?? String(row.email) }),
                description: t("managePeople.declineBody"),
                label: t("deletions.decline"),
              }}
              onClick={() => review.mutate({ id: row.id, decision: "rejected" })}
            >
              {t("managePeople.declineButton")}
            </Button>
          </>
        }
      >
        {answers.length > 0 ? (
          <Facts facts={answers} className="pl-11" />
        ) : (
          <p className="pl-11 text-sm text-muted-fg">{t("managePeople.noAnswers")}</p>
        )}
      </DisclosureRow>
    );
  };

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

      <ErrorAlert error={error} title={t("managePeople.failed")} />

      {pending.length > 0 && (
        <Screen.Section
          id="waiting-for-review"
          title={t("managePeople.waiting")}
          description={t("managePeople.waitingHelp")}
          actions={
            <BulkReview eventId={event.id} ids={chosen} onDone={() => setSelected(new Set())} />
          }
        >
          <DisclosureList>
            {pending.map((row, index) => reviewRow(row, index, false))}
          </DisclosureList>
        </Screen.Section>
      )}

      {waitlist.length > 0 && (
        <Screen.Section
          id="waitlist"
          title={t("managePeople.waitlist")}
          description={t("managePeople.waitlistHelp")}
          actions={
            <BulkReview eventId={event.id} ids={chosen} onDone={() => setSelected(new Set())} />
          }
        >
          <DisclosureList>
            {waitlist.map((row, index) => reviewRow(row, index, true))}
          </DisclosureList>
        </Screen.Section>
      )}

      <Screen.Section
        id="in-this-event"
        title={t("managePeople.inEvent")}
        description={t("managePeople.count", { count: people.members.length })}
        actions={
          <>
            <OptSelect
              size="sm"
              ariaLabel={t("managePeople.show")}
              value={filter}
              options={[
                { value: "everyone", label: t("badges.everyone") },
                { value: "here", label: t("session.checkedIn") },
                { value: "absent", label: t("managePeople.notCheckedIn") },
              ]}
              onChange={setFilter}
            />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/events/$slug/badges" params={{ slug: event.slug }} />}
            >
              {t("managePeople.printBadges")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={exportHref(event.slug, "members")} download />}
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
                onDone={() => setPickedMembers(new Set())}
              />
            )}
            <div className="overflow-x-auto">
              <DataTable
                columns={memberColumns({
                  t,
                  roleLabel,
                  you: session.user.id,
                  divisions,
                  pluginRoleOptions,
                  arrival,
                  pending: setRole.isPending || place.isPending || remove.isPending,
                  onRole: (userId, role) => setRole.mutate({ userId, role }),
                  onDivision: (userId, divisionId) => place.mutate({ userId, divisionId }),
                  onExtraRoles: (userId, roles) => setExtraRoles.mutate({ userId, roles }),
                  onRemove: (userId) => remove.mutate(userId),
                })}
                data={shown}
                getRowId={(member) => member.userId}
                selection={{
                  selected: pickedMembers,
                  onChange: setPickedMembers,
                  label: (member) => member.name,
                }}
                empty={t("managePeople.noneShown")}
              />
            </div>
          </div>
        )}
      </Screen.Section>

      {waiting.length > 0 && (
        <Screen.Section
          id="invited"
          title={t("managePeople.invited")}
          description={t("managePeople.invitedHelp", { count: waiting.length, event: event.name })}
        >
          <DisclosureList>
            {waiting.map((row) => (
              <DisclosureRow
                key={row.id}
                leading={<NameAvatar name={String(row.email)} />}
                title={String(row.email)}
                meta={
                  <>
                    {t("managePeople.invitedAgo")} <RelativeTime value={row.created_at} />
                  </>
                }
                actions={<Badge variant="outline">{roleLabel(row.role)}</Badge>}
              />
            ))}
          </DisclosureList>
        </Screen.Section>
      )}

      <Overlaps eventId={event.id} />
      <PluginSettingSections page="people" />
    </Screen>
  );
}

type Member = EventPeople["members"][number];
type Division = { id: string; name: string };

const memberColumn = dataColumns<Member>();

function memberColumns(options: {
  t: T;
  roleLabel: (role: string) => string;
  you: string;
  divisions: Tuple<Division>;
  pluginRoleOptions: Tuple<SearchSelectOption>;
  arrival: ReadonlyMap<string, RosterEntry>;
  pending: boolean;
  onRole: (userId: string, role: EventRole) => void;
  onDivision: (userId: string, divisionId: string | undefined) => void;
  onExtraRoles: (userId: string, roles: string[]) => void;
  onRemove: (userId: string) => void;
}) {
  const { t } = options;
  return memberColumn.columns([
    memberColumn.accessor("name", {
      header: t("checkin.name"),
      cell: (info) => {
        const member = info.row.original;
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
    memberColumn.accessor("role", {
      header: t("managePeople.roleColumn"),
      cell: (info) => {
        const member = info.row.original;
        return (
          <div className="flex flex-col gap-1.5">
            <OptSelect
              size="sm"
              ariaLabel={t("members.roleFor", { name: member.name })}
              value={member.role}
              options={ROLES.map((role) => ({ value: role, label: options.roleLabel(role) }))}
              disabled={options.pending}
              onChange={(role) => options.onRole(member.userId, role)}
            />
            {options.pluginRoleOptions.length > 0 && (
              <div className="min-w-48">
                <label htmlFor={`extra-roles-${member.userId}`} className="sr-only">
                  {t("managePeople.extraRolesFor", { name: member.name })}
                </label>
                <MultiSelect
                  id={`extra-roles-${member.userId}`}
                  options={options.pluginRoleOptions}
                  value={member.extraRoles}
                  placeholder={t("managePeople.extraRoles")}
                  onValueChange={(roles) => options.onExtraRoles(member.userId, roles)}
                />
              </div>
            )}
          </div>
        );
      },
    }),
    memberColumn.accessor((member) => member.team ?? "", {
      id: "team",
      header: t("managePeople.teamColumn"),
      cell: (info) => <span className="text-muted-fg">{info.getValue() || "–"}</span>,
    }),
    ...(options.divisions.length > 0
      ? [
          memberColumn.accessor((member) => member.divisionId ?? "", {
            id: "division",
            header: t("managePeople.divisionColumn"),
            cell: (info) => {
              const member = info.row.original;
              if (member.role !== "participant") return <span className="text-muted-fg">–</span>;
              return (
                <OptSelect
                  size="sm"
                  ariaLabel={t("managePeople.divisionFor", { name: member.name })}
                  value={member.divisionId ?? NO_DIVISION}
                  options={[
                    { value: NO_DIVISION, label: t("checkin.noDivision") },
                    ...options.divisions.map((division) => ({
                      value: division.id,
                      label: division.name,
                    })),
                  ]}
                  disabled={options.pending}
                  onChange={(next) =>
                    options.onDivision(member.userId, next === NO_DIVISION ? undefined : next)
                  }
                />
              );
            },
          }),
        ]
      : []),
    memberColumn.accessor((member) => checkInText(options.arrival.get(member.userId), t) ?? "", {
      id: "checkin",
      header: t("managePeople.checkInColumn"),
      cell: (info) => (
        <span className="whitespace-nowrap text-muted-fg">{info.getValue() || "–"}</span>
      ),
    }),
    memberColumn.display({
      id: "actions",
      header: () => <span className="sr-only">{t("adminPeople.actions")}</span>,
      cell: (info) => {
        const member = info.row.original;
        const you = member.userId === options.you;
        return (
          <div className="-my-1.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={options.pending}
              confirm={{
                title: you
                  ? t("managePeople.removeSelfTitle")
                  : t("members.removeTitle", { name: member.name }),
                description: you
                  ? t("managePeople.removeSelfBody")
                  : t("managePeople.removeBody", { name: member.name }),
                label: t("twoFactor.remove"),
              }}
              onClick={() => options.onRemove(member.userId)}
            >
              {t("managePeople.removeButton")}
            </Button>
          </div>
        );
      },
    }),
  ]);
}

const KEEP = "keep";

// actions on every checked person at once; you're left out of role changes and removal
function BulkMembers({
  eventId,
  you,
  userIds,
  divisions,
  onDone,
}: {
  eventId: string;
  you: string;
  userIds: Tuple<string>;
  divisions: Tuple<Division>;
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
          ariaLabel={t("managePeople.bulkRole")}
          value={KEEP}
          disabled={busy || others.length === 0}
          options={[
            { value: KEEP, label: t("managePeople.bulkRole") },
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
            ariaLabel={t("managePeople.bulkDivision")}
            value={KEEP}
            disabled={busy}
            options={[
              { value: KEEP, label: t("managePeople.bulkDivision") },
              { value: NO_DIVISION, label: t("checkin.noDivision") },
              ...divisions.map((division) => ({ value: division.id, label: division.name })),
            ]}
            onChange={(next) => {
              if (next === KEEP) return;
              run.mutate(async (userId) =>
                unwrap(
                  await setDivisionFn({
                    data: {
                      eventId,
                      userId,
                      divisionId: next === NO_DIVISION ? undefined : next,
                    },
                  }),
                ),
              );
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
          {t("managePeople.removeButton")}
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
      <DisclosureList>
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
      </DisclosureList>
    </Screen.Section>
  );
}

function AnswerFile({ path, name }: { path: string; name: string }) {
  const t = useT();
  const open = useMutation({
    mutationFn: async () => {
      const { data, error } = await browserClient()
        .storage.from("registrations")
        .createSignedUrl(path, 60);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    },
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener");
    },
  });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={open.isPending}
        onClick={() => open.mutate()}
      >
        {t("managePeople.openFile", { name })}
      </Button>
      {open.error && <span className="text-danger">{open.error.message}</span>}
    </span>
  );
}

function answerValue(value: unknown, t: T): ReactNode | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
  if (Array.isArray(value)) {
    const items = value.filter((entry): entry is string => typeof entry === "string");
    return items.length ? items.join(", ") : null;
  }
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = { ...value };
    if (typeof record.path === "string" && typeof record.name === "string") {
      return <AnswerFile path={record.path} name={record.name} />;
    }
    if (record.accepted === true) {
      return typeof record.at === "string"
        ? t("managePeople.agreedOn", { date: record.at.slice(0, 10) })
        : t("managePeople.agreed");
    }
  }
  return null;
}

function answerFacts(answers: unknown, t: T): Fact[] {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];
  return Object.entries(answers).flatMap(([key, value]) => {
    const shown = answerValue(value, t);
    if (shown === null) return [];
    const label = key.replace(/[_-]+/g, " ");
    return [{ label: label[0]?.toUpperCase() + label.slice(1), value: shown }];
  });
}

function checkInText(entry: RosterEntry | undefined, t: T): string | undefined {
  if (!entry) return undefined;
  if (isCheckedIn(entry)) return t("session.checkedIn");
  return entry.checkedOutAt ? t("checkin.left") : t("managePeople.notCheckedIn");
}
