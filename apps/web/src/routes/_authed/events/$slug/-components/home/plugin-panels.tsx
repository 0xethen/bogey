import { use } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import type { Session } from "@bogey/db/auth";
import { loadPluginRuntime, readPluginSettings, type PluginManifest } from "@bogey/plugins";
import { PluginBoundary } from "#/components/plugins/plugin-boundary.tsx";
import { pluginSettingsQueryOptions } from "#/lib/plugins.ts";

export function homePanelsOf(manifest: PluginManifest) {
  return manifest.homePanels ?? [];
}

export function panelFor(manifest: PluginManifest, panel: string | undefined) {
  const panels = homePanelsOf(manifest);
  return panels.find((each) => each.key === panel) ?? (panel === undefined ? panels[0] : undefined);
}

function PluginPanel({
  manifest,
  panel,
  eventId,
  session,
}: {
  manifest: PluginManifest;
  panel: string;
  eventId: string;
  session: Session;
}) {
  const runtime = use(loadPluginRuntime(manifest.key));
  const { data: stored } = useSuspenseQuery(pluginSettingsQueryOptions(eventId, manifest.key));
  const Panel = runtime?.homePanels[panel];
  return Panel ? (
    <Panel eventId={eventId} settings={readPluginSettings(manifest, stored)} session={session} />
  ) : null;
}

export function PluginHomePanel({
  manifest,
  panel,
  eventId,
  session,
}: {
  manifest: PluginManifest;
  panel: string;
  eventId: string;
  session: Session;
}) {
  return (
    <PluginBoundary name={manifest.name}>
      <PluginPanel manifest={manifest} panel={panel} eventId={eventId} session={session} />
    </PluginBoundary>
  );
}
