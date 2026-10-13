import { installedPlugins, pluginEmailKinds } from "@bogey/plugins";
import type { EmailKind } from "@bogey/config/email";

export function findPluginEmailKind(key: string): { key: string; kind: EmailKind } | undefined {
  return pluginEmailKinds(installedPlugins()).find((entry) => entry.key === key);
}
