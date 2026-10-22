import { Suspense } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { setViewAs, useViewAs, VIEW_AS_ROLES } from "@bogey/db/permissions";
import { useSuspenseQuery } from "@tanstack/react-query";
import { manageSummaryQueryOptions } from "@bogey/db/queries/manage";
import { eventWindowsQueryOptions, windowByKey } from "@bogey/db/queries/windows";
import { Button } from "@bogey/ui/components/button";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { Steps, type Step } from "#/components/event/submission/steps.tsx";
import {
  IconClockHour4,
  IconFileCheck,
  IconGavel,
  IconMessageQuestion,
  IconUser,
  IconUsersGroup,
} from "@tabler/icons-react";
import { LinkRow } from "@bogey/ui/components/link-row";
import { eventConversationsQueryOptions } from "@bogey/db/queries/messages";
// import { newAnnouncement } from "#/components/event/messaging/announcement-composer.tsx";
// import { DialogTrigger } from "@bogey/ui/components/dialog";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";
import { PluginSlot } from "#/components/plugins/plugin-slot.tsx";
import { VisibilityPicker } from "./-components/visibility-picker.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/")({
  staticData: {
    title: msg("adminTab.overview"),
    settings: (t) => [
      searchSection(t("overview.needsYou"), { id: "needs-you" }),
      searchSection(t("overview.glance"), { id: "at-a-glance" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(manageSummaryQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventConversationsQueryOptions(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const VIEW_AS: Tuple<{ value: "self" | (typeof VIEW_AS_ROLES)[number]; label: PlainKey }> = [
  { value: "self", label: "overview.viewAsYou" },
  { value: "participant", label: "overview.viewAsParticipant" },
  { value: "judge", label: "overview.viewAsJudge" },
  { value: "staff", label: "overview.viewAsStaff" },
];

function RouteComponent() {
  const t = useT();
  const { event, plugins, session } = Route.useRouteContext();
  const { data: summary } = useSuspenseQuery(manageSummaryQueryOptions(event.id));
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: questions } = useSuspenseQuery(eventConversationsQueryOptions(event.id));
  const previewing = useViewAs();
  const navigate = useNavigate();
  const openQuestions = questions.filter((thread) => thread.status === "open").length;

  const registration = windowByKey(windows, "registration");
  const params = { slug: event.slug };
  const open = (
    to: "details" | "agenda" | "people",
    label: string,
    variant: React.ComponentProps<typeof Button>["variant"] = "secondary",
  ) => (
    <Button
      size="sm"
      variant={variant}
      nativeButton={false}
      render={<Link to={`/events/$slug/manage/${to}`} params={params} />}
    >
      {label}
    </Button>
  );
  const steps: Step[] = [
    {
      key: "dates",
      title: t("overview.datesTitle"),
      done: !!event.starts_at && !!event.ends_at,
      description: t("overview.datesHelp"),
      actions: [
        open("details", t("overview.editDetails")),
        open("agenda", t("overview.editAgenda"), "outline"),
      ],
    },
    {
      key: "registration",
      title: t("overview.regTitle"),
      done: !!registration && (!!registration.opens_at || !!registration.override),
      description: t("overview.regHelp"),
      actions: [open("agenda", t("overview.openAgenda"))],
    },
    {
      key: "people",
      title: t("overview.peopleTitle"),
      done: summary.judges + summary.staff + summary.organizers > 0,
      description: t("overview.peopleHelp"),
      actions: [open("people", t("overview.addPeople"))],
    },
    {
      key: "publish",
      title: t("overview.publishTitle"),
      done: event.visibility === "public",
      description: t("overview.publishHelp"),
      actions: [<VisibilityPicker key="visibility" event={event} />],
    },
  ];
  const setupDone = steps.every((step) => step.done);

  const attention = [
    summary.pending > 0 && (
      <LinkRow
        key="pending"
        render={<Link to="/events/$slug/manage/review" params={params} />}
        leading={<IconClockHour4 className="size-5 text-warning" />}
        title={t("overview.registrationsWaiting", { count: summary.pending })}
        meta={t("overview.registrationsHelp")}
      />
    ),
    openQuestions > 0 && (
      <LinkRow
        key="messages"
        render={<Link to="/events/$slug/messages" params={params} />}
        leading={<IconMessageQuestion className="size-5 text-warning" />}
        title={t("overview.conversationsWaiting", { count: openQuestions })}
        meta={t("overview.conversationsHelp")}
      />
    ),
  ].filter(Boolean);

  return (
    <Screen
      title={t("adminTab.overview")}
      width="embedded"
      actions={
        <OptSelect
          size="sm"
          ariaLabel={t("nav.viewAs")}
          value={previewing ?? "self"}
          options={VIEW_AS.map((each) => ({ ...each, label: t(each.label) }))}
          onChange={(next) => {
            const role = VIEW_AS_ROLES.find((candidate) => candidate === next) ?? null;
            setViewAs(role);
            if (role) void navigate({ to: "/events/$slug", params });
          }}
        />
      }
    >
      {!setupDone && <Steps title={t("overview.setup")} steps={steps} />}

      <Screen.Section id="needs-you" title={t("overview.needsYou")}>
        {attention.length > 0 ? (
          <div className="flex flex-col">{attention}</div>
        ) : (
          <p className="text-sm text-muted-fg">{t("overview.nothing")}</p>
        )}
      </Screen.Section>

      <Screen.Section id="at-a-glance" title={t("overview.glance")}>
        <StatGroup>
          <Stat icon={IconUser} label={t("badges.participants")} value={summary.participants} />
          {event.team_size_max > 1 && (
            <Stat icon={IconUsersGroup} label={t("facts.teams")} value={summary.teams} />
          )}
          <Stat icon={IconFileCheck} label={t("overview.submitted")} value={summary.submitted} />
          <Stat icon={IconGavel} label={t("overview.judges")} value={summary.judges} />
        </StatGroup>
      </Screen.Section>

      {plugins.map((plugin) => (
        <Suspense key={plugin.key} fallback={null}>
          <PluginSlot pluginKey={plugin.key} eventId={event.id}>
            {({ slots, settings }) => {
              const Panel = slots.manageOverview;
              return Panel ? (
                <Panel eventId={event.id} settings={settings} session={session} />
              ) : null;
            }}
          </PluginSlot>
        </Suspense>
      ))}
    </Screen>
  );
}
