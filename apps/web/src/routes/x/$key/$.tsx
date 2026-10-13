import { use } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { installedPlugins, loadPluginRuntime } from "@bogey/plugins";
import { findPluginPage } from "#/lib/plugin-pages.tsx";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/x/$key/$")({
  staticData: { title: msg("page.plugin") },
  beforeLoad: ({ params }) => ({ page: findPluginPage(installedPlugins(), "public", params) }),
  loader: async ({ context }) => {
    const runtime = await loadPluginRuntime(context.page.manifest.key);
    if (!runtime?.publicRoutes[context.page.pluginPath]) throw notFound();
    return { title: context.page.pluginTitle };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { page } = Route.useRouteContext();
  const runtime = use(loadPluginRuntime(page.manifest.key));
  const Page = runtime?.publicRoutes[page.pluginPath];
  return Page ? <Page splat={page.splat} /> : null;
}
