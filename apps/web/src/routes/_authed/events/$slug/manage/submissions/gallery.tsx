import { createFileRoute } from "@tanstack/react-router";
import { Screen } from "@bogey/ui/components/screen";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

const GALLERY_KEYS = [
  "banners",
  "teamBanners",
  "teamSizes",
  "winners",
  "likes",
  "comments",
  "sort",
  "slideshow",
] as const;

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions/gallery")({
  staticData: {
    title: msg("manageSubs.gallery"),
    settings: (t) => [
      searchSection(t("manageSubs.gallery"), {
        keywords: ["banner", "likes", "comments"],
        id: "gallery",
      }),
      ...searchSettings("gallery", GALLERY_KEYS, t),
    ],
  },
  loader: ({ context }) =>
    prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
      "gallery",
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  return (
    <Screen
      title={t("manageSubs.gallery")}
      description={t("manageSubs.galleryHelp")}
      width="embedded"
    >
      <SettingFields
        scope={{ scope: "event", eventId: event.id }}
        namespace="gallery"
        keys={GALLERY_KEYS}
      />
    </Screen>
  );
}
