import { createFileRoute } from "@tanstack/react-router";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { useMemo, useState } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconPlus } from "@tabler/icons-react";
import {
  SESSION_KIND_ICONS,
  SESSION_KIND_TONES,
  sessionKindSchema,
  type SessionKind,
} from "@bogey/config/settings";
import { agendaQueryOptions, saveSessionLevelsFn, type Agenda } from "@bogey/db/queries/sessions";
import { requestFailure } from "@bogey/db/errors";
import { toSlug } from "@bogey/utils/keys";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { KIND_ICONS, KIND_TONES, KindBadge } from "#/components/event/agenda/session-kind.tsx";
import { useSettingsMutation } from "#/lib/settings.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";
import { agendaSettings, levelsOf } from "./-components/agenda-shared.ts";

const kindValuesSchema = (t: T) =>
  z.object({
    kinds: z
      .array(
        sessionKindSchema.omit({ key: true }).extend({
          uid: z.string(),
          key: z.string(),
          label: sessionKindSchema.shape.label.meta({
            label: t("checkin.name"),
            placeholder: t("manageAgenda.workshop"),
          }),
          tone: sessionKindSchema.shape.tone.meta({ label: t("manageAgenda.color") }),
          icon: sessionKindSchema.shape.icon.meta({ label: t("manageAgenda.icon") }),
          levels: z
            .array(
              z
                .string()
                .trim()
                .max(40, t("form.maxLength", { max: 40 })),
            )
            .max(20)
            .meta({
              label: t("manageAgenda.levelsLabel"),
              placeholder: t("manageAgenda.levelPlaceholder"),
            })
            .describe(t("manageAgenda.levelsHelp")),
        }),
      )
      .max(40),
  });

type KindValues = z.infer<ReturnType<typeof kindValuesSchema>>["kinds"][number];

function withKeys(kinds: Tuple<KindValues>): (SessionKind & { levels: string[] })[] {
  const taken = new Set(kinds.map((kind) => kind.key).filter(Boolean));
  return kinds.map(({ uid: _uid, ...kind }) => {
    if (kind.key) return kind;
    const base = toSlug(kind.label, 40).replace(/^[^a-z]+/, "") || "type";
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base}-${n}`;
    taken.add(key);
    return { ...kind, key };
  });
}

const toKindValues = (kinds: Tuple<SessionKind>, agenda: Agenda): KindValues[] =>
  kinds.map((kind) => ({ ...kind, uid: kind.key, levels: levelsOf(agenda, kind.key) }));

function SessionTypes() {
  const t = useT();
  const schema = useMemo(() => kindValuesSchema(t), [t]);
  const { event } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(agendaSettings(event.id));
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const save = useSettingsMutation({ scope: "event", eventId: event.id }, "agenda");
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const used = new Map<string, number>();
  for (const session of agenda.slots.flatMap((slot) => slot.sessions)) {
    used.set(session.kind, (used.get(session.kind) ?? 0) + 1);
  }

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { kinds: toKindValues(settings.agenda.kinds, agenda) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const typed = withKeys(value.kinds);
      const kinds: SessionKind[] = typed.map(({ levels: _levels, ...kind }) => kind);
      try {
        await save.mutateAsync({ kinds });
      } catch (error) {
        return createValidationError(
          error instanceof Error ? error.message : t("manageAgenda.typesFailed"),
        );
      }
      const levels = [
        ...typed.flatMap((kind) =>
          [...new Set(kind.levels.map((label) => label.trim()).filter(Boolean))].map((label) => ({
            kind: kind.key,
            label,
          })),
        ),
        // plugin types' levels aren't edited here
        ...agenda.categories.filter((category) => category.kind.includes(".")),
      ];
      const saved = await saveSessionLevelsFn({ data: { eventId: event.id, levels } }).catch(
        requestFailure,
      );
      if (!saved.ok) return createValidationError(saved.error.message);
      const fresh = await queryClient.fetchQuery({
        ...agendaQueryOptions(event.id),
        staleTime: 0,
      });
      formApi.reset({ kinds: toKindValues(kinds, fresh) });
      setActive(null);
      return undefined;
    },
  });

  return (
    <Screen.Section
      id="session-types"
      title={t("manageAgenda.types")}
      description={t("manageAgenda.typesHelp")}
    >
      <form.AppForm>
        <form.Form unsaved="save" className="flex flex-col gap-3">
          <form.Field name="kinds">
            {(list) => (
              <>
                <EditableList
                  onMove={(from, to) => list.moveValue(from, to)}
                  empty={t("manageAgenda.noTypes")}
                >
                  {list.value.map((kind, index) => {
                    const count = kind.key ? (used.get(kind.key) ?? 0) : 0;
                    return (
                      <EditableListItem
                        key={kind.uid}
                        id={kind.uid}
                        index={index}
                        noun={t("manageAgenda.typeNoun")}
                        onRemove={() => list.removeValue(index)}
                        confirmRemove={
                          count > 0 ? t("manageAgenda.typeInUse", { count }) : undefined
                        }
                        preview={
                          <div className="flex min-h-7 items-center gap-3">
                            <KindBadge
                              kind={{
                                ...kind,
                                label: kind.label || t("manageAgenda.untitledType"),
                              }}
                            />
                            <span className="text-sm text-muted-fg">
                              {[
                                count > 0
                                  ? t("manageAgenda.sessionCount", { count })
                                  : t("manageAgenda.unused"),
                                kind.levels.filter((label) => label.trim()).join(", "),
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {count === 1 && (
                              <span className="text-sm text-warning">
                                {t("manageAgenda.singleUse")}
                              </span>
                            )}
                          </div>
                        }
                        editing={
                          active === kind.uid || !schema.shape.kinds.element.safeParse(kind).success
                        }
                        onEdit={() => setActive(kind.uid)}
                        onDone={() => setActive(null)}
                      >
                        <div className="flex flex-col gap-4">
                          <form.Field name={`kinds[${index}].label`}>
                            {(field) => <field.TextField required />}
                          </form.Field>
                          <form.Field name={`kinds[${index}].levels`}>
                            {(field) => <field.OptionsField />}
                          </form.Field>
                          <form.Field name={`kinds[${index}].tone`}>
                            {(field) => (
                              <Field>
                                <FieldLabel>{schemaMetaOf(field).label}</FieldLabel>
                                <div
                                  role="radiogroup"
                                  aria-label={schemaMetaOf(field).label}
                                  className="flex flex-wrap gap-1.5"
                                >
                                  {SESSION_KIND_TONES.map((tone) => (
                                    <button
                                      key={tone}
                                      type="button"
                                      role="radio"
                                      aria-checked={field.value === tone}
                                      aria-label={t(KIND_TONES[tone].label)}
                                      title={t(KIND_TONES[tone].label)}
                                      onClick={() => field.handleChange(tone)}
                                      className={cn(
                                        "flex size-8 items-center justify-center rounded-pill ring-offset-2 ring-offset-background",
                                        "aria-checked:ring-2 aria-checked:ring-fg hocus:ring-2 hocus:ring-border",
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          "size-6 rounded-pill",
                                          KIND_TONES[tone].swatch,
                                        )}
                                      />
                                    </button>
                                  ))}
                                </div>
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name={`kinds[${index}].icon`}>
                            {(field) => (
                              <Field>
                                <FieldLabel>{schemaMetaOf(field).label}</FieldLabel>
                                <div
                                  role="radiogroup"
                                  aria-label={schemaMetaOf(field).label}
                                  className="flex flex-wrap gap-1"
                                >
                                  {SESSION_KIND_ICONS.map((icon) => {
                                    const Icon = KIND_ICONS[icon];
                                    return (
                                      <button
                                        key={icon}
                                        type="button"
                                        role="radio"
                                        aria-checked={field.value === icon}
                                        aria-label={icon}
                                        title={icon}
                                        onClick={() => field.handleChange(icon)}
                                        className={cn(
                                          "flex size-9 items-center justify-center rounded-xl text-muted-fg hocus:bg-muted hocus:text-fg",
                                          "aria-checked:bg-muted aria-checked:text-fg aria-checked:ring-1 aria-checked:ring-fg/20",
                                        )}
                                      >
                                        <Icon className="size-4.5" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      </EditableListItem>
                    );
                  })}
                </EditableList>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const uid = crypto.randomUUID();
                      list.pushValue({
                        uid,
                        key: "",
                        label: "",
                        tone: "gray",
                        icon: "calendar",
                        levels: [],
                      });
                      setActive(uid);
                    }}
                  >
                    <IconPlus />
                    {t("manageAgenda.addType")}
                  </Button>
                </div>
              </>
            )}
          </form.Field>
          <form.FormAlert title={t("manageAgenda.typesSaveFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

export const Route = createFileRoute("/_authed/events/$slug/manage/agenda/types")({
  staticData: {
    title: msg("manageAgenda.types"),
    settings: (t) => [
      searchSection(t("manageAgenda.types"), {
        keywords: ["levels", "beginner", "advanced", "talk", "workshop"],
        id: "session-types",
      }),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(agendaQueryOptions(context.event.id)),
      context.query.ensureQueryData(agendaSettings(context.event.id)),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen title={t("manageAgenda.types")} width="embedded">
      <SessionTypes />
    </Screen>
  );
}
