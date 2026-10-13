import { use, type ReactNode } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  findPlugin,
  loadPluginRuntime,
  readPluginSettings,
  type PluginSlots,
} from "@bogey/plugins";
import { PluginBoundary } from "#/components/plugins/plugin-boundary.tsx";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";

export function PluginSlot({
  pluginKey,
  eventId,
  missing = null,
  children,
}: {
  pluginKey: string;
  eventId: string;
  missing?: ReactNode;
  children: (input: { slots: PluginSlots; settings: Record<string, unknown> }) => ReactNode;
}) {
  const manifest = findPlugin(pluginKey);
  if (!manifest) return missing;
  return (
    <PluginBoundary name={manifest.name}>
      <Loaded pluginKey={pluginKey} eventId={eventId}>
        {children}
      </Loaded>
    </PluginBoundary>
  );
}

function Loaded({
  pluginKey,
  eventId,
  children,
}: {
  pluginKey: string;
  eventId: string;
  children: (input: { slots: PluginSlots; settings: Record<string, unknown> }) => ReactNode;
}) {
  const manifest = findPlugin(pluginKey);
  const runtime = use(loadPluginRuntime(pluginKey));
  const { data: stored } = useSuspenseQuery(pluginSettingsQueryOptions(eventId, pluginKey));
  if (!manifest || !runtime) return null;
  return children({ slots: runtime.slots, settings: readPluginSettings(manifest, stored) });
}
