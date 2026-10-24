import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { updateEventFn } from "@bogey/db/queries/manage";
import { ownSettingsQueryOptions, updateSettings } from "@bogey/db/queries/settings";
import { requestFailure } from "@bogey/db/errors";
import { isoToWallTime, wallTimeToIso } from "@bogey/utils/time";
import { isOrgAdmin } from "@bogey/db/auth";
import { Button } from "@bogey/ui/components/button";
import { FieldGroup } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import {
  FieldCombobox,
  errorVisibility,
  remoteCheck,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { timezoneOptions } from "#/lib/timezone.ts";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { useViewerSession } from "#/lib/viewer.ts";
import { checkEventRanges, eventFields, slugSchema, slugTaken } from "#/lib/event-form.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import {
  searchFields,
  searchSection,
  searchSettings,
} from "#/components/settings/layout/search-entries.ts";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

const detailsSchema = (t: T) =>
  z
    .object({
      ...eventFields(t),
      shortName: z
        .string()
        .trim()
        .max(32, t("form.maxLength", { max: 32 }))
        .meta({ label: t("details.shortName") }),
      about: z
        .string()
        .max(20_000, t("form.maxLength", { max: 20_000 }))
        .meta({ label: t("details.about") })
        .describe(t("details.aboutHelp")),
      location: z
        .string()
        .trim()
        .max(200, t("form.maxLength", { max: 200 }))
        .meta({ label: t("details.location") }),
      website: z
        .union([z.literal(""), z.url({ protocol: /^https?$/, error: t("details.needHttp") })])
        .meta({ label: t("details.website"), placeholder: "https://" }),
    })
    .superRefine(checkEventRanges(t));

export const Route = createFileRoute("/_authed/events/$slug/manage/details")({
  staticData: {
    title: msg("details.title"),
    settings: (t) => [
      ...searchFields(detailsSchema(t), "details"),
      searchSection(t("details.venue"), { id: "venue" }),
      ...searchSettings("venue", ["format", "mapUrl", "onlineUrl", "onlineLabel"], t),
      searchSection(t("errorPages.section"), { keywords: ["404", "error"], id: "error-pages" }),
      ...searchSettings("branding", ["fallbackMessage"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "venue",
        "branding",
      ]),
      context.query.ensureQueryData(
        ownSettingsQueryOptions({ scope: "event", eventId: context.event.id }, "about"),
      ),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => detailsSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const zone = event.timezone;
  const admin = isOrgAdmin(useViewerSession());
  const { data: about } = useSuspenseQuery(
    ownSettingsQueryOptions({ scope: "event", eventId: event.id }, "about"),
  );

  const form = useAppForm({
    defaultValues: {
      name: event.name,
      slug: event.slug,
      shortName: event.short_name ?? "",
      about: about.body ?? "",
      location: event.location ?? "",
      website: event.website_url ?? "",
      timezone: zone,
      startsAt: isoToWallTime(event.starts_at, zone),
      endsAt: isoToWallTime(event.ends_at, zone),
      teamMin: event.team_size_min,
      teamMax: event.team_size_max,
    },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await updateEventFn({
        data: {
          eventId: event.id,
          name: value.name,
          slug: value.slug,
          shortName: value.shortName,
          location: value.location,
          websiteUrl: value.website,
          timezone: value.timezone,
          startsAt: wallTimeToIso(value.startsAt, value.timezone),
          endsAt: wallTimeToIso(value.endsAt, value.timezone),
          teamSizeMin: value.teamMin,
          teamSizeMax: value.teamMax,
        },
      }).catch(requestFailure);
      if (!result.ok) {
        if (result.error.code === "conflict") {
          return createValidationError({ fields: { slug: result.error.message } });
        }
        return createValidationError(result.error.message);
      }
      if (value.about !== (about.body ?? "")) {
        const saved = await updateSettings({ scope: "event", eventId: event.id }, "about", {
          body: value.about || null,
        });
        if (!saved.ok) return createValidationError({ fields: { about: saved.error.message } });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
      formApi.reset(value);
      await queryClient.invalidateQueries({ queryKey: ["event"] });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      if (result.data.slug !== event.slug) {
        await navigate({ to: "/events/$slug/manage/details", params: { slug: result.data.slug } });
      } else {
        await router.invalidate();
      }
      return undefined;
    },
  });

  return (
    <Screen
      title={t("details.title")}
      width="embedded"
      actions={
        admin && (
          <>
            {!event.is_template && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/events/copy" search={{ from: event.id, template: true }} />}
              >
                {t("details.saveTemplate")}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/events/copy" search={{ from: event.id }} />}
            >
              {t("details.duplicate")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/events/${event.slug}/archive`} download />}
            >
              {t("details.archive")}
            </Button>
          </>
        )
      }
    >
      <form.AppForm>
        <form.Form unsaved="save" anchor="details">
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <form.Field name="name">{(field) => <field.TextField required />}</form.Field>
              <form.Field name="shortName">{(field) => <field.TextField />}</form.Field>
            </div>
            <form.Field
              name="slug"
              validators={[
                rewardEarlyPunishLate(slugSchema(t)),
                {
                  ...remoteCheck,
                  run: ({ value, signal }) => slugTaken(event.org_id, value, signal, t, event.id),
                },
              ]}
            >
              {(field) => (
                <field.SlugField
                  required
                  description={
                    field.value === event.slug
                      ? `/events/${field.value}`
                      : t("details.slugChanged", {
                          path: `/events/${field.value || "..."}`,
                          old: `/events/${event.slug}`,
                        })
                  }
                />
              )}
            </form.Field>
            <form.Field name="about">{(field) => <field.MarkdownField rows={6} />}</form.Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="location">{(field) => <field.TextField />}</form.Field>
              <form.Field name="website">{(field) => <field.TextField type="url" />}</form.Field>
            </div>
            <form.Field name="timezone">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldCombobox field={field} options={timezoneOptions()} />
                  <field.Description />
                  <field.Error />
                </field.Field>
              )}
            </form.Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="startsAt">{(field) => <field.DateTimeField stacked />}</form.Field>
              <form.Field name="endsAt">{(field) => <field.DateTimeField stacked />}</form.Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="teamMin">
                {(field) => (
                  <field.Field>
                    <field.Label />
                    <field.NumberInput min={1} max={50} />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
              <form.Field name="teamMax">
                {(field) => (
                  <field.Field>
                    <field.Label />
                    <field.NumberInput min={1} max={50} />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
            </div>
            <form.FormAlert title={t("details.failed")} />
          </FieldGroup>
        </form.Form>
      </form.AppForm>
      <Screen.Section id="venue" title={t("details.venue")} description={t("details.venueHelp")}>
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="venue"
          keys={["format", "mapUrl", "onlineUrl", "onlineLabel"]}
        />
      </Screen.Section>
      <Screen.Section
        id="error-pages"
        title={t("errorPages.section")}
        description={t("errorPages.help")}
      >
        <SettingFields
          scope={{ scope: "event", eventId: event.id }}
          namespace="branding"
          keys={["fallbackMessage"]}
        />
      </Screen.Section>
      <PluginSettingSections page="details" />
    </Screen>
  );
}
