import { expect, test, vi } from "vite-plus/test";
import { run } from "../../src/cli.ts";
import { imageHome, imageNote } from "../../src/lib/image.ts";

test("a checkout has no image home", () => {
  expect(imageHome({})).toBeNull();
  expect(imageHome({ BOGEY_HOME: "/app" })).toBe("/app");
});

test("authoring commands say they need a checkout; running ones don't", () => {
  expect(imageNote({ name: "themes" }, [])).toMatch(/checkout/);
  expect(imageNote({ name: "db" }, ["baseline"])).toMatch(/checkout/);
  expect(imageNote({ name: "db" }, ["migrate"])).toBeNull();
  expect(imageNote({ name: "db" }, ["status", "--db-url", "x"])).toBeNull();
  expect(imageNote({ name: "plugins" }, ["add", "github:a/b/c@1.0.0"])).toMatch(/rebuild/);
  expect(imageNote({ name: "plugins" }, ["migrate"])).toBeNull();
  expect(imageNote({ name: "org" }, [])).toBeNull();
  expect(imageNote({ name: "doctor" }, [])).toBeNull();
});

test("upgrade, restart and stop point at the host", () => {
  expect(imageNote({ name: "upgrade" }, [])).toMatch(/docker compose pull/);
  expect(imageNote({ name: "restart" }, [])).toMatch(/docker compose restart web/);
  expect(imageNote({ name: "stop" }, [])).toMatch(/docker compose stop/);
});

test("inside the image, run explains instead of running", async () => {
  vi.stubEnv("BOGEY_HOME", "/app");
  try {
    const result = await run(["upgrade"]);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/pull/);
    expect((await run(["upgrade", "--help"])).exitCode).toBe(0);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("every command says where it works", async () => {
  const { COMMANDS } = await import("../../src/commands.ts");
  const { WHERE } = await import("../../src/lib/image.ts");
  expect(COMMANDS.map((command) => command.name).sort()).toEqual(Object.keys(WHERE).sort());
});
