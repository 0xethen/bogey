import { pluginMenubarItems, readPluginSettings, type PluginMenubarKind } from "@bogey/plugins";
import { useViewerSession } from "#/lib/viewer.ts";

/** Plugins' menubar items of one kind: icon buttons beside the bell, or menus beside the account menu. */
export function PluginMenubarItems({ kind }: { kind: PluginMenubarKind }) {
  const session = useViewerSession();
  if (!session) return null;
  return pluginMenubarItems(kind).map(({ key, manifest, Component }) => (
    <Component key={key} settings={readPluginSettings(manifest, {})} session={session} />
  ));
}
