import { describe, expect, test } from "vite-plus/test";
import { definePlugin } from "../src/api.ts";
import { definePluginRuntime } from "../src/runtime.tsx";

const manifest = definePlugin({
  key: "actions",
  name: "Actions",
  api: 1,
  version: "1.0.0",
  description: "Has a command that runs code.",
  author: { name: "Test" },
  source: { repository: "github:someone/plugins" },
  commands: [{ label: "Run it", action: "run_it" }],
});

describe("definePluginRuntime actions", () => {
  test("requires a handler for every declared action", () => {
    // @ts-expect-error `actions` is required by the manifest's command
    expect(() => definePluginRuntime(manifest, {})).toThrow(/run_it/);
  });

  test("keeps the handlers it was given", () => {
    const runtime = definePluginRuntime(manifest, { actions: { run_it: () => {} } });
    expect(runtime.actions.run_it).toBeTypeOf("function");
  });
});
