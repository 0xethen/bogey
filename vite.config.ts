import { defineConfig } from "vite-plus";

const VENDORED_SKILLS = ["/.agents/**", "/.claude/**"];

const GENERATED = [
  "/packages/utils/templates/layout.html",
  "/apps/web/src/routeTree.gen.ts",
  "/apps/console/src/routeTree.gen.ts",
  "/packages/db/src/types/database.gen.ts",
  "/packages/db/src/types/schema.gen.ts",
  "/packages/config/src/themes.gen.ts",
  "/docs/reference/settings.md",
  "/docs/reference/cli.md",
  "/docs/reference/notifications.md",
  "/docs/reference/windows.md",
  "/docs/reference/permissions.md",
  "/packages/utils/src/layout.gen.ts",
  "/supabase/templates/*.html",
];

export default defineConfig({
  test: { exclude: ["**/node_modules/**", "**/dist/**", "**/installed/**", ".vault/**"] },
  staged: { "*": "vp check --fix" },
  fmt: { ignorePatterns: [...VENDORED_SKILLS, ...GENERATED] },
  lint: {
    ignorePatterns: [...VENDORED_SKILLS, ...GENERATED],
    plugins: ["react"],
    categories: { correctness: "error" },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
    tasks: {
      e2e: { command: "vp run web#e2e", cache: false },
      bogey: { command: "node tools/cli/src/bin.ts", cache: false },
      find: { command: "node tools/dev/src/find-text.ts", cache: false },
      // tsc reads files vp can't see, so its cache misses edits
      typecheck: { command: "tsc --noEmit && vp run -r --no-cache typecheck", cache: false },
    },
  },
});
