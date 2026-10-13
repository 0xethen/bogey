import type { PluginManifest } from "@bogey/plugins";
import type { T } from "#/lib/translate.tsx";

export function pluginAdds(manifest: PluginManifest, t: T): string {
  const settings = Object.keys(manifest.settings ?? {}).length;
  const parts = [
    [(manifest.routes ?? []).length, (count: number) => t("ext.pages", { count })],
    [settings, (count: number) => t("ext.settings", { count })],
    [(manifest.eventTypes ?? []).length, (count: number) => t("ext.eventTypes", { count })],
    [(manifest.windows ?? []).length, (count: number) => t("ext.windows", { count })],
    [(manifest.roles ?? []).length, (count: number) => t("ext.roles", { count })],
    [(manifest.permissions ?? []).length, (count: number) => t("ext.permissions", { count })],
    [(manifest.commands ?? []).length, (count: number) => t("ext.commands", { count })],
    [(manifest.accountLinks ?? []).length, (count: number) => t("ext.links", { count })],
    [(manifest.actions ?? []).length, (count: number) => t("ext.actions", { count })],
  ] as const;
  const shown = parts.filter(([count]) => count > 0).map(([count, say]) => say(count));
  return shown.length ? shown.join(" · ") : t("ext.panelsOnly");
}

export function pluginMeta(manifest: PluginManifest, t: T): string {
  return [`v${manifest.version}`, t("ext.by", { name: manifest.author.name }), manifest.license]
    .filter(Boolean)
    .join(" · ");
}

export function pluginUses(manifest: PluginManifest, t: T): string[] {
  const uses = manifest.uses;
  if (!uses) return [];
  return [
    uses.tables?.length ? t("ext.tables", { list: uses.tables.join(", ") }) : "",
    uses.network?.length ? t("ext.calls", { list: uses.network.join(", ") }) : "",
    uses.settings?.length ? t("ext.reads", { list: uses.settings.join(", ") }) : "",
  ].filter(Boolean);
}
