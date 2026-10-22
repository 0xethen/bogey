import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { lazyPlugins } from "vite-plus";

const envDir = fileURLToPath(new URL("../..", import.meta.url));
for (const [key, value] of Object.entries(
  loadEnv(process.env.NODE_ENV ?? "development", envDir, ""),
)) {
  process.env[key] ??= value;
}

const migrations = readdirSync(new URL("../../supabase/migrations", import.meta.url))
  .map((file) => /^(\d{14})_.+\.sql$/.exec(file)?.[1])
  .filter((version) => version !== undefined)
  .sort();

const config = defineConfig({
  envPrefix: ["VITE_", "PUBLIC_"],
  resolve: { tsconfigPaths: true },
  define: {
    __BOGEY_MIGRATIONS__: JSON.stringify(migrations),
    __BOGEY_VERSION__: JSON.stringify(
      JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8")).version,
    ),
  },
  lint: {
    rules: { "import/extensions": "allow", "no-unused-vars": "warn" },
  },
  plugins: lazyPlugins(() =>
    process.env.VITEST
      ? [viteReact()]
      : [
          devtools(),
          tanstackStart(),
          nitro({
            rolldownConfig: { external: [/^@sentry\//, /^react($|\/)/, /^react-dom($|\/)/] },
            traceDeps: ["react", "react-dom", "scheduler"],
          }),
          tailwindcss(),
          viteReact({ compiler: true }),
        ],
  ),
  server: {
    allowedHosts: process.env.BOGEY_DEV_ALLOWED_HOSTS?.split(",").filter(Boolean),
  },
});

export default config;
