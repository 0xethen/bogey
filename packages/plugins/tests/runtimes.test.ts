import { expect, test } from "vite-plus/test";
import { routeArea } from "../src/api.ts";
import { installedPlugins, loadPluginRuntime } from "../src/registry.ts";

test.each(installedPlugins().map((manifest) => [manifest.key, manifest] as const))(
  "%s implements every route it declares",
  async (_key, manifest) => {
    const runtime = await loadPluginRuntime(manifest.key);
    expect(runtime).toBeDefined();

    for (const route of manifest.routes ?? []) {
      const area = routeArea(route);
      const implementation =
        area === "public"
          ? runtime?.publicRoutes[route.path]
          : runtime?.routes[area][route.path]?.component;

      expect(implementation).toBeTypeOf("function");
    }
  },
  30_000,
);

test("every installed plugin contributes a route, a slot or another extension point", async () => {
  for (const manifest of installedPlugins()) {
    const runtime = await loadPluginRuntime(manifest.key);
    const contributes = [
      ...Object.values(runtime?.routes ?? {}),
      runtime?.publicRoutes,
      runtime?.slots,
      runtime?.catalogs,
      runtime?.itemTypes,
      runtime?.serverRoutes,
    ].some((part) => Object.keys(part ?? {}).length > 0);

    expect(contributes, `${manifest.key} contributes nothing`).toBe(true);
  }
});
