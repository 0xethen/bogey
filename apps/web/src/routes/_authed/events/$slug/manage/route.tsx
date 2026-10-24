import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCategory,
  IconCertificate,
  IconClipboardList,
  IconForms,
  IconGavel,
  IconHistory,
  IconHome,
  IconInbox,
  IconLayoutGrid,
  IconInfoCircle,
  IconListDetails,
  IconLayoutDashboard,
  IconLayoutNavbar,
  IconListCheck,
  IconMail,
  IconMessages,
  IconPlug,
  IconPresentation,
  IconPuzzle,
  IconShieldLock,
  IconSpeakerphone,
  IconTags,
  IconTrophy,
  IconUserCheck,
  IconUsers,
  IconUsersGroup,
  IconWebhook,
} from "@tabler/icons-react";
import { can } from "@bogey/db/permissions";
import { manageSummaryQueryOptions } from "@bogey/db/queries/manage";
import { eventConversationsQueryOptions } from "@bogey/db/queries/messages";
import { preferencesQueryOptions } from "@bogey/db/queries/preferences";
import { inEvent, manages, useEventViewer } from "#/lib/viewer.ts";
import { pluginAreaLinks } from "#/lib/plugins.ts";
import { PreviewGate } from "#/components/app/PreviewGate.tsx";
import {
  SettingsLayout,
  type SettingsGroup,
} from "#/components/settings/layout/settings-layout.tsx";
import type { SettingsSearchEntry } from "#/components/settings/layout/search-entries.ts";
import { pluginPageUrl, settingsSectionsOn } from "@bogey/plugins";
import { EventSwitcher } from "./-components/event-switcher.tsx";
import { msg, useT } from "#/lib/translate.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { Button } from "@bogey/ui/components/button";

export const Route = createFileRoute("/_authed/events/$slug/manage")({
  staticData: {
    title: msg("eventTab.manage"),
    command: { group: "Manage", when: inEvent(manages) },
  },
  beforeLoad: ({ context }) => {
    if (!can(context.access, "event.manage")) throw notFound();
    // throw Route.redirect({ to: "/events/$slug", params, replace: true });
  },
  loader: ({ context }) =>
    context.query.query({ ...preferencesQueryOptions(), staleTime: "static" }),
  component: RouteComponent,
  notFoundComponent: NotFoundComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, access, plugins } = Route.useRouteContext();
  const viewer = useEventViewer();
  const orgAdmin = access.orgAdmin;
  const summary = useQuery(manageSummaryQueryOptions(event.id));
  const conversations = useQuery(eventConversationsQueryOptions(event.id));
  const openQuestions = conversations.data?.filter((thread) => thread.status === "open").length;
  const activeConversations = conversations.data?.filter(
    (thread) => thread.status !== "closed",
  ).length;
  const base = `/events/${event.slug}/manage`;

  const groups: Tuple<SettingsGroup> = [
    {
      pages: [
        {
          key: "overview",
          label: t("adminTab.overview"),
          icon: IconLayoutDashboard,
          to: base,
          exact: true,
        },
        ...(orgAdmin
          ? [{ key: "audit", label: t("manageNav.audit"), icon: IconHistory, to: `${base}/audit` }]
          : []),
      ],
    },
    {
      label: t("manageNav.event"),
      pages: [
        { key: "details", label: t("details.title"), icon: IconInfoCircle, to: `${base}/details` },
        {
          key: "homepage",
          label: t("homepageSetup.title"),
          icon: IconHome,
          to: `${base}/homepage`,
        },
        {
          key: "pages",
          label: t("managePages.title"),
          icon: IconLayoutNavbar,
          to: `${base}/pages`,
        },
        {
          key: "agenda",
          label: t("eventTab.agenda"),
          icon: IconCalendarEvent,
          to: `${base}/agenda`,
          exact: true,
          sub: [
            {
              key: "agenda-sessions",
              label: t("manageAgenda.sessions"),
              icon: IconListDetails,
              to: `${base}/agenda/sessions`,
            },
            {
              key: "agenda-attendance",
              label: t("manageAgenda.attendance"),
              icon: IconUserCheck,
              to: `${base}/agenda/attendance`,
            },
          ],
        },
        {
          key: "security",
          label: t("security.title"),
          icon: IconShieldLock,
          to: `${base}/security`,
        },
        {
          key: "plugins",
          label: t("accountNav.plugins"),
          icon: IconPlug,
          to: `${base}/plugins`,
        },
      ],
    },
    {
      label: t("adminTab.people"),
      pages: [
        {
          key: "registration",
          label: t("manageNav.registration"),
          icon: IconClipboardList,
          to: `${base}/registration`,
          exact: true,
          sub: [
            {
              key: "registration-form",
              label: t("manageNav.registrationForm"),
              icon: IconForms,
              to: `${base}/registration/form`,
            },
          ],
        },
        {
          key: "people",
          label: t("adminTab.people"),
          icon: IconUsers,
          to: `${base}/people`,
          exact: true,
          sub: [
            {
              key: "review",
              label: t("manageNav.review"),
              icon: IconUserCheck,
              to: `${base}/people/review`,
              badge: summary.data?.pending,
              // registrations waiting on a decision need you, like unanswered messages
              badgeVariant: summary.data?.pending ? "default" : "text",
            },
          ],
        },
        ...(event.team_size_max > 1
          ? [{ key: "teams", label: t("facts.teams"), icon: IconUsersGroup, to: `${base}/teams` }]
          : []),
        {
          key: "divisions",
          label: t("manageNav.divisions"),
          icon: IconCategory,
          to: `${base}/divisions`,
          exact: true,
          sub: [
            { key: "tags", label: t("tags.title"), icon: IconTags, to: `${base}/divisions/tags` },
          ],
        },
      ],
    },
    {
      label: t("manageNav.competition"),
      pages: [
        {
          key: "submissions",
          label: t("window.submissions"),
          icon: IconInbox,
          to: `${base}/submissions`,
          exact: true,
          sub: [
            {
              key: "gallery",
              label: t("manageSubs.gallery"),
              icon: IconLayoutGrid,
              to: `${base}/submissions/gallery`,
            },
            {
              key: "forms",
              label: t("manageNav.forms"),
              icon: IconForms,
              to: `${base}/submissions/forms`,
            },
          ],
        },
        {
          key: "certificates",
          label: t("certificates.title"),
          icon: IconCertificate,
          to: `${base}/certificates`,
        },
        {
          key: "judging",
          label: t("judging.title"),
          icon: IconGavel,
          to: `${base}/judging`,
          exact: true,
          sub: [
            {
              key: "criteria",
              label: t("manageNav.criteria"),
              icon: IconListCheck,
              to: `${base}/judging/criteria`,
            },
            {
              key: "demos",
              label: t("manageNav.demos"),
              icon: IconPresentation,
              to: `${base}/judging/demos`,
            },
            {
              key: "results",
              label: t("manageNav.results"),
              icon: IconTrophy,
              to: `${base}/judging/results`,
            },
          ],
        },
      ],
    },
    {
      label: t("settingsGroup.communication"),
      pages: [
        {
          key: "announcements",
          label: t("announcements.title"),
          icon: IconSpeakerphone,
          to: `${base}/announcements`,
        },
        { key: "email", label: t("email.title"), icon: IconMail, to: `${base}/email` },
        { key: "webhooks", label: t("webhooks.title"), icon: IconWebhook, to: `${base}/webhooks` },
        {
          key: "messages",
          label: t("eventTab.messages"),
          icon: IconMessages,
          to: `${base}/messages`,
          // unanswered ones stand out; otherwise it counts the ones not closed yet
          badge: openQuestions || activeConversations,
          badgeVariant: openQuestions ? "default" : "text",
        },
      ],
    },
  ];
  const finds = (page: string): SettingsSearchEntry[] =>
    settingsSectionsOn(plugins, page).flatMap(({ manifest, section }) => [
      { label: section.title, description: manifest.name, hash: `${manifest.key}-${section.key}` },
      ...section.settings.flatMap((name) => {
        const setting = manifest.settings?.[name];
        return setting
          ? [
              {
                label: setting.label,
                description: setting.description,
                hash: `${manifest.key}.${name}`,
              },
            ]
          : [];
      }),
    ]);
  const withFinds = (group: SettingsGroup): SettingsGroup => ({
    ...group,
    pages: group.pages.map((page) => ({
      ...page,
      finds: finds(page.key),
      sub: page.sub?.map((sub) => ({ ...sub, finds: finds(sub.key) })),
    })),
  });
  const ownPages = plugins.flatMap((manifest) =>
    (manifest.settingsPages ?? [])
      .filter((page) => page.route === undefined)
      .map((page) => ({
        key: `${manifest.key}:${page.key}`,
        label: page.label,
        icon: IconPuzzle,
        to: pluginPageUrl(manifest, "manage", `/${page.key}`, event.slug),
        finds: finds(`${manifest.key}:${page.key}`),
      })),
  );
  const hostedFinds = (key: string, path: string): SettingsSearchEntry[] =>
    (plugins.find((manifest) => manifest.key === key)?.settingsPages ?? [])
      .filter((page) => page.route === path)
      .flatMap((page) => finds(`${key}:${page.key}`));
  const pluginPages = pluginAreaLinks(plugins, "manage", event.slug)
    .filter((page) => !page.permission || can(access, page.permission))
    .map(({ key, label, to, exact, pluginKey, path }) => ({
      key,
      label,
      to,
      exact,
      icon: IconPuzzle,
      finds: hostedFinds(pluginKey, path),
    }));
  const pluginGroup = [...ownPages, ...pluginPages];
  const allGroups: Tuple<SettingsGroup> = [
    ...groups.map(withFinds),
    ...(pluginGroup.length > 0 ? [{ label: t("accountNav.plugins"), pages: pluginGroup }] : []),
    {
      pages: [
        { key: "danger", label: t("danger.title"), icon: IconAlertTriangle, to: `${base}/danger` },
      ],
    },
  ];

  return (
    <PreviewGate allowed={viewer ? manages(viewer) : false}>
      <SettingsLayout
        label={t("manageNav.label")}
        // organizers' tables want the room; other settings layouts keep the cap
        className="max-w-none"
        header={<EventSwitcher event={event} orgAdmin={orgAdmin} />}
        groups={allGroups}
      >
        <Outlet />
      </SettingsLayout>
    </PreviewGate>
  );
}

function NotFoundComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();

  return (
    <Screen.Fallback
      icon={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-5"
        >
          <path d="M15 20l-6 -3l-6 3v-13l6 -3l6 3l6 -3v7.5" />
          <path d="M9 4v13" />
          <path d="M15 7v5.5" />
          <path d="M19 22v.01" />
          <path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
        </svg>
      }
      title={t("notFound.title")}
      description={t("notFound.body")}
    >
      <Screen.Actions>
        <Button render={<a href={`/events/${event.slug}/manage`} />} nativeButton={false}>
          {t("eventTab.manage")}
        </Button>
        <Button variant="outline" render={<a href="/" />} nativeButton={false}>
          {t("notFound.home")}
        </Button>
      </Screen.Actions>
    </Screen.Fallback>
  );
}
