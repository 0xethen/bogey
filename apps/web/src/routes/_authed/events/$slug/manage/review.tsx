import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { eventInviteLinksQueryOptions } from "@bogey/db/queries/invites";
import {
  eventPeopleQueryOptions,
  reviewRegistrationFn,
  type EventPeople,
} from "@bogey/db/queries/manage";
import { useLiveInvalidate } from "@bogey/db/realtime";
import { browserClient } from "@bogey/db/browser";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { Badge } from "@bogey/ui/components/badge";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import {
  createDialogHandle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { Facts, type Fact } from "@bogey/ui/components/facts";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { useRoleLabel } from "#/lib/roles.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { BulkReview } from "./-components/bulk-review.tsx";
import { fromLink, usePeopleMutation } from "./-components/people-shared.ts";

export const Route = createFileRoute("/_authed/events/$slug/manage/review")({
  staticData: {
    title: msg("manageNav.review"),
    settings: (t) => [
      searchSection(t("managePeople.waiting"), {
        keywords: ["approve", "pending"],
        id: "waiting-for-review",
      }),
      searchSection(t("managePeople.waitlist"), { id: "waitlist" }),
      searchSection(t("managePeople.invited"), { id: "invited" }),
    ],
  },
  validateSearch: z.object({ link: z.uuid().optional().catch(undefined) }),
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventInviteLinksQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPeopleQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

type Registration = EventPeople["registrations"][number];
type Decision = { id: string; decision: "approved" | "rejected" };

const viewAnswers = createDialogHandle<Registration>();

function RouteComponent() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const { event } = Route.useRouteContext();
  const { link: linkId } = Route.useSearch();
  const { data: everyone } = useSuspenseQuery(eventPeopleQueryOptions(event.id));
  const { data: links } = useSuspenseQuery(eventInviteLinksQueryOptions(event.id));
  const link = linkId ? links.find((each) => each.id === linkId) : undefined;
  const people = link ? fromLink(everyone, link.id) : everyone;
  useLiveInvalidate("registrations", eventPeopleQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });

  const review = usePeopleMutation(event.id, async (input: Decision) =>
    unwrap(
      await reviewRegistrationFn({
        data: { registrationId: input.id, decision: input.decision },
      }),
    ),
  );
  const pending = people.registrations.filter((row) => row.status === "pending");
  const waitlist = people.registrations
    .filter((row) => row.status === "waitlisted")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const waiting = people.registrations.filter((row) => row.status === "approved" && !row.user_id);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const chosen = [...selected].filter((id) =>
    people.registrations.some(
      (row) => row.id === id && ["pending", "waitlisted"].includes(row.status),
    ),
  );
  const onReview = review.mutate;
  // answers opened this visit, so their button fades to outline
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const open = useCallback((row: Registration) => {
    setSeen((prev) => new Set(prev).add(row.id));
    viewAnswers.openWithPayload(row);
  }, []);

  return (
    <Screen
      title={t("manageNav.review")}
      width="embedded"
      description={
        link && (
          <>
            {link.label
              ? t("managePeople.showingLink", { label: link.label })
              : t("managePeople.showingOneLink")}{" "}
            <Link to="/events/$slug/manage/review" params={{ slug: event.slug }}>
              {t("managePeople.showEveryone")}
            </Link>
          </>
        )
      }
    >
      <ErrorAlert error={review.error} title={t("managePeople.failed")} />

      {pending.length === 0 && waitlist.length === 0 && waiting.length === 0 && (
        <p className="text-sm text-muted-fg">{t("managePeople.nothingToReview")}</p>
      )}

      {pending.length > 0 && (
        <Screen.Section
          id="waiting-for-review"
          title={t("managePeople.waiting")}
          description={t("managePeople.waitingHelp")}
          actions={
            <BulkReview eventId={event.id} ids={chosen} onDone={() => setSelected(new Set())} />
          }
        >
          <ReviewTable
            rows={pending}
            queued={false}
            selected={selected}
            onSelect={setSelected}
            seen={seen}
            onOpen={open}
          />
        </Screen.Section>
      )}

      {waitlist.length > 0 && (
        <Screen.Section
          id="waitlist"
          title={t("managePeople.waitlist")}
          description={
            <Linked
              text={t("managePeople.waitlistHelp", { autoPromote: LINK })}
              links={[
                <SettingLink
                  key="autoPromote"
                  to={`/events/${event.slug}/manage/registration`}
                  hash="registration.autoPromote"
                >
                  {t("path.autoPromote")}
                </SettingLink>,
              ]}
            />
          }
          actions={
            <BulkReview eventId={event.id} ids={chosen} onDone={() => setSelected(new Set())} />
          }
        >
          <ReviewTable
            rows={waitlist}
            queued
            selected={selected}
            onSelect={setSelected}
            seen={seen}
            onOpen={open}
          />
        </Screen.Section>
      )}

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

      <AnswersDialog busy={review.isPending} onReview={onReview} />
      <PluginSettingSections page="review" />
    </Screen>
  );
}

const registrationColumn = dataColumns<Registration>();

const nameOf = (row: Registration) => row.full_name ?? String(row.email);

function ReviewTable({
  rows,
  queued,
  selected,
  onSelect,
  seen,
  onOpen,
}: {
  rows: Tuple<Registration>;
  queued: boolean;
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  seen: ReadonlySet<string>;
  onOpen: (row: Registration) => void;
}) {
  const t = useT();
  const columns = useMemo(
    () =>
      registrationColumn.columns([
        ...(queued
          ? [
              registrationColumn.accessor(
                (row) => rows.findIndex((each) => each.id === row.id) + 1,
                {
                  id: "position",
                  header: t("managePeople.positionColumn"),
                  cell: (info) => <span className="text-muted-fg">#{info.getValue()}</span>,
                },
              ),
            ]
          : []),
        registrationColumn.accessor(nameOf, {
          id: "name",
          header: t("checkin.name"),
          cell: (info) => {
            const row = info.row.original;
            return (
              <span className="flex min-w-48 items-center gap-3">
                <NameAvatar name={info.getValue()} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{info.getValue()}</span>
                  {row.full_name && (
                    <span className="break-all text-xs text-muted-fg">{String(row.email)}</span>
                  )}
                </span>
              </span>
            );
          },
        }),
        registrationColumn.accessor("created_at", {
          header: t("managePeople.registeredColumn"),
          cell: (info) => (
            <span className="whitespace-nowrap text-muted-fg">
              <RelativeTime value={info.getValue()} />
            </span>
          ),
        }),
        registrationColumn.display({
          id: "actions",
          header: () => <span className="sr-only">{t("adminPeople.actions")}</span>,
          cell: (info) => {
            const row = info.row.original;
            return (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant={seen.has(row.id) ? "outline" : "secondary"}
                  aria-label={t("managePeople.viewAnswersFor", { name: nameOf(row) })}
                  onClick={() => onOpen(row)}
                >
                  {t("managePeople.viewAnswers")}
                </Button>
              </div>
            );
          },
        }),
      ]),
    [t, queued, rows, seen, onOpen],
  );
  return (
    <div className="overflow-x-auto">
      <DataTable
        columns={columns}
        data={[...rows]}
        getRowId={(row) => row.id}
        selection={{ selected, onChange: onSelect, label: nameOf }}
        pageSize={25}
      />
    </div>
  );
}

// a registration's answers, with the decision beside them
function AnswersDialog({ busy, onReview }: { busy: boolean; onReview: (input: Decision) => void }) {
  const t = useT();
  return (
    <Dialog handle={viewAnswers}>
      {({ payload }) => {
        const answers = payload ? answerFacts(payload.answers, t) : [];
        return (
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{payload ? nameOf(payload) : t("managePeople.viewAnswers")}</DialogTitle>
              <DialogDescription>
                {payload?.full_name ? String(payload.email) : t("managePeople.answersHelp")}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[60dvh] overflow-y-auto scrollbar-thin">
              {answers.length > 0 ? (
                <Facts facts={answers} />
              ) : (
                <p className="text-sm text-muted-fg">{t("managePeople.noAnswers")}</p>
              )}
            </div>
            {payload && (
              <DialogFooter>
                <DialogClose
                  render={
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onReview({ id: payload.id, decision: "rejected" })}
                    />
                  }
                >
                  {t("managePeople.declineButton")}
                </DialogClose>
                <DialogClose
                  render={
                    <Button
                      disabled={busy}
                      onClick={() => onReview({ id: payload.id, decision: "approved" })}
                    />
                  }
                >
                  {t("managePeople.approve")}
                </DialogClose>
              </DialogFooter>
            )}
          </DialogContent>
        );
      }}
    </Dialog>
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
