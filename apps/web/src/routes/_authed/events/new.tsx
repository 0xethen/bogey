import { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { createEventFn } from "@bogey/db/queries/org";
import { eventsQueryOptions } from "@bogey/db/queries/events";
import { setWindowsFn } from "@bogey/db/queries/manage";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  findPlugin,
  installedPlugins,
  pluginEventTypes,
  settingsEditableAt,
  type MountedEventType,
  type PluginSettingValue,
} from "@bogey/plugins";
import { requestFailure } from "@bogey/db/errors";
import type { Enums } from "@bogey/db/types";
import { formatDateTime, wallTimeToIso } from "@bogey/utils/time";
import { toSlug } from "@bogey/utils/keys";
import { Button } from "@bogey/ui/components/button";
import { FieldGroup, FieldLabel, FieldSet } from "@bogey/ui/components/field";
import { Field } from "@bogey/ui/components/field";
import { RadioGroup, RadioGroupItem } from "@bogey/ui/components/radio-group";
import { Facts } from "@bogey/ui/components/facts";
import { Screen } from "@bogey/ui/components/screen";
import { Stepper } from "#/components/event/submission/stepper.tsx";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import {
  appFormOptions,
  errorVisibility,
  remoteCheck,
  rewardEarlyPunishLate,
  FieldSelect,
  useAppForm,
} from "@bogey/ui/lib/form";
import { detectedTimezone, timezoneOptions } from "#/lib/timezone.ts";
import { orgAdmin } from "#/lib/viewer.ts";
import { isOrgAdmin } from "@bogey/db/auth";
import { checkEventRanges, eventFields, slugSchema, slugTaken } from "#/lib/event-form.ts";
import { defaultSchedule } from "#/lib/schedule-defaults.ts";
import { StartFrom } from "./-components/start-from.tsx";
import { savePluginSettings } from "#/lib/plugins.ts";
import { windowLabel } from "#/lib/windows.ts";
import { applyFormatPreset, FORMAT_PRESETS } from "#/lib/format-presets.ts";
import { msg, sayOr, useT, type PlainKey, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/new")({
  staticData: { title: msg("newEvent.title"), command: { group: "Organization", when: orgAdmin } },
  beforeLoad: ({ context }) => {
    const org = context.session.org;
    if (!org || !isOrgAdmin(context.session))
      throw Route.redirect({ to: "/events", replace: true });
    return { org };
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(settingsQueryOptions({ orgId: context.org.id }, ["plugins"])),
      context.query.ensureQueryData(eventsQueryOptions(context.org.id)),
    ]),
  component: RouteComponent,
});

type Kind = Enums<"event_kind">;

interface EventOption {
  value: string;
  label: string;
  description: string;
  kind: Kind;
  teams: readonly [number, number];
  plugin: string | null;
  pluginSettings: Record<string, PluginSettingValue>;
}

const CORE_OPTIONS: Tuple<EventOption> = [
  {
    value: "hackathon",
    label: "newEvent.hackathon",
    description: "newEvent.hackathonHelp",
    kind: "hackathon",
    teams: [1, 4],
    plugin: null,
    pluginSettings: {},
  },
  {
    value: "custom",
    label: "newEvent.custom",
    description: "newEvent.customHelp",
    kind: "custom",
    teams: [1, 4],
    plugin: null,
    pluginSettings: {},
  },
];

function optionText(text: string, t: T): string {
  return sayOr(t, text, text);
}

function eventLevelSettings(
  plugin: string,
  settings: Readonly<Record<string, PluginSettingValue>>,
): Record<string, PluginSettingValue> {
  const manifest = findPlugin(plugin);
  const editable = new Set(
    manifest ? settingsEditableAt(manifest, "event").map(([name]) => name) : [],
  );
  return Object.fromEntries(Object.entries(settings).filter(([name]) => editable.has(name)));
}

function eventOptions(available: Tuple<string> | undefined): EventOption[] {
  const types: Tuple<MountedEventType> = pluginEventTypes(
    installedPlugins().filter((manifest) => !available || available.includes(manifest.key)),
  );
  return [
    CORE_OPTIONS[0]!,
    ...types.map((type): EventOption => ({
      value: type.id,
      label: type.label,
      description: type.description,
      kind: type.kind,
      teams: type.teamSize,
      plugin: type.plugin,
      pluginSettings: eventLevelSettings(type.plugin, type.settings),
    })),
    CORE_OPTIONS[1]!,
  ];
}

const FORMATS = ["in-person", "online", "hybrid", "custom"] as const;

const CUSTOM_FORMAT = {
  value: "custom",
  label: "newEvent.formatCustom",
  description: "newEvent.formatCustomHelp",
} as const satisfies { value: string; label: PlainKey; description: PlainKey };

const newEventSchema = (t: T) =>
  z
    .object({
      ...eventFields(t),
      type: z
        .string()
        .min(1, t("newEvent.chooseKind"))
        .meta({ label: t("facts.kind") }),
      format: z
        .enum(FORMATS)
        .meta({ label: t("newEvent.where") })
        .describe(t("newEvent.whereHelp")),
    })
    .superRefine(checkEventRanges(t));

type Values = z.input<ReturnType<typeof newEventSchema>>;

const STEPS: Tuple<{ key: string; title: PlainKey; fields: Tuple<keyof Values> }> = [
  { key: "basics", title: "newEvent.basics", fields: ["name", "slug", "type", "format"] },
  { key: "when", title: "facts.when", fields: ["timezone", "startsAt", "endsAt"] },
  { key: "teams", title: "facts.teams", fields: ["teamMin", "teamMax"] },
  { key: "review", title: "newEvent.review", fields: [] },
];

function stepValid(
  values: Values,
  fields: Tuple<keyof Values>,
  schema: z.ZodType<Values>,
): boolean {
  const result = schema.safeParse(values);
  return (
    result.success ||
    !result.error.issues.some((issue) => fields.some((field) => issue.path[0] === field))
  );
}

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => newEventSchema(t), [t]);
  const { org } = Route.useRouteContext();
  const { data: orgSettings } = useSuspenseQuery(
    settingsQueryOptions({ orgId: org.id }, ["plugins"]),
  );
  const options = eventOptions(orgSettings.plugins.available);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: existing } = useSuspenseQuery(eventsQueryOptions(org.id));
  const [step, setStepState] = useState(0);
  const stepRef = useRef(0);
  const setStep = (update: number | ((index: number) => number)) => {
    const value = typeof update === "function" ? update(stepRef.current) : update;
    stepRef.current = value;
    setStepState(value);
  };

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        name: "",
        slug: "",
        type: "hackathon",
        format: "in-person",
        timezone: detectedTimezone(),
        startsAt: "",
        endsAt: "",
        teamMin: 1,
        teamMax: 4,
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      if (stepRef.current < STEPS.length - 1) {
        setStep((index) => index + 1);
        return undefined;
      }
      const option = options.find((each) => each.value === value.type) ?? CORE_OPTIONS[0]!;
      const startsAt = wallTimeToIso(value.startsAt, value.timezone);
      const endsAt = wallTimeToIso(value.endsAt, value.timezone);
      const result = await createEventFn({
        data: {
          orgId: org.id,
          name: value.name,
          slug: value.slug,
          kind: option.kind,
          plugin: option.plugin,
          timezone: value.timezone,
          startsAt,
          endsAt,
          teamSizeMin: value.teamMin,
          teamSizeMax: value.teamMax,
        },
      }).catch(requestFailure);
      if (!result.ok) {
        if (result.error.code === "conflict") {
          setStep(0);
          return createValidationError({ fields: { slug: result.error.message } });
        }
        return createValidationError(result.error.message);
      }
      const slug = result.data.slug;
      if (option.plugin && Object.keys(option.pluginSettings).length > 0) {
        await savePluginSettings(
          { scope: "event", eventId: result.data.id },
          option.plugin,
          option.pluginSettings,
        );
      }
      const preset =
        option.kind === "hackathon"
          ? FORMAT_PRESETS.find((each) => each.value === value.format)
          : undefined;
      if (preset) await applyFormatPreset({ scope: "event", eventId: result.data.id }, preset);
      const schedule = defaultSchedule(option.kind, startsAt, endsAt, new Date().toISOString());
      const scheduled = schedule.length
        ? await setWindowsFn({
            data: {
              eventId: result.data.id,
              windows: schedule.map(({ key, opens_at, closes_at, override }) => ({
                key,
                opens_at,
                closes_at,
                override,
              })),
              label: "Default schedule",
            },
          }).catch(requestFailure)
        : { ok: true };
      await queryClient.invalidateQueries({ queryKey: ["events", org.id] });
      await navigate(
        scheduled.ok
          ? { to: "/events/$slug/manage", params: { slug } }
          : { to: "/events/$slug/manage/agenda", params: { slug } },
      );
      return undefined;
    },
  });

  const next = () => {
    const current = STEPS[step];
    if (current && !stepValid(form.state.values, current.fields, schema)) {
      void form.handleSubmit();
      return;
    }
    setStep((index) => Math.min(index + 1, STEPS.length - 1));
  };

  return (
    <Screen title={t("newEvent.title")} description={t("newEvent.intro")} width="narrow">
      <Stepper
        steps={STEPS.map((each) => ({ key: each.key, title: t(each.title) }))}
        current={step}
      />
      <form.AppForm>
        <form.Form unsaved="draft">
          <FieldGroup>
            {step === 0 && (
              <>
                <StartFrom events={existing} value="" />
                <form.Field name="name">{(field) => <field.TextField required />}</form.Field>

                <form.Field
                  name="slug"
                  listeners={[
                    {
                      triggers: ["change"],
                      watchFields: ["name"],
                      run: ({ value, fieldApi, formApi }) => {
                        if (fieldApi.meta.isTouched) return;
                        const linked = toSlug(formApi.getFieldValue("name"));
                        if (linked !== value)
                          fieldApi.handleChange(linked, { markAsTouched: false });
                      },
                    },
                  ]}
                  validators={[
                    rewardEarlyPunishLate(slugSchema(t)),
                    {
                      ...remoteCheck,
                      run: ({ value, signal }) => slugTaken(org.id, value, signal, t),
                    },
                  ]}
                >
                  {(field) => (
                    <field.SlugField required description={`/events/${field.value || "..."}`} />
                  )}
                </form.Field>

                <form.Field name="type">
                  {(field) => (
                    <FieldSet>
                      <field.Legend />
                      <RadioGroup
                        value={field.value}
                        onValueChange={(value) => {
                          const next = options.find((option) => option.value === value);
                          if (!next) return;
                          field.handleChange(next.value);
                          form.setFieldValue("teamMin", next.teams[0]);
                          form.setFieldValue("teamMax", next.teams[1]);
                        }}
                      >
                        {options.map((option) => (
                          <Field key={option.value} orientation="horizontal">
                            <RadioGroupItem value={option.value} id={`kind-${option.value}`} />
                            <FieldLabel
                              htmlFor={`kind-${option.value}`}
                              className="flex-col items-start gap-0"
                            >
                              <span>{optionText(option.label, t)}</span>
                              <span className="font-normal text-muted-fg">
                                {optionText(option.description, t)}
                              </span>
                            </FieldLabel>
                          </Field>
                        ))}
                      </RadioGroup>
                    </FieldSet>
                  )}
                </form.Field>
                <form.Subscribe
                  selector={(state) =>
                    options.find((option) => option.value === state.values.type)?.kind ===
                    "hackathon"
                  }
                >
                  {(hackathon) =>
                    hackathon && (
                      <form.Field name="format">
                        {(field) => (
                          <FieldSet>
                            <field.Legend />
                            <field.Description />
                            <RadioGroup
                              value={field.value}
                              onValueChange={(value) => {
                                const next = FORMATS.find((format) => format === value);
                                if (next) field.handleChange(next);
                              }}
                            >
                              {[...FORMAT_PRESETS, CUSTOM_FORMAT].map((format) => (
                                <Field key={format.value} orientation="horizontal">
                                  <RadioGroupItem
                                    value={format.value}
                                    id={`format-${format.value}`}
                                  />
                                  <FieldLabel
                                    htmlFor={`format-${format.value}`}
                                    className="flex-col items-start gap-0"
                                  >
                                    <span>{t(format.label)}</span>
                                    <span className="font-normal text-muted-fg">
                                      {t(format.description)}
                                    </span>
                                  </FieldLabel>
                                </Field>
                              ))}
                            </RadioGroup>
                          </FieldSet>
                        )}
                      </form.Field>
                    )
                  }
                </form.Subscribe>
              </>
            )}

            {step === 1 && (
              <>
                <form.Field name="timezone">
                  {(field) => (
                    <field.Field>
                      <field.Label />
                      <FieldSelect field={field} options={timezoneOptions()} />
                      <field.Description />
                      <field.Error />
                    </field.Field>
                  )}
                </form.Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.Field name="startsAt">{(field) => <field.DateTimeField />}</form.Field>
                  <form.Field name="endsAt">{(field) => <field.DateTimeField />}</form.Field>
                </div>
                <p className="text-sm text-muted-fg">{t("newEvent.datesHelp")}</p>
              </>
            )}

            {step === 2 && (
              <div className="grid gap-4">
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
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      form.setFieldValue("teamMin", 1);
                      form.setFieldValue("teamMax", 1);
                    }}
                  >
                    {t("newEvent.individuals")}
                  </Button>
                </div>
              </div>
            )}

            {step === 3 && (
              <form.Subscribe selector={(state) => state.values}>
                {(values) => <Review values={values} options={options} />}
              </form.Subscribe>
            )}

            <form.FormAlert title={t("newEvent.failed")} />
            <div className="flex flex-wrap gap-2">
              {step > 0 && (
                <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}>
                  {t("common.back")}
                </Button>
              )}
              {step < STEPS.length - 1 ? (
                <Button type="button" onClick={next}>
                  {t("newEvent.next")}
                </Button>
              ) : (
                <form.Submit pending={t("teamForm.creating")}>{t("newEvent.create")}</form.Submit>
              )}
            </div>
          </FieldGroup>
        </form.Form>
      </form.AppForm>
    </Screen>
  );
}

function Review({ values, options }: { values: Values; options: Tuple<EventOption> }) {
  const t = useT();
  const time = useTimeFormat();
  const [openedAt] = useState(() => new Date().toISOString());
  const zoned = { ...time, timeZone: values.timezone, zone: true };
  const startsAt = wallTimeToIso(values.startsAt, values.timezone);
  const endsAt = wallTimeToIso(values.endsAt, values.timezone);
  const option = options.find((each) => each.value === values.type);
  const preset =
    option?.kind === "hackathon"
      ? FORMAT_PRESETS.find((each) => each.value === values.format)
      : undefined;
  const schedule = defaultSchedule(option?.kind ?? "custom", startsAt, endsAt, openedAt);
  const teams =
    values.teamMax === 1
      ? t("newEvent.individualsOnly")
      : values.teamMin === values.teamMax
        ? t("facts.people", { count: values.teamMax })
        : t("facts.range", { min: values.teamMin, max: values.teamMax });

  return (
    <div className="flex flex-col gap-6">
      <Facts
        facts={[
          { label: t("checkin.name"), value: values.name },
          { label: t("adminOrgs.address"), value: <code>/events/{values.slug}</code> },
          { label: t("facts.kind"), value: option ? optionText(option.label, t) : values.type },
          {
            label: t("facts.when"),
            value:
              startsAt && endsAt
                ? t("newEvent.range", {
                    from: formatDateTime(startsAt, zoned),
                    to: formatDateTime(endsAt, zoned),
                  })
                : t("newEvent.notSet"),
          },
          { label: t("facts.teams"), value: teams },
          ...(option?.kind === "hackathon"
            ? [
                {
                  label: t("facts.format"),
                  value: preset ? t(preset.label) : t("newEvent.setUpYourself"),
                },
              ]
            : []),
        ]}
      />
      {preset && (
        <div className="flex flex-col gap-2">
          <h2 className="font-heading font-semibold">{t("newEvent.startingSettings")}</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {preset.summary.map((line) => (
              <li key={line}>{t(line)}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h2 className="font-heading font-semibold">{t("newEvent.schedule")}</h2>
        {schedule.length ? (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {schedule.map((window) => (
                <li key={window.key}>
                  <span className="font-medium">{windowLabel(window, t)}</span>{" "}
                  <span className="text-muted-fg">{t(window.when)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-fg">{t("newEvent.scheduleHelp")}</p>
          </>
        ) : (
          <p className="text-sm text-muted-fg">{t("newEvent.scheduleEmpty")}</p>
        )}
      </div>
    </div>
  );
}
