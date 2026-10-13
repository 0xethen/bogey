import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@bogey/ui/components/button";
import { DialogTrigger } from "@bogey/ui/components/dialog";
import { Screen } from "@bogey/ui/components/screen";
import { newAnnouncement } from "#/components/event/messaging/announcement-composer.tsx";
import { ANNOUNCEMENTS } from "#/components/event/messaging/announcements.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

const KEYS = ["toasts", "urgentStays", "postAs", "judges"] as const;

export const Route = createFileRoute("/_authed/events/$slug/manage/announcements")({
  staticData: {
    title: msg("announcements.title"),
    settings: (t) => [
      searchSection(t("settingsGroup.delivery"), { id: "announcements" }),
      ...searchSettings("announcements", KEYS, t),
    ],
  },
  loader: ({ context }) =>
    prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
      "announcements",
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  return (
    <Screen
      title={t("announcements.title")}
      description={t("announcements.manageIntro")}
      width="embedded"
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/events/$slug/messages"
                params={{ slug: event.slug }}
                search={{ c: ANNOUNCEMENTS }}
              />
            }
          >
            {t("announcements.all")}
          </Button>
          <DialogTrigger handle={newAnnouncement} render={<Button size="sm" />}>
            {t("announcements.new")}
          </DialogTrigger>
        </>
      }
    >
      <Screen.Section id="announcements" title={t("settingsGroup.delivery")}>
        <SettingFields scope={scope} namespace="announcements" keys={KEYS} />
      </Screen.Section>
      <PluginSettingSections page="announcements" />
    </Screen>
  );
}
