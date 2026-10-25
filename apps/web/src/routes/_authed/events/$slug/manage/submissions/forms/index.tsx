import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { submissionFormsQueryOptions } from "@bogey/db/queries/submissions";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { Button } from "@bogey/ui/components/button";
import { LinkRow, RowList } from "@bogey/ui/components/row";
import { Screen } from "@bogey/ui/components/screen";
import { IconPlus } from "@tabler/icons-react";
import { windowLabel } from "#/lib/windows.ts";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/submissions/forms/")({
  staticData: {
    title: msg("manageNav.forms"),
    settings: (t) => [
      searchSection(t("manageForms.submitting"), { id: "submitting-and-deleting" }),
      ...searchSettings(
        "submissions",
        ["autoSubmit", "deletion", "submittedTitle", "submittedBody"],
        t,
      ),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...submissionFormsQueryOptions(context.event.id),
        staleTime: "static",
      }),
      context.query.query({ ...eventDivisionsQueryOptions(context.event.id), staleTime: "static" }),
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "submissions",
      ]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(event.id));
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(event.id));
  const audience = (ids: Tuple<string>) =>
    ids.length === 0
      ? ""
      : ` · ${t("manageForms.forDivisions", {
          names: divisions
            .filter((division) => ids.includes(division.id))
            .map((division) => division.name)
            .join(", "),
        })}`;

  return (
    <Screen
      title={t("manageNav.forms")}
      description={t("manageForms.intro")}
      width="embedded"
      actions={
        <Button
          size="sm"
          variant="outline"
          render={
            <Link to="/events/$slug/manage/submissions/forms/new" params={{ slug: event.slug }} />
          }
          nativeButton={false}
        >
          <IconPlus />
          {t("manageForms.new")}
        </Button>
      }
    >
      {forms.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("manageForms.none")}</p>
      ) : (
        <RowList>
          {forms.map((form) => (
            <LinkRow
              key={form.id}
              render={
                <Link
                  to="/events/$slug/manage/submissions/forms/$formId"
                  params={{ slug: event.slug, formId: form.id }}
                />
              }
              title={form.title}
              meta={`${t("manageForms.items", { count: form.items.length })} · ${t("manageForms.opensWith", { window: windowLabel({ key: form.window_key }, t) })}${form.judged ? "" : ` · ${t("manageForms.notJudged")}`}${audience(form.divisionIds)}`}
            />
          ))}
        </RowList>
      )}
      <Screen.Section id="submitting-and-deleting" title={t("manageForms.submitting")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="submissions"
          keys={["autoSubmit", "deletion", "submittedTitle", "submittedBody"]}
        />
      </Screen.Section>
    </Screen>
  );
}
