import { useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { unwrap } from "@bogey/db/errors";
import type { OwnScope } from "@bogey/db/queries/settings";
import {
  isSettingVisible,
  loadedPluginSlots,
  readPluginSettings,
  settingsEditableAt,
  settingsLockedAbove,
  type PluginManifest,
  type PluginSetting,
} from "@bogey/plugins";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldGroup } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { NumberInput } from "@bogey/ui/components/number-field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Switch } from "@bogey/ui/components/switch";
import { Textarea } from "@bogey/ui/components/textarea";
import { useUnsavedEntry } from "@bogey/ui/lib/unsaved";
import { useQuery } from "@tanstack/react-query";
import { useT } from "#/lib/translate.tsx";
import { SettingRow } from "../fields/setting-fields.tsx";
import {
  ownPluginSettingsQueryOptions,
  pluginOrgSettingsQueryOptions,
  pluginSettingsQueryOptions,
  savePluginSettings,
} from "#/lib/plugins.ts";

type Value = string | number | boolean;

function layoutOf(setting: PluginSetting): "stack" | "row" | "switch" {
  if (setting.type === "boolean") return "switch";
  if (setting.type === "string") return "stack";
  return "row";
}

function Control({
  id,
  setting,
  value,
  scrub,
  onChange,
}: {
  id: string;
  setting: PluginSetting;
  value: Value;
  scrub: boolean;
  onChange: (value: Value) => void;
}) {
  switch (setting.type) {
    case "boolean":
      return <Switch id={id} checked={value === true} onCheckedChange={onChange} />;
    case "number":
      return (
        <NumberInput
          id={id}
          scrub={scrub || setting.scrub === true}
          min={setting.min}
          max={setting.max}
          // plugin API 1 used the placeholder as what 0 shows as
          emptyLabel={setting.emptyLabel ?? setting.placeholder}
          value={typeof value === "number" ? value : null}
          onValueChange={(next) => {
            if (next !== null) onChange(next);
          }}
        />
      );
    case "select":
      return (
        <OptSelect id={id} value={String(value)} options={setting.options} onChange={onChange} />
      );
    case "string":
      return setting.multiline ? (
        <Textarea
          id={id}
          rows={4}
          placeholder={setting.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          placeholder={setting.placeholder}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function LockedSettings({
  scope,
  manifest,
  only,
}: {
  scope: OwnScope;
  manifest: PluginManifest;
  only?: Tuple<string>;
}) {
  const t = useT();
  const locked = settingsLockedAbove(manifest, scope.scope).filter(
    ([name]) => !only || only.includes(name),
  );
  const orgId = scope.orgId;
  const eventId = scope.eventId;
  const wanted = locked.length > 0;
  const forEvent = useQuery({
    ...pluginSettingsQueryOptions(eventId ?? "", manifest.key),
    enabled: wanted && scope.scope === "event" && !!eventId,
  });
  const forOrg = useQuery({
    ...pluginOrgSettingsQueryOptions(orgId ?? "", manifest.key),
    enabled: wanted && scope.scope !== "event" && !!orgId,
  });
  const resolved = scope.scope === "event" ? forEvent : forOrg;
  if (locked.length === 0) return null;
  const values: Record<string, Value> = readPluginSettings(manifest, resolved.data);
  return (
    <FieldGroup className="gap-10">
      {locked.map(([name, setting]) => {
        const id = `${manifest.key}-${name}-locked`;
        return (
          <SettingRow
            key={name}
            id={id}
            anchor={`${manifest.key}.${name}`}
            label={setting.label}
            description={setting.description}
            source={{
              kind: "locked",
              by: t(setting.lock === "instance" ? "settingSource.instance" : "settingSource.org"),
            }}
            layout={layoutOf(setting)}
          >
            <fieldset disabled>
              <Control
                id={id}
                setting={setting}
                value={values[name] ?? ""}
                scrub={false}
                onChange={() => undefined}
              />
            </fieldset>
          </SettingRow>
        );
      })}
    </FieldGroup>
  );
}

export function PluginSettings({
  scope,
  manifest,
  only,
}: {
  scope: OwnScope;
  manifest: PluginManifest;
  only?: Tuple<string>;
}) {
  const queryClient = useQueryClient();
  const { data: own } = useSuspenseQuery(ownPluginSettingsQueryOptions(scope, manifest.key));
  const editable = settingsEditableAt(manifest, scope.scope);
  const fields = only
    ? only.flatMap((name) => editable.filter(([each]) => each === name))
    : editable;
  const current: Record<string, Value> = readPluginSettings(manifest, own);
  const [draft, setDraft] = useState<Record<string, Value>>(current);
  // saved values that change elsewhere (a preset, another section) replace the ones not being edited
  const [base, setBase] = useState<Record<string, Value>>(current);
  const moved = fields.filter(([name]) => !Object.is(base[name], current[name]));
  if (moved.length > 0) {
    setBase(current);
    setDraft({
      ...draft,
      ...Object.fromEntries(
        moved
          .filter(([name]) => Object.is(draft[name], base[name]))
          .map(([name]) => [name, current[name]]),
      ),
    });
  }
  const changes = () =>
    Object.fromEntries(
      fields
        .map(([name]) => name)
        .filter((name) => !Object.is(draft[name], current[name]))
        .map((name) => [name, draft[name]]),
    );
  const save = useMutation({
    mutationFn: async () => unwrap(await savePluginSettings(scope, manifest.key, changes())),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  useUnsavedEntry({
    dirty: fields.some(([name]) => !Object.is(draft[name], current[name])),
    save: async () => {
      try {
        await save.mutateAsync();
        return true;
      } catch {
        return false;
      }
    },
    reset: () => setDraft(current),
  });

  if (fields.length === 0) return <LockedSettings scope={scope} manifest={manifest} only={only} />;
  const shown = fields.filter(([name]) => isSettingVisible(manifest, name, draft));
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup className="gap-10">
        {shown.map(([name, setting]) => {
          const id = `${manifest.key}-${name}`;
          const Custom = loadedPluginSlots().find((loaded) => loaded.key === manifest.key)?.slots
            .settingControls?.[name];
          const control = Custom ? (
            <Custom
              id={id}
              value={draft[name] ?? ""}
              onChange={(value) => setDraft({ ...draft, [name]: value })}
            />
          ) : (
            <Control
              id={id}
              setting={setting}
              value={draft[name] ?? ""}
              scrub={scope.scope !== "event"}
              onChange={(value) => setDraft({ ...draft, [name]: value })}
            />
          );
          return (
            <SettingRow
              key={name}
              id={id}
              anchor={`${manifest.key}.${name}`}
              label={setting.label}
              description={setting.description}
              layout={Custom ? "stack" : layoutOf(setting)}
            >
              {control}
            </SettingRow>
          );
        })}
      </FieldGroup>
      <LockedSettings scope={scope} manifest={manifest} only={only} />
      <ErrorAlert error={save.error} title="Couldn't save the plugin's settings" />
    </div>
  );
}
