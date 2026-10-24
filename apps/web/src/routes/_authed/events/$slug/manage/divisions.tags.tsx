import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { tagsQueryOptions } from "@bogey/db/queries/tags";
import { isOrgAdmin } from "@bogey/db/auth";
import { Screen } from "@bogey/ui/components/screen";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";
import { TagBadge, TagsEditor } from "#/components/tags/tags.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/divisions/tags")({
  staticData: {
    title: msg("tags.title"),
    settings: (t) => [
      searchSection(t("tags.title"), { keywords: ["labels", "judge types"], id: "tags" }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...tagsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }),
        staleTime: "static",
      }),
      context.query.query({
        ...settingsQueryOptions({ eventId: context.event.id }, ["tags"]),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event, session } = Route.useRouteContext();
  const scope = { orgId: event.org_id, eventId: event.id };
  const { data: tags } = useSuspenseQuery(tagsQueryOptions(scope));
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["tags"]),
  );
  const eventTags = settings.tags.eventTags;
  const fromOrg = tags.filter((tag) => !tag.event_id);

  return (
    <Screen title={t("tags.title")} width="embedded">
      <Screen.Section
        id="tags"
        title={t("tags.eventTitle")}
        description={eventTags ? t("tags.eventIntro") : t("tags.eventsOff")}
      >
        {eventTags && <TagsEditor scope={scope} />}
      </Screen.Section>

      {fromOrg.length > 0 && (
        <Screen.Section
          id="org-tags"
          title={t("tags.fromOrg")}
          description={
            isOrgAdmin(session) ? (
              <a href="/org/members" className="link">
                {t("tags.editInOrg")}
              </a>
            ) : (
              t("tags.orgReadOnly")
            )
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {fromOrg.map((tag) => (
              <TagBadge key={tag.id} tag={tag} />
            ))}
          </div>
        </Screen.Section>
      )}
      <PluginSettingSections page="tags" />
    </Screen>
  );
}
