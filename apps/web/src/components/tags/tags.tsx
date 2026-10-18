import { useMemo, useState } from "react";
import { IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { SESSION_KIND_TONES, type SessionKindTone } from "@bogey/config/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import type { CorePermission } from "@bogey/db/permissions";
import {
  saveTagsFn,
  setPersonTagsFn,
  tagHoldersQueryOptions,
  tagsQueryOptions,
  type Tag,
  type TagScope,
} from "@bogey/db/queries/tags";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { EditableList, EditableListItem } from "@bogey/ui/components/editable-list";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { MultiSelect, type SearchSelectOption } from "@bogey/ui/components/search-select";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  schemaMetaOf,
  useAppForm,
} from "@bogey/ui/lib/form";
import { cn } from "@bogey/ui/lib/utils";
import { KIND_TONES } from "#/components/event/agenda/session-kind.tsx";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

// what a tag can grant on top of a role; event.view and event.compete come with the role itself
export const TAG_PERMISSIONS: Tuple<{ value: CorePermission; label: PlainKey }> = [
  { value: "judging.score", label: "tags.perm.judging" },
  { value: "people.view", label: "tags.perm.people" },
  { value: "people.checkin", label: "tags.perm.checkin" },
  { value: "sessions.attendance", label: "tags.perm.attendance" },
  { value: "clarifications.answer", label: "tags.perm.messages" },
  { value: "event.manage", label: "tags.perm.manage" },
];

export function toneOf(tag: Pick<Tag, "tone">): SessionKindTone {
  return SESSION_KIND_TONES.find((tone) => tone === tag.tone) ?? "gray";
}

export function TagBadge({ tag }: { tag: Pick<Tag, "name" | "tone" | "description"> }) {
  return (
    <Badge
      className={cn("border-transparent", KIND_TONES[toneOf(tag)].badge)}
      title={tag.description || undefined}
    >
      {tag.name}
    </Badge>
  );
}

const tagSchema = (t: T) =>
  z.object({
    uid: z.string(),
    id: z.string(),
    name: z
      .string()
      .trim()
      .min(1, t("tags.nameIt"))
      .max(40, t("form.maxLength", { max: 40 }))
      .meta({ label: t("checkin.name"), placeholder: t("tags.namePlaceholder") }),
    description: z
      .string()
      .trim()
      .max(200, t("form.maxLength", { max: 200 }))
      .meta({ label: t("homeEditor.description") }),
    tone: z.enum(SESSION_KIND_TONES).meta({ label: t("tags.color") }),
    permissions: z
      .array(z.string())
      .max(20)
      .meta({ label: t("tags.grants"), placeholder: t("tags.grantsNone") })
      .describe(t("tags.grantsHelp")),
  });
type TagValues = z.infer<ReturnType<typeof tagSchema>>;

const tagsSchema = (t: T) =>
  z.object({
    items: z
      .array(tagSchema(t))
      .max(50, t("tags.atMost50"))
      .superRefine((items, ctx) => {
        const seen = new Set<string>();
        items.forEach((item, index) => {
          const key = item.name.trim().toLowerCase();
          if (key && seen.has(key)) {
            ctx.addIssue({ code: "custom", path: [index, "name"], message: t("tags.exists") });
          }
          seen.add(key);
        });
      }),
  });

const toValues = (tag: Tag): TagValues => ({
  uid: tag.id,
  id: tag.id,
  name: tag.name,
  description: tag.description,
  tone: toneOf(tag),
  permissions: [...tag.permissions],
});

function ownTags(tags: Tuple<Tag>, scope: TagScope): Tag[] {
  return tags.filter((tag) => (tag.event_id ?? undefined) === scope.eventId);
}

export function useInvalidateTags(scope: TagScope) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tags", scope.orgId] }),
      queryClient.invalidateQueries({ queryKey: ["tag-holders", scope.orgId] }),
      queryClient.invalidateQueries({ queryKey: ["event-access"] }),
    ]);
}

/** Edits the scope's own tags: the event's with an eventId, the org's without. */
export function TagsEditor({ scope }: { scope: TagScope }) {
  const t = useT();
  const schema = useMemo(() => tagsSchema(t), [t]);
  const itemSchema = useMemo(() => tagSchema(t), [t]);
  const queryClient = useQueryClient();
  const invalidate = useInvalidateTags(scope);
  const { data: tags } = useSuspenseQuery(tagsQueryOptions(scope));
  const { data: holders } = useSuspenseQuery(tagHoldersQueryOptions(scope));
  const [active, setActive] = useState<string | null>(null);
  const own = ownTags(tags, scope);
  const count = (id: string) => holders.filter((holder) => holder.tagId === id).length;
  const permissionOptions: SearchSelectOption[] = TAG_PERMISSIONS.map((each) => ({
    value: each.value,
    label: t(each.label),
  }));

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { items: own.map(toValues) },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await saveTagsFn({
        data: { ...scope, tags: value.items.map(({ uid: _uid, ...item }) => item) },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      queryClient.setQueryData(tagsQueryOptions(scope).queryKey, [
        ...tags.filter((tag) => !own.includes(tag)),
        ...result.data,
      ]);
      await invalidate();
      formApi.reset({ items: result.data.map(toValues) });
      setActive(null);
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-3">
        <form.Field name="items">
          {(list) => (
            <>
              <EditableList onMove={(from, to) => list.moveValue(from, to)}>
                {list.value.map((item, index) => {
                  const held = item.id ? count(item.id) : 0;
                  return (
                    <EditableListItem
                      key={item.uid}
                      id={item.uid}
                      index={index}
                      noun={t("tags.noun")}
                      numbered={false}
                      onRemove={() => list.removeValue(index)}
                      confirmRemove={held > 0 ? t("tags.inUse", { count: held }) : undefined}
                      preview={<TagPreview item={item} held={held} />}
                      editing={active === item.uid || !itemSchema.safeParse(item).success}
                      onEdit={() => setActive(item.uid)}
                      onDone={() => setActive(null)}
                    >
                      <form.Field name={`items[${index}].name`}>
                        {(field) => <field.TextField required />}
                      </form.Field>
                      <form.Field name={`items[${index}].description`}>
                        {(field) => <field.TextField />}
                      </form.Field>
                      <form.Field name={`items[${index}].tone`}>
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
                                    className={cn("size-6 rounded-pill", KIND_TONES[tone].swatch)}
                                  />
                                </button>
                              ))}
                            </div>
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name={`items[${index}].permissions`}>
                        {(field) => <field.MultiSelectField options={permissionOptions} />}
                      </form.Field>
                    </EditableListItem>
                  );
                })}
              </EditableList>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const uid = crypto.randomUUID();
                    list.pushValue({
                      uid,
                      id: "",
                      name: "",
                      description: "",
                      tone: "gray",
                      permissions: [],
                    });
                    setActive(uid);
                  }}
                >
                  <IconPlus />
                  {t("tags.add")}
                </Button>
              </div>
            </>
          )}
        </form.Field>
        <form.FormAlert title={t("tags.saveFailed")} />
      </form.Form>
    </form.AppForm>
  );
}

function TagPreview({ item, held }: { item: TagValues; held: number }) {
  const t = useT();
  const grants = item.permissions.map((permission) => {
    const known = TAG_PERMISSIONS.find((each) => each.value === permission);
    return known ? t(known.label) : permission;
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {item.name.trim() ? (
          <TagBadge tag={item} />
        ) : (
          <span className="text-muted-fg">{t("tags.untitled")}</span>
        )}
        {item.id && <Badge variant="secondary">{t("division.people", { count: held })}</Badge>}
      </div>
      {item.description.trim() && (
        <p className="text-sm text-muted-fg">{item.description.trim()}</p>
      )}
      {grants.length > 0 && (
        <p className="text-xs text-muted-fg">{t("tags.grantsList", { list: grants.join(", ") })}</p>
      )}
    </div>
  );
}

/**
 * One person's tags. Tags in a scope the caller can't hand out show as badges; the rest are
 * picked, and each changed scope is saved on its own.
 */
export function TagPicker({
  orgId,
  eventId,
  userId,
  name,
  tags,
  held,
  editableScopes,
}: {
  orgId: string;
  eventId?: string;
  userId: string;
  name: string;
  tags: Tuple<Tag>;
  held: Tuple<string>;
  editableScopes: { org: boolean; event: boolean };
}) {
  const t = useT();
  const invalidate = useInvalidateTags({ orgId, eventId });
  const editable = (tag: Tag) => (tag.event_id ? editableScopes.event : editableScopes.org);
  const save = useMutation({
    mutationFn: async (next: string[]) => {
      for (const scopeEvent of [undefined, eventId]) {
        if (scopeEvent === undefined && !editableScopes.org) continue;
        if (scopeEvent !== undefined && !editableScopes.event) continue;
        const inScope = (id: string) =>
          tags.some((tag) => tag.id === id && (tag.event_id ?? undefined) === scopeEvent);
        const before = held.filter(inScope).sort();
        const after = next.filter(inScope).sort();
        if (before.join() === after.join()) continue;
        unwrap(
          await setPersonTagsFn({
            data: { orgId, ...(scopeEvent ? { eventId: scopeEvent } : {}), userId, tagIds: after },
          }),
        );
      }
    },
    onSettled: invalidate,
  });
  const options: SearchSelectOption[] = tags.filter(editable).map((tag) => ({
    value: tag.id,
    label: tag.name,
    group: tag.event_id ? t("tags.eventGroup") : t("tags.orgGroup"),
  }));
  const fixed = tags.filter((tag) => !editable(tag) && held.includes(tag.id));
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      {fixed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fixed.map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </div>
      )}
      {options.length > 0 && (
        <>
          <label htmlFor={`tags-${userId}`} className="sr-only">
            {t("tags.for", { name })}
          </label>
          <MultiSelect
            id={`tags-${userId}`}
            options={options}
            value={held.filter((id) => options.some((option) => option.value === id))}
            placeholder={t("tags.pick")}
            disabled={save.isPending}
            onValueChange={(next) => save.mutate([...next, ...fixed.map((tag) => tag.id)])}
          />
        </>
      )}
      <ErrorAlert error={save.error} title={t("tags.assignFailed")} />
    </div>
  );
}
