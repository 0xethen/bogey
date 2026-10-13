import { useNavigate } from "@tanstack/react-router";
import { useHotkey, type Hotkey } from "@tanstack/react-hotkeys";
import { can } from "@bogey/db/permissions";
import type { PluginHotkeyDeclaration, PluginManifest } from "@bogey/plugins";
import { eventPluginPath } from "#/lib/plugins.ts";
import { usePluginShortcutKeys } from "#/lib/shortcuts.ts";
import type { EventViewer } from "#/lib/viewer.ts";

export function PluginHotkeys({ viewer }: { viewer: EventViewer }) {
  return viewer.plugins.flatMap((manifest) =>
    (manifest.hotkeys ?? []).map((hotkey) => (
      <PluginHotkey
        key={`${manifest.key}.${hotkey.id}`}
        manifest={manifest}
        hotkey={hotkey}
        viewer={viewer}
      />
    )),
  );
}

function PluginHotkey({
  manifest,
  hotkey,
  viewer,
}: {
  manifest: PluginManifest;
  hotkey: PluginHotkeyDeclaration;
  viewer: EventViewer;
}) {
  const { keys } = usePluginShortcutKeys(manifest.key, hotkey);
  const permission = manifest.routes?.find((route) => route.path === hotkey.path)?.permission;
  if (!keys || (permission && !can(viewer.access, permission))) return null;
  return (
    <BoundHotkey
      keys={keys}
      href={eventPluginPath(viewer.event.slug, manifest.key, hotkey.path)}
      meta={{ name: hotkey.label, description: hotkey.description ?? "", group: manifest.name }}
    />
  );
}

function BoundHotkey({
  keys,
  href,
  meta,
}: {
  keys: Hotkey;
  href: string;
  meta: { name: string; description: string; group: string };
}) {
  const navigate = useNavigate();
  useHotkey(keys, () => void navigate({ href }), { meta });
  return null;
}
