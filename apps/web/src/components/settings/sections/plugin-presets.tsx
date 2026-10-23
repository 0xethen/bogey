import { useState } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { IconArrowRight, IconCheck } from "@tabler/icons-react";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { updateEventFn } from "@bogey/db/queries/manage";
import {
  readPluginSettings,
  settingsEditableAt,
  type PluginManifest,
  type PluginSetting,
  type PluginSettingsPreset,
} from "@bogey/plugins";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import { ownPluginSettingsQueryOptions, savePluginSettings } from "#/lib/plugins.ts";
import { useT, type T } from "#/lib/translate.tsx";

const eventRoute = getRouteApi("/_authed/events/$slug");

type Value = string | number | boolean;

interface Change {
  name: string;
  label: string;
  from: string;
  to: string;
}

function shown(t: T, setting: PluginSetting, value: Value | undefined): string {
  if (value === undefined) return t("pluginPresets.empty");
  if (setting.type === "boolean") return t(value ? "pluginPresets.on" : "pluginPresets.off");
  if (setting.type === "select") {
    return setting.options.find((option) => option.value === value)?.label ?? String(value);
  }
  return String(value) === "" ? t("pluginPresets.empty") : String(value);
}

function teamText(t: T, min: number, max: number): string {
  if (max === 1) return t("pluginPresets.teamOne");
  if (min === max) return t("pluginPresets.teamExact", { count: max });
  return t("pluginPresets.teamRange", { min, max });
}

/** A plugin's presets for one settings page: pick one to see what it changes, then apply it. */
export function PluginPresets({
  manifest,
  presets,
}: {
  manifest: PluginManifest;
  presets: Tuple<PluginSettingsPreset>;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { event } = eventRoute.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  const { data: own } = useSuspenseQuery(ownPluginSettingsQueryOptions(scope, manifest.key));
  const current: Record<string, Value> = readPluginSettings(manifest, own);
  const editable = new Set(settingsEditableAt(manifest, "event").map(([name]) => name));
  const [picked, setPicked] = useState<string | null>(null);

  const changesOf = (preset: PluginSettingsPreset): Change[] => {
    const rows = Object.entries(preset.values).flatMap(([name, value]) => {
      const setting = manifest.settings?.[name];
      if (!setting || !editable.has(name) || Object.is(current[name], value)) return [];
      return [
        {
          name,
          label: setting.label,
          from: shown(t, setting, current[name]),
          to: shown(t, setting, value),
        },
      ];
    });
    const team = preset.teamSize;
    if (team && (team[0] !== event.team_size_min || team[1] !== event.team_size_max)) {
      rows.push({
        name: "",
        label: `${t("pluginPresets.teamSize")} (${t("pluginPresets.teamSizeHelp")})`,
        from: teamText(t, event.team_size_min, event.team_size_max),
        to: teamText(t, team[0], team[1]),
      });
    }
    return rows;
  };

  const apply = useMutation({
    mutationFn: async (preset: PluginSettingsPreset) => {
      const changes = Object.fromEntries(
        Object.entries(preset.values).filter(
          ([name, value]) => editable.has(name) && !Object.is(current[name], value),
        ),
      );
      if (Object.keys(changes).length > 0) {
        unwrap(await savePluginSettings(scope, manifest.key, changes));
      }
      const team = preset.teamSize;
      if (team && (team[0] !== event.team_size_min || team[1] !== event.team_size_max)) {
        unwrap(
          await updateEventFn({
            data: { eventId: event.id, teamSizeMin: team[0], teamSizeMax: team[1] },
          }).catch(requestFailure),
        );
        await router.invalidate();
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      setPicked(null);
    },
  });

  const open = presets.find((preset) => preset.key === picked);
  const changes = open ? changesOf(open) : [];

  return (
    <Screen.Section
      id={`${manifest.key}-presets`}
      title={t("pluginPresets.title")}
      description={t("pluginPresets.help")}
      actions={<Badge variant="outline">{manifest.name}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {presets.map((preset) => {
            const matches = changesOf(preset).length === 0;
            const active = preset.key === picked;
            return (
              <button
                key={preset.key}
                type="button"
                aria-expanded={active}
                aria-controls={`${manifest.key}-preset-changes`}
                onClick={() => {
                  apply.reset();
                  setPicked(active ? null : preset.key);
                }}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border border-border p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "border-primary bg-muted",
                )}
              >
                <span className="flex w-full items-center gap-2 font-medium">
                  {preset.label}
                  {matches && (
                    <Badge variant="secondary" className="ml-auto">
                      <IconCheck />
                      {t("pluginPresets.current")}
                    </Badge>
                  )}
                </span>
                {preset.description && <span className="text-muted-fg">{preset.description}</span>}
              </button>
            );
          })}
        </div>
        {open && (
          <div
            id={`${manifest.key}-preset-changes`}
            className="flex flex-col gap-3 rounded-xl border border-border p-4"
          >
            {changes.length === 0 ? (
              <p className="text-sm text-muted-fg">
                {t("pluginPresets.nothing", { name: open.label })}
              </p>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {t("pluginPresets.changes", { name: open.label })}
                </p>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {changes.map((change) => (
                    <li
                      key={change.name || "team"}
                      className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="sm:w-2/5">{change.label}</span>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <span className="text-muted-fg line-through">{change.from}</span>
                        <IconArrowRight aria-hidden className="size-4 shrink-0 text-muted-fg" />
                        <span className="font-medium">{change.to}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <ErrorAlert error={apply.error} title={t("pluginPresets.failed")} />
            <div className="flex flex-wrap gap-2">
              {changes.length > 0 && (
                <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(open)}>
                  {apply.isPending
                    ? t("pluginPresets.applying")
                    : t("pluginPresets.apply", { name: open.label })}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Screen.Section>
  );
}
