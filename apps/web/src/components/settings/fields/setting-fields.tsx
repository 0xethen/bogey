import { useState, type ReactNode } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import {
  inheritedSettingsQueryOptions,
  ownLocksQueryOptions,
  ownSettingsQueryOptions,
  setSettingLockFn,
  updateSettingsFn,
  type InheritedSettings,
  type OwnScope,
} from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  isOperatorKey,
  operatorConfigPath,
  scopesBelow,
  settingControl,
  type CoreNamespace,
  type SettingEmpty,
  type SettingScope,
  type SettingsValue,
} from "@bogey/config/settings";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Button } from "@bogey/ui/components/button";
import { FieldFrame, FieldLabel } from "@bogey/ui/components/field";
import { IconArrowBack, IconLock, IconLockOpen } from "@tabler/icons-react";
import { useUnsavedEntry } from "@bogey/ui/lib/unsaved";
import { Input } from "@bogey/ui/components/input";
import { NumberInput } from "@bogey/ui/components/number-field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { MultiSelect, type SearchSelectOption } from "@bogey/ui/components/search-select";
import { tagsQueryOptions } from "@bogey/db/queries/tags";
import { TAG_REF, tagRef } from "@bogey/utils/keys";
import { useEventViewer } from "#/lib/viewer.ts";
import { Switch } from "@bogey/ui/components/switch";
import { useLocale } from "@bogey/ui/lib/locale";
import { sayOr, useT, type PlainKey, type T } from "#/lib/translate.tsx";

// lists compare by what they hold, so picking a role and unpicking it again leaves nothing to save
function sameSetting(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
    : Object.is(a, b);
}

function valueAt(values: object, key: string): unknown {
  return new Map(Object.entries(values)).get(key);
}

function has(values: object, key: string): boolean {
  return valueAt(values, key) !== undefined;
}

function resolve<N extends CoreNamespace>(
  scope: OwnScope["scope"],
  key: string,
  own: Partial<SettingsValue<N>>,
  inherited: InheritedSettings<N>,
  reset: () => void,
  t: T,
): { value: unknown; source: SettingSource } {
  const defaults = { name: undefined, values: inherited.defaults };
  const above: { name: string | undefined; values: object }[] = [
    ...(scope === "event" ? [{ name: t("settingSource.org"), values: inherited.org }] : []),
    ...(scope !== "instance"
      ? [{ name: t("settingSource.instance"), values: inherited.instance }]
      : []),
  ];
  const fromAbove = above.find((level) => has(level.values, key)) ?? defaults;
  const lockedBy = inherited.instanceLocked.includes(key)
    ? t("settingSource.instance")
    : inherited.orgLocked.includes(key)
      ? t("settingSource.org")
      : null;

  if (lockedBy) {
    return { value: valueAt(fromAbove.values, key), source: { kind: "locked", by: lockedBy } };
  }
  if (has(own, key)) return { value: valueAt(own, key), source: { kind: "own", onReset: reset } };
  return {
    value: valueAt(fromAbove.values, key),
    source: { kind: "inherited", from: fromAbove.name },
  };
}

// tags that a role list can hold beside its roles; instance settings have no tags to offer
function useTagChoices(
  scope: OwnScope,
  wanted: boolean,
): { tagChoices: Tuple<SearchSelectOption>; tagsLoaded: boolean } {
  const t = useT();
  const viewer = useEventViewer();
  const orgId =
    scope.orgId ?? (scope.eventId && viewer?.event.id === scope.eventId ? viewer.event.org_id : "");
  const tags = useQuery({
    ...tagsQueryOptions({ orgId, eventId: scope.eventId }),
    enabled: wanted && scope.scope !== "instance" && orgId !== "",
  });
  return {
    tagChoices: (tags.data ?? []).map((tag) => ({
      value: tagRef(tag.id),
      label: tag.name,
      group: t("tags.title"),
    })),
    tagsLoaded: tags.isSuccess,
  };
}

export function SettingFields<N extends CoreNamespace>({
  scope,
  namespace,
  keys,
  placeholders,
  onSaved,
}: {
  scope: OwnScope;
  namespace: N;
  keys: Tuple<keyof SettingsValue<N> & string>;
  placeholders?: Partial<Record<keyof SettingsValue<N> & string, string>>;
  onSaved?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: own } = useSuspenseQuery(ownSettingsQueryOptions(scope, namespace));
  const { data: inherited } = useSuspenseQuery(inheritedSettingsQueryOptions(scope, namespace));
  const below = scopesBelow(namespace, scope.scope);
  const locks = useQuery({ ...ownLocksQueryOptions(scope, namespace), enabled: below.length > 0 });
  const setLock = useMutation({
    mutationFn: async ({ key, locked }: { key: string; locked: boolean }) =>
      unwrap(
        await setSettingLockFn({ data: { ...scope, namespace, key, locked } }).catch(
          requestFailure,
        ),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const lockFor = (key: string): SettingLock | undefined => {
    if (below.length === 0 || !locks.data) return undefined;
    const pending = setLock.isPending && setLock.variables.key === key;
    return {
      locked: pending ? setLock.variables.locked : locks.data.includes(key),
      below: describe(below, t, locale),
      onChange: (locked) => setLock.mutate({ key, locked }),
    };
  };
  const save = useMutation({
    mutationFn: async (changes: Record<string, unknown>) =>
      unwrap(
        await updateSettingsFn({ data: { ...scope, namespace, changes } }).catch(requestFailure),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      onSaved?.();
    },
  });
  const { tagChoices, tagsLoaded } = useTagChoices(
    scope,
    keys.some((key) => {
      const control = settingControl(namespace, key);
      return control?.kind === "multiselect" && control.withTags;
    }),
  );
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [generation, setGeneration] = useState(0);
  const change = (changes: Record<string, unknown>) =>
    setDraft((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(changes)) {
        const unchanged = has(own, key)
          ? sameSetting(value, valueAt(own, key))
          : value === null ||
            sameSetting(value, resolve(scope.scope, key, own, inherited, () => {}, t).value);
        if (unchanged) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  const clear = () => {
    setDraft({});
    setGeneration((count) => count + 1);
  };
  useUnsavedEntry({
    dirty: Object.keys(draft).length > 0,
    save: async () => {
      try {
        await save.mutateAsync(draft);
        clear();
        return true;
      } catch {
        return false;
      }
    },
    reset: clear,
  });

  return (
    <>
      {keys.map((key) => {
        const control = settingControl(namespace, key);
        if (!control) return null;
        const id = `${namespace}-${key}`;
        const drafted = key in draft;
        const ownNow = drafted ? { ...own, [key]: draft[key] ?? undefined } : own;
        const resolved = resolve(
          scope.scope,
          key,
          ownNow,
          inherited,
          () => {
            change({ [key]: null });
            setGeneration((count) => count + 1);
          },
          t,
        );
        const value = resolved.value;
        const source: SettingSource = isOperatorKey(namespace, scope.scope, key)
          ? { kind: "operator", path: operatorConfigPath(namespace, key) }
          : resolved.source;
        const disabled = source.kind === "locked" || source.kind === "operator";
        const placeholder =
          placeholders?.[key] ?? ("placeholder" in control ? control.placeholder : undefined);
        const label = sayOr(t, `setting.${namespace}.${key}`, control.label);
        const description = control.description
          ? sayOr(t, `setting.${namespace}.${key}.help`, control.description)
          : undefined;

        const row = {
          id,
          anchor: `${namespace}.${key}`,
          keyName: key,
          label,
          description,
          source,
          lock: source.kind === "operator" ? undefined : lockFor(key),
        };

        switch (control.kind) {
          case "switch":
            return (
              <SettingRow key={key} {...row} layout="switch">
                <Switch
                  id={id}
                  checked={value === true}
                  disabled={disabled}
                  onCheckedChange={(checked) => change({ [key]: checked })}
                />
              </SettingRow>
            );
          case "number":
            return (
              <SettingRow key={key} {...row} layout="row">
                <NumberInput
                  key={generation}
                  id={id}
                  defaultValue={typeof value === "number" ? value : undefined}
                  min={control.min}
                  max={control.max}
                  step={control.integer ? 1 : "any"}
                  placeholder={placeholder}
                  emptyLabel={control.empty && t(EMPTY_LABEL[control.empty])}
                  disabled={disabled}
                  scrub={scope.scope !== "event"}
                  onValueChange={(next) => change({ [key]: next })}
                />
              </SettingRow>
            );
          case "multiselect":
            return (
              <SettingRow key={key} {...row}>
                <MultiSelect
                  id={id}
                  value={
                    Array.isArray(value)
                      ? value.filter(
                          (item): item is string =>
                            typeof item === "string" &&
                            // a deleted tag drops out of the list, once the tags are in
                            (!TAG_REF.test(item) ||
                              !tagsLoaded ||
                              tagChoices.some((tag) => tag.value === item)),
                        )
                      : []
                  }
                  always={control.always}
                  options={[
                    ...control.options.map((option) => ({
                      value: option.value,
                      label: sayOr(t, `setting.${namespace}.${key}.${option.value}`, option.label),
                      group:
                        control.withTags && tagChoices.length > 0
                          ? t("settingFields.roles")
                          : undefined,
                    })),
                    ...(control.withTags ? tagChoices : []),
                  ]}
                  disabled={disabled}
                  onValueChange={(next) => change({ [key]: next })}
                />
              </SettingRow>
            );
          case "text":
            return (
              <SettingRow key={key} {...row}>
                <Input
                  key={generation}
                  id={id}
                  defaultValue={typeof value === "string" ? value : ""}
                  placeholder={placeholder}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = event.target.value.trim();
                    change({ [key]: next === "" ? null : next });
                  }}
                />
              </SettingRow>
            );
          case "select":
            return (
              <SettingRow key={key} {...row} layout="row">
                <OptSelect
                  id={id}
                  value={typeof value === "string" ? value : ""}
                  options={control.options.map((option) => ({
                    ...option,
                    label: sayOr(t, `setting.${namespace}.${key}.${option.value}`, option.label),
                  }))}
                  disabled={disabled}
                  onChange={(next) => change({ [key]: next })}
                />
              </SettingRow>
            );
        }
      })}
      <ErrorAlert error={save.error} title={t("settingFields.saveFailed")} />
      <ErrorAlert error={setLock.error} title={t("settingFields.lockFailed")} />
    </>
  );
}

const EMPTY_LABEL = {
  noLimit: "settingFields.noLimit",
  off: "settingFields.off",
} as const satisfies Record<SettingEmpty, PlainKey>;

const BELOW_LABEL = {
  instance: "settingSource.instance",
  org: "settingSource.orgs",
  event: "settingSource.events",
} as const satisfies Record<SettingScope, PlainKey>;

function describe(scopes: Tuple<SettingScope>, t: T, locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
    scopes.map((scope) => t(BELOW_LABEL[scope])),
  );
}

export function prefetchSettingFields(
  query: QueryClient,
  scope: OwnScope,
  namespaces: Tuple<CoreNamespace>,
): Promise<unknown[]> {
  return Promise.all(
    namespaces.flatMap((namespace) => [
      query.query({ ...ownSettingsQueryOptions(scope, namespace), staleTime: "static" }),
      query.query({ ...inheritedSettingsQueryOptions(scope, namespace), staleTime: "static" }),
      ...(scopesBelow(namespace, scope.scope).length > 0
        ? [query.query({ ...ownLocksQueryOptions(scope, namespace), staleTime: "static" })]
        : []),
    ]),
  );
}

export interface SettingLock {
  locked: boolean;
  below: string;
  onChange: (locked: boolean) => void;
}

export type SettingSource =
  | { kind: "own"; onReset: () => void }
  | { kind: "inherited"; from?: string }
  | { kind: "locked"; by: string }
  | { kind: "operator"; path?: string | null };

function Label({
  id,
  label,
  keyName,
  source,
  lock,
}: {
  id: string;
  label: string;
  keyName?: string;
  source: SettingSource;
  lock?: SettingLock;
}) {
  const t = useT();
  const lockLabel = lock
    ? lock.locked
      ? t("settingRow.unlockFor", { below: lock.below })
      : t("settingRow.lockFor", { below: lock.below })
    : "";
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={id} title={keyName}>
        {label}
      </FieldLabel>
      {source.kind === "own" && (
        <Button
          type="button"
          variant="ghost"
          size="icon-3xs"
          aria-label={t("settingRow.reset")}
          tooltip={t("settingRow.reset")}
          onClick={source.onReset}
        >
          <IconArrowBack />
        </Button>
      )}
      <div className="flex items-center gap-0.5">
        {lock && (
          <Button
            type="button"
            variant="ghost"
            size="icon-2xs"
            aria-pressed={lock.locked}
            aria-label={lockLabel}
            tooltip={lockLabel}
            className={
              lock.locked
                ? "text-fg"
                : "text-muted-fg transition-opacity md:opacity-0 md:group-hover/setting:opacity-100 md:group-focus-within/setting:opacity-100"
            }
            onClick={() => lock.onChange(!lock.locked)}
          >
            {lock.locked ? <IconLock /> : <IconLockOpen />}
          </Button>
        )}
        {lock?.locked && <span className="text-xs text-muted-fg">{t("settingRow.locked")}</span>}
      </div>
    </div>
  );
}

// where a value comes from, when it isn't set here
function origin(source: SettingSource, t: T): string | null {
  switch (source.kind) {
    case "locked":
      return t("settingRow.lockedBy", { by: source.by });
    case "operator":
      return source.path
        ? t("settingRow.operatorAt", { path: source.path })
        : t("settingRow.operator");
    case "inherited":
      return source.from ? t("settingRow.from", { from: source.from }) : null;
    case "own":
      return null;
  }
}

/** One setting: its label with reset and lock buttons, where its value comes from, and its control. */
export function SettingRow({
  id,
  anchor,
  keyName,
  label,
  description,
  source = { kind: "inherited" },
  layout = "stack",
  lock,
  children,
}: {
  id: string;
  anchor?: string;
  keyName?: string;
  label: string;
  description?: ReactNode;
  source?: SettingSource;
  layout?: "stack" | "row" | "switch";
  lock?: SettingLock;
  children: ReactNode;
}) {
  const t = useT();
  const from = origin(source, t);
  return (
    <FieldFrame
      id={anchor}
      layout={layout}
      className="group/setting jump-target"
      label={<Label id={id} label={label} keyName={keyName} source={source} lock={lock} />}
      description={description}
      note={from && <p className="text-xs text-muted-fg">{from}</p>}
    >
      {children}
    </FieldFrame>
  );
}
