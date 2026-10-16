import { useRoleLabel } from "#/lib/roles.ts";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { useT } from "#/lib/translate.tsx";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconCheck, IconLayoutDashboard, IconPencil } from "@tabler/icons-react";
import { DEFAULT_HOME_LAYOUT, homeLayoutSchema, type HomeLayout } from "@bogey/config/settings";
import { eventWindowsQueryOptions } from "@bogey/db/queries/windows";
import { eventPagesQueryOptions } from "@bogey/db/queries/pages";
import {
  announcementsTopic,
  eventAnnouncementsQueryOptions,
} from "@bogey/db/queries/announcements";
import { can, useEventAccess } from "@bogey/db/permissions";
import { useLiveBroadcast, useLiveInvalidate } from "@bogey/db/realtime";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { loadPluginRuntime } from "@bogey/plugins";
import { formatDateRange } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { useDraft, useUnsavedState } from "#/components/unsaved-changes/index.tsx";
import { GalleryLink } from "#/components/event/gallery-link.tsx";
import { HomeBlockView, type HomeData } from "./-components/home/blocks.tsx";
import { HomeEditor } from "./-components/home/editor.tsx";
import { pluginSettingsQueryOptions, sessionKindsWithPlugins } from "#/lib/plugins.ts";
import { useSettingsMutation } from "#/lib/settings.ts";

const homeSettings = (eventId: string) =>
  settingsQueryOptions({ eventId }, ["about", "agenda", "home", "schedule", "venue"]);

export const Route = createFileRoute("/_authed/events/$slug/")({
  staticData: { command: { label: "Home" } },
  validateSearch: z.object({
    customize: z
      .union([z.literal(""), z.boolean()])
      .optional()
      .catch(undefined),
  }),
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(eventWindowsQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventPagesQueryOptions(context.event.id)),
      context.query.ensureQueryData(eventAnnouncementsQueryOptions(context.event.id)),
      context.query.ensureQueryData(homeSettings(context.event.id)),
      ...context.plugins.flatMap((manifest) => [
        loadPluginRuntime(manifest.key).then(() => null),
        context.query.ensureQueryData(pluginSettingsQueryOptions(context.event.id, manifest.key)),
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="wide" layout="columns" />,
});

function sameLayout(a: HomeLayout, b: HomeLayout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function RouteComponent() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const time = useTimeFormat();
  const { event, plugins, session } = Route.useRouteContext();
  const { customize } = Route.useSearch();
  const navigate = Route.useNavigate();
  const access = useEventAccess();
  const { data: windows } = useSuspenseQuery(eventWindowsQueryOptions(event.id));
  const { data: pages } = useSuspenseQuery(eventPagesQueryOptions(event.id));
  const { data: announcements } = useSuspenseQuery(eventAnnouncementsQueryOptions(event.id));
  useLiveInvalidate("announcements", eventAnnouncementsQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  useLiveBroadcast(announcementsTopic(event.id), eventAnnouncementsQueryOptions(event.id).queryKey);
  useLiveInvalidate("event_windows", eventWindowsQueryOptions(event.id).queryKey, {
    filter: `event_id=eq.${event.id}`,
  });
  const { data: settings } = useSuspenseQuery(homeSettings(event.id));
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));

  const role = access?.orgAdmin ? "organizer" : access?.role;
  const manages = can(access, "event.manage");
  const customizing = manages && customize !== undefined && customize !== false;

  const unsaved = useUnsavedState();
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "home");
  const [layout, setLayout] = useDraft(
    settings.home.layout,
    async (next) => {
      if (!homeLayoutSchema.safeParse(next).success) return false;
      try {
        await save.mutateAsync({ layout: next });
        return true;
      } catch {
        return false;
      }
    },
    sameLayout,
  );

  const data: HomeData = {
    event,
    access,
    session,
    plugins,
    windows,
    pages,
    announcements,
    agenda,
    kinds: sessionKindsWithPlugins(settings.agenda.kinds, plugins),
    schedule: settings.schedule,
    venue: settings.venue,
    about: settings.about.body ?? "",
    competes: !role || role === "participant",
    manages,
  };
  const finishCustomizing = async () => {
    if (unsaved?.dirty && !(await unsaved.save())) return;
    setCustomize(false);
  };
  const setCustomize = (on: boolean) =>
    void navigate({
      search: { customize: on ? true : undefined },
      replace: true,
      resetScroll: false,
    });

  return (
    <Screen
      width="wide"
      title={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {event.name}
          {role && (
            <Badge variant="secondary" className="font-sans tracking-normal">
              {roleLabel(role)}
            </Badge>
          )}
        </span>
      }
      description={
        customizing ? (
          <>
            {t("home.customizeHint", { pencil: "\u0000" })
              .split("\u0000")
              .flatMap((part, index) =>
                index === 0
                  ? [part]
                  : [<IconPencil key="pencil" className="inline-block align-top size-4" />, part],
              )}
          </>
        ) : (
          [formatDateRange(event.starts_at, event.ends_at, time), event.location]
            .filter(Boolean)
            .join(", ")
        )
      }
      actions={
        customizing ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={sameLayout(layout, DEFAULT_HOME_LAYOUT)}
              confirm={{
                title: t("home.resetTitle"),
                description: t("home.resetBody"),
                label: t("home.useDefault"),
              }}
              onClick={() => setLayout(DEFAULT_HOME_LAYOUT)}
            >
              {t("home.reset")}
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => void finishCustomizing()}>
              <IconCheck />
              {t("home.done")}
            </Button>
          </>
        ) : (
          <>
            <GalleryLink event={event} />
            {manages && (
              <Button size="sm" variant="ghost" onClick={() => setCustomize(true)}>
                <IconLayoutDashboard />
                {t("home.customize")}
              </Button>
            )}
            {manages && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/events/$slug/manage" params={{ slug: event.slug }} />}
              >
                {t("home.manage")}
              </Button>
            )}
          </>
        )
      }
    >
      <ErrorAlert error={save.error} title={t("home.saveFailed")} />
      {customizing ? (
        <HomeEditor layout={layout} onChange={setLayout} data={data} />
      ) : (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-10">
            {layout.main.map((block) => (
              <HomeBlockView key={block.id} block={block} data={data} />
            ))}
          </div>
          <aside className="flex min-w-0 flex-col gap-10">
            {layout.aside.map((block) => (
              <HomeBlockView key={block.id} block={block} data={data} />
            ))}
          </aside>
        </div>
      )}
    </Screen>
  );
}
