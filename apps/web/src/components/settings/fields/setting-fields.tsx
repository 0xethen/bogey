import { useState } from "react";
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
  type SettingScope,
  type SettingsValue,
} from "@bogey/config/settings";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { useUnsavedEntry } from "@bogey/ui/lib/unsaved";
import { Input } from "@bogey/ui/components/input";
import { NumberInput } from "@bogey/ui/components/number-field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { MultiSelect } from "@bogey/ui/components/search-select";
import { SettingRow, type SettingLock, type SettingSource } from "./setting-row.tsx";
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

        return control.kind === "switch" ? (
          <SettingRow
            key={key}
            id={id}
            anchor={`${namespace}.${key}`}
            keyName={key}
            label={label}
            description={description}
            source={source}
            lock={source.kind === "operator" ? undefined : lockFor(key)}
            inline
          >
            <Switch
              id={id}
              checked={value === true}
              disabled={disabled}
              onCheckedChange={(checked) => change({ [key]: checked })}
            />
          </SettingRow>
        ) : control.kind === "number" ? (
          <SettingRow
            key={key}
            id={id}
            anchor={`${namespace}.${key}`}
            keyName={key}
            label={label}
            description={description}
            source={source}
            lock={source.kind === "operator" ? undefined : lockFor(key)}
          >
            <NumberSetting
              key={generation}
              id={id}
              value={typeof value === "number" ? value : null}
              min={control.min}
              max={control.max}
              step={control.integer ? 1 : "any"}
              placeholder={placeholder}
              disabled={disabled}
              scrub={scope.scope !== "event"}
              onValueChange={(next) => change({ [key]: next })}
            />
          </SettingRow>
        ) : control.kind === "multiselect" ? (
          <SettingRow
            key={key}
            id={id}
            anchor={`${namespace}.${key}`}
            keyName={key}
            label={label}
            description={description}
            source={source}
            lock={source.kind === "operator" ? undefined : lockFor(key)}
          >
            <MultiSelect
              id={id}
              value={Array.isArray(value) ? value.filter((item) => typeof item === "string") : []}
              always={control.always}
              options={control.options.map((option) => ({
                value: option.value,
                label: sayOr(t, `setting.${namespace}.${key}.${option.value}`, option.label),
              }))}
              disabled={disabled}
              onValueChange={(next) => change({ [key]: next })}
            />
          </SettingRow>
        ) : control.kind === "text" ? (
          <SettingRow
            key={key}
            id={id}
            anchor={`${namespace}.${key}`}
            keyName={key}
            label={label}
            description={description}
            source={source}
            lock={source.kind === "operator" ? undefined : lockFor(key)}
          >
            <TextSetting
              key={generation}
              id={id}
              value={typeof value === "string" ? value : ""}
              placeholder={placeholder}
              disabled={disabled}
              onValueChange={(next) => change({ [key]: next })}
            />
          </SettingRow>
        ) : (
          <SettingRow
            key={key}
            id={id}
            anchor={`${namespace}.${key}`}
            keyName={key}
            label={label}
            description={description}
            source={source}
            lock={source.kind === "operator" ? undefined : lockFor(key)}
          >
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
      })}
      <ErrorAlert error={save.error} title={t("settingFields.saveFailed")} />
      <ErrorAlert error={setLock.error} title={t("settingFields.lockFailed")} />
    </>
  );
}

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

function NumberSetting({
  id,
  value,
  min,
  max,
  step,
  placeholder,
  disabled,
  scrub,
  onValueChange,
}: {
  id: string;
  value: number | null;
  min?: number;
  max?: number;
  step: number | "any";
  placeholder?: string;
  disabled: boolean;
  scrub: boolean;
  onValueChange: (value: number | null) => void;
}) {
  const [initial] = useState(value);
  return (
    <NumberInput
      id={id}
      className="max-w-56"
      scrub={scrub}
      defaultValue={initial ?? undefined}
      min={min}
      max={max}
      step={step}
      placeholder={placeholder}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next)}
    />
  );
}

function TextSetting({
  id,
  value,
  placeholder,
  disabled,
  onValueChange,
}: {
  id: string;
  value: string;
  placeholder?: string;
  disabled: boolean;
  onValueChange: (value: string | null) => void;
}) {
  const [initial] = useState(value);
  return (
    <Input
      id={id}
      defaultValue={initial}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => {
        const next = event.target.value.trim();
        onValueChange(next === "" ? null : next);
      }}
    />
  );
}

export function prefetchSettingFields(
  query: QueryClient,
  scope: OwnScope,
  namespaces: Tuple<CoreNamespace>,
): Promise<unknown[]> {
  return Promise.all(
    namespaces.flatMap((namespace) => [
      query.ensureQueryData(ownSettingsQueryOptions(scope, namespace)),
      query.ensureQueryData(inheritedSettingsQueryOptions(scope, namespace)),
      ...(scopesBelow(namespace, scope.scope).length > 0
        ? [query.ensureQueryData(ownLocksQueryOptions(scope, namespace))]
        : []),
    ]),
  );
}
