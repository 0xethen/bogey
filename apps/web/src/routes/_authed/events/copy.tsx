import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { CLONE_SECTIONS, cloneEventFn, type CloneSection } from "@bogey/db/queries/org";
import { eventsQueryOptions, type EventSummary } from "@bogey/db/queries/events";
import { requestFailure } from "@bogey/db/errors";
import { isOrgAdmin } from "@bogey/db/auth";
import { toSlug } from "@bogey/utils/keys";
import { isoToWallTime, wallTimeToIso } from "@bogey/utils/time";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { FieldGroup, FieldSet } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";
import { cn } from "@bogey/ui/lib/utils";
import {
  appFormOptions,
  errorVisibility,
  remoteCheck,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { eventFields, slugSchema, slugTaken } from "#/lib/event-form.ts";
import { msg, useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { StartFrom } from "./-components/start-from.tsx";

const searchSchema = z.object({
  from: z.uuid().optional().catch(undefined),
  template: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/events/copy")({
  staticData: { title: msg("copy.title"), command: false },
  validateSearch: searchSchema,
  beforeLoad: ({ context }) => {
    const org = context.session.org;
    if (!org || !isOrgAdmin(context.session))
      throw Route.redirect({ to: "/events", replace: true });
    return { org };
  },
  loader: ({ context }) => context.query.ensureQueryData(eventsQueryOptions(context.org.id)),
  component: RouteComponent,
});

const SECTION_LABELS = {
  details: { label: "copy.details", description: "copy.detailsHelp" },
  windows: { label: "copy.windows", description: "copy.windowsHelp" },
  divisions: { label: "copy.divisions", description: "copy.divisionsHelp" },
  tracks: { label: "copy.tracks", description: "copy.tracksHelp" },
  forms: { label: "copy.forms", description: "copy.formsHelp" },
  judging: { label: "copy.judging", description: "copy.judgingHelp" },
  agenda: { label: "copy.agenda", description: "copy.agendaHelp" },
  pages: { label: "copy.pages", description: "copy.pagesHelp" },
  homepage: { label: "copy.homepage", description: "copy.homepageHelp" },
  settings: { label: "copy.settings", description: "copy.settingsHelp" },
  onboarding: { label: "copy.onboarding", description: "copy.onboardingHelp" },
  invites: { label: "copy.invites", description: "copy.invitesHelp" },
} as const satisfies Record<CloneSection, { label: PlainKey; description: PlainKey }>;

// sections that need another one
const REQUIRES: Partial<Record<CloneSection, CloneSection>> = { judging: "forms" };

const copySchema = (t: T, sourceStart: string) => {
  const fields = eventFields(t);
  return z
    .object({
      name: fields.name,
      slug: fields.slug,
      startsAt: fields.startsAt,
      sameSpacing: z.boolean().meta({ label: t("copy.sameSpacing") }),
      endsAt: fields.endsAt,
      sections: z.array(z.enum(CLONE_SECTIONS)).meta({ label: t("copy.whatToCopy") }),
    })
    .superRefine((value, ctx) => {
      if (!value.sameSpacing) {
        const start = value.startsAt || sourceStart;
        if (!value.endsAt) {
          ctx.addIssue({ code: "custom", path: ["endsAt"], message: t("copy.needEnd") });
        } else if (start && value.endsAt <= start) {
          ctx.addIssue({ code: "custom", path: ["endsAt"], message: t("eventForm.endAfter") });
        }
      }
      if (value.sections.includes("judging") && !value.sections.includes("forms")) {
        ctx.addIssue({ code: "custom", path: ["sections"], message: t("copy.judgingNeedsForms") });
      }
    });
};

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const { from, template = false } = Route.useSearch();
  const { data: events } = useSuspenseQuery(eventsQueryOptions(org.id));
  const source = events.find((event) => event.id === from);
  if (!source) {
    return (
      <Screen title={t("copy.title")} description={t("copy.choose")} width="narrow">
        <Button render={<Link to="/events" />} nativeButton={false}>
          {t("copy.backToEvents")}
        </Button>
      </Screen>
    );
  }
  return (
    <CopyForm
      key={source.id}
      events={events}
      sourceStart={isoToWallTime(source.starts_at, source.timezone)}
      orgId={org.id}
      sourceId={source.id}
      sourceName={source.name}
      timezone={source.timezone}
      sourceSlug={source.slug}
      template={template}
    />
  );
}

function CopyForm({
  events,
  sourceStart,
  orgId,
  sourceId,
  sourceName,
  sourceSlug,
  timezone,
  template,
}: {
  events: Tuple<EventSummary>;
  sourceStart: string;
  orgId: string;
  sourceId: string;
  sourceName: string;
  sourceSlug: string;
  timezone: string;
  template: boolean;
}) {
  const t = useT();
  const schema = useMemo(() => copySchema(t, sourceStart), [t, sourceStart]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reenter, setReenter] = useState<{ slug: string; names: string[] } | null>(null);

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        name: template
          ? t("copy.templateName", { name: sourceName })
          : t("copy.copyName", { name: sourceName }),
        slug: toSlug(template ? `${sourceSlug}-template` : `${sourceSlug}-copy`),
        startsAt: "",
        sameSpacing: true,
        endsAt: "",
        sections: [...CLONE_SECTIONS],
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await cloneEventFn({
        data: {
          sourceId,
          name: value.name,
          slug: value.slug,
          template,
          startsAt: template ? null : wallTimeToIso(value.startsAt, timezone),
          endsAt: template || value.sameSpacing ? null : wallTimeToIso(value.endsAt, timezone),
          sections: value.sections,
        },
      }).catch(requestFailure);
      if (!result.ok) {
        if (result.error.code === "conflict") {
          return createValidationError({ fields: { slug: result.error.message } });
        }
        return createValidationError(result.error.message);
      }
      await queryClient.invalidateQueries({ queryKey: ["events", orgId] });
      if (result.data.reenter.length > 0) {
        setReenter({ slug: result.data.slug, names: result.data.reenter });
        return undefined;
      }
      await navigate({ to: "/events/$slug/manage", params: { slug: result.data.slug } });
      return undefined;
    },
  });

  if (reenter) {
    return (
      <Screen title={template ? t("copy.templateSaved") : t("copy.copied")} width="narrow">
        <Alert>
          <AlertTitle>{t("copy.secretsAgain")}</AlertTitle>
          <AlertDescription>
            {t("copy.secretsBody", { source: sourceName, names: reenter.names.join(", ") })}
          </AlertDescription>
        </Alert>
        <div>
          <Button
            render={<Link to="/events/$slug/manage" params={{ slug: reenter.slug }} />}
            nativeButton={false}
          >
            {t("copy.openNew")}
          </Button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      title={template ? t("copy.saveTemplate") : t("copy.copyTitle", { name: sourceName })}
      description={template ? t("copy.templateHelp") : t("copy.copyHelp", { name: sourceName })}
      width="narrow"
    >
      <form.AppForm>
        <form.Form unsaved="draft">
          <FieldGroup>
            {!template && <StartFrom events={events} value={sourceId} />}
            <form.Field name="name">{(field) => <field.TextField required />}</form.Field>
            <form.Field
              name="slug"
              validators={[
                rewardEarlyPunishLate(slugSchema(t)),
                {
                  ...remoteCheck,
                  run: ({ value, signal }) => slugTaken(orgId, value, signal, t),
                },
              ]}
            >
              {(field) => (
                <field.SlugField required description={`/events/${field.value || "..."}`} />
              )}
            </form.Field>
            {!template && (
              <>
                <form.Field name="startsAt">{(field) => <field.DateTimeField />}</form.Field>
                <form.Field name="sameSpacing">{(field) => <field.SwitchField />}</form.Field>
                <form.Subscribe selector={(state) => state.values.sameSpacing}>
                  {(sameSpacing) =>
                    !sameSpacing && (
                      <form.Field name="endsAt">
                        {(field) => <field.DateTimeField required />}
                      </form.Field>
                    )
                  }
                </form.Subscribe>
              </>
            )}
            <form.Field name="sections">
              {(field) => (
                <FieldSet>
                  <field.Legend />
                  <CheckboxGroup
                    value={field.value}
                    onValueChange={(next) =>
                      field.handleChange(
                        CLONE_SECTIONS.filter((key) => {
                          const parent = REQUIRES[key];
                          return next.includes(key) && (!parent || next.includes(parent));
                        }),
                      )
                    }
                  >
                    {CLONE_SECTIONS.map((key) => {
                      const parent = REQUIRES[key];
                      const blocked = parent !== undefined && !field.value.includes(parent);
                      const row = (
                        <label
                          className={cn(
                            "flex items-start gap-3",
                            parent && "ml-2 border-l pl-5",
                            blocked && "opacity-60",
                          )}
                        >
                          <Checkbox value={key} disabled={blocked} className="mt-1" />
                          <span className="flex flex-col">
                            <span>{t(SECTION_LABELS[key].label)}</span>
                            <span className="text-sm text-muted-fg">
                              {t(SECTION_LABELS[key].description)}
                            </span>
                          </span>
                        </label>
                      );
                      return blocked ? (
                        <Tooltip key={key}>
                          <TooltipTrigger render={<div />}>{row}</TooltipTrigger>
                          <TooltipContent>{t("copy.judgingNeedsFormsTip")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <div key={key}>{row}</div>
                      );
                    })}
                  </CheckboxGroup>
                  <field.Error />
                </FieldSet>
              )}
            </form.Field>
            <form.FormAlert title={t("copy.failed")} />
            <div>
              <form.Submit pending={`${t("copy.copying")}...`}>
                {template ? t("copy.saveButton") : t("copy.copyButton")}
              </form.Submit>
            </div>
          </FieldGroup>
        </form.Form>
      </form.AppForm>
    </Screen>
  );
}
