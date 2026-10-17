import { TimeFormatProvider, useTimeFormat } from "@bogey/ui/lib/time-format";
import { useEventTimeFormat } from "#/lib/time.ts";
import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { eventQueryOptions } from "@bogey/db/queries/events";
import { eventPagesQueryOptions } from "@bogey/db/queries/pages";
import { identitySetupPendingQueryOptions, isPending } from "@bogey/db/queries/identity-setup";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { eventAccessQueryOptions } from "@bogey/db/permissions";
import { RouteTabs } from "#/components/navigation/header/TabRow.tsx";
import { arrangeTabs, eventTabs, visibleTabs } from "#/lib/event-tabs.ts";
import { orNotFound } from "#/lib/routing.ts";
import { agendaMilestones } from "#/lib/windows.ts";
import { manages, useEventViewer } from "#/lib/viewer.ts";
import { mayAnnounce } from "#/lib/messaging.ts";
import { enabledPlugins, missingPlugins, pluginSettingsQueryOptions } from "#/lib/plugins.ts";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { IconPlugConnectedX, IconWifiOff } from "@tabler/icons-react";
import { eventWrapperPlugins, PluginEventWrappers } from "./-components/plugin-event-wrappers.tsx";
import { NewAnnouncementDialog } from "#/components/event/messaging/announcement-composer.tsx";
import { AnnouncementToasts } from "./-components/announcement-toasts.tsx";
import { PluginHotkeys } from "./-components/plugin-hotkeys.tsx";
import { networkStatusQueryOptions, settingsQueryOptions } from "@bogey/db/queries/settings";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug")({
  staticData: {
    title: msg("event.title"),
    header: { type: "nav", nav: EventTabs },
    command: { group: ({ event }) => event?.event.name ?? msg("event.title") },
  },
  beforeLoad: async ({ context, params, location }) => {
    const org = context.session.org;
    if (!org) throw notFound();
    const event = await orNotFound(
      context.query.fetchQuery(eventQueryOptions(org.id, params.slug)),
    );
    const [access, windows, settings, agenda] = await Promise.all([
      context.query.fetchQuery(eventAccessQueryOptions(event.id)),
      context.query.fetchQuery(eventWindowsQueryOptions(event.id)),
      context.query.fetchQuery(
        settingsQueryOptions({ eventId: event.id }, [
          "plugins",
          "chat",
          "schedule",
          "announcements",
          "tabs",
        ]),
      ),
      context.query.ensureQueryData(agendaQueryOptions(event.id)),
      context.query.ensureQueryData(eventPagesQueryOptions(event.id)),
    ]);
    const plugins = enabledPlugins(settings.plugins);
    const checkSetup = access.role === "participant" && !location.pathname.endsWith("/welcome");
    const [pending, shownWhen] = await Promise.all([
      checkSetup ? context.query.fetchQuery(identitySetupPendingQueryOptions(event.id)) : null,
      Promise.all(
        plugins
          .filter((plugin) => plugin.routes?.some((route) => route.showWhen))
          .map(async (plugin) => [
            plugin.key,
            await context.query.ensureQueryData(pluginSettingsQueryOptions(event.id, plugin.key)),
          ]),
      ),
      ...eventWrapperPlugins(plugins).map((plugin) =>
        context.query.ensureQueryData(pluginSettingsQueryOptions(event.id, plugin.key)),
      ),
    ]);
    if (pending && isPending(pending)) {
      throw Route.redirect({ to: "/events/$slug/welcome", params, replace: true });
    }
    const pluginSettings = Object.fromEntries(shownWhen);
    return {
      event,
      access,
      windows,
      plugins,
      pluginSettings,
      missing: missingPlugins(settings.plugins),
      chat: settings.chat,
      announcements: settings.announcements,
      tabs: settings.tabs.items,
      countdownLabel: settings.schedule.countdownLabel?.trim() || null,
      hasAgenda: agenda.slots.length > 0 || agendaMilestones(windows, settings.schedule).length > 0,
    };
  },
  loader: ({ context: { event } }) => ({
    title: { page: event.name, breadcrumb: event.short_name ?? event.name },
  }),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { event, plugins, session, missing, announcements } = Route.useRouteContext();
  const viewer = useEventViewer();
  const time = useEventTimeFormat(useTimeFormat(), event);
  const { data: network } = useQuery({
    ...networkStatusQueryOptions(event.id),
    enabled: viewer?.access.role === "participant",
  });
  return (
    <TimeFormatProvider value={time}>
      {network?.restricted && !network.allowed && (
        <Alert variant="destructive" className="mx-auto mt-4 max-w-5xl">
          <IconWifiOff />
          <AlertTitle>{t("event.networkTitle")}</AlertTitle>
          <AlertDescription>{t("event.networkBody")}</AlertDescription>
        </Alert>
      )}
      {missing.length > 0 && <MissingPlugins missing={missing} slug={event.slug} />}
      <PluginEventWrappers plugins={plugins} eventId={event.id} session={session}>
        <Outlet />
      </PluginEventWrappers>
      {viewer && announcements.toasts && (
        <AnnouncementToasts
          eventId={event.id}
          slug={event.slug}
          urgentStays={announcements.urgentStays}
        />
      )}
      {viewer && <PluginHotkeys viewer={viewer} />}
      {viewer && mayAnnounce(viewer.access, announcements) && (
        <NewAnnouncementDialog
          eventId={event.id}
          timeZone={event.timezone}
          anonymous={announcements.postAs === "organizers"}
          manager={manages(viewer)}
        />
      )}
    </TimeFormatProvider>
  );
}

function EventTabs() {
  const t = useT();
  const viewer = useEventViewer();
  const loaded = Route.useMatch({
    shouldThrow: false,
    select: (match) => (match.status === "success" ? match.context.tabs : undefined),
  });
  // the query follows Manage → Tabs as it saves; the loaded value covers the first paint
  const saved = useQuery({
    ...settingsQueryOptions({ eventId: viewer?.event.id ?? "" }, ["tabs"]),
    enabled: !!viewer,
  });
  const tabs = saved.data?.tabs.items ?? loaded;
  const pages = useQuery({
    ...eventPagesQueryOptions(viewer?.event.id ?? ""),
    enabled: !!viewer,
  });
  // live, so a tab kept to a window comes and goes as it opens and closes
  const windows = useQuery({
    ...eventWindowsQueryOptions(viewer?.event.id ?? ""),
    enabled: !!viewer,
  });
  if (!viewer) return null;
  const all = eventTabs(
    viewer.event.slug,
    viewer.plugins,
    viewer.pluginSettings,
    pages.data ?? [],
    t,
  );
  return (
    <RouteTabs
      tabs={visibleTabs(arrangeTabs(all, tabs ?? []), {
        ...viewer,
        windows: windows.data ?? viewer.windows,
      })}
    />
  );
}

function MissingPlugins({
  missing,
  slug,
}: {
  missing: Tuple<{ key: string; reason: string }>;
  slug: string;
}) {
  const t = useT();
  const viewer = useEventViewer();
  const organizer = viewer ? manages(viewer) : false;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
      <Alert dismissable={!organizer}>
        <IconPlugConnectedX />
        <AlertTitle>
          {organizer ? t("event.missingTitle") : t("event.missingTitlePublic")}
        </AlertTitle>
        <AlertDescription>
          {organizer ? (
            <>
              <ul className="list-disc pl-4">
                {missing.map((each) => (
                  <li key={each.key}>
                    <code>{each.key}</code> {each.reason}.
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                {t("event.missingHelp")}{" "}
                <Link to="/events/$slug/manage/plugins" params={{ slug }} className="link">
                  {t("event.managePlugins")}
                </Link>
                .
              </p>
            </>
          ) : (
            t("event.missingPublic")
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
