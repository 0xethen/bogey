import { use, type JSX } from "react";
import { notFound } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import {
  loadPluginRuntime,
  matchPluginRoute,
  type PluginManifest,
  type PluginPageContext,
  type PluginRouteArea,
  type PluginSignedInArea,
} from "@bogey/plugins";

export interface FoundPluginPage {
  manifest: PluginManifest;
  pluginPath: string;
  splat: string;
  pluginTitle: string;
  permission?: string;
}

export function findPluginPage(
  plugins: Tuple<PluginManifest>,
  area: PluginRouteArea,
  params: { key: string; _splat?: string },
): FoundPluginPage {
  const manifest = plugins.find((plugin) => plugin.key === params.key);
  const match = manifest ? matchPluginRoute(manifest, area, params._splat) : null;
  if (!manifest || !match) throw notFound();
  return {
    manifest,
    pluginPath: match.route.path,
    splat: match.splat,
    pluginTitle: match.route.label ?? manifest.name,
    ...(match.route.permission ? { permission: match.route.permission } : {}),
  };
}

export async function loadPluginPage<A extends PluginSignedInArea>(
  area: A,
  page: FoundPluginPage,
  context: PluginPageContext<A>,
  queryClient: QueryClient,
): Promise<{ title: string }> {
  const runtime = await loadPluginRuntime(page.manifest.key);
  const definition = runtime?.routes[area][page.pluginPath];
  if (!definition) throw notFound();
  const loaderContext = { ...context, queryClient };
  await definition.loader?.(loaderContext);
  return { title: (await definition.title?.(loaderContext)) ?? page.pluginTitle };
}

export function PluginPage<A extends PluginSignedInArea>({
  area,
  page,
  context,
}: {
  area: A;
  page: FoundPluginPage;
  context: PluginPageContext<A> & JSX.IntrinsicAttributes;
}) {
  const runtime = use(loadPluginRuntime(page.manifest.key));
  const Page = runtime?.routes[area][page.pluginPath]?.component;
  return Page ? <Page {...context} /> : null;
}
