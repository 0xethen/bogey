import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { CORE_ACTIONS } from "../src/audit.ts";

const schemas = join(import.meta.dirname, "../../../supabase/schemas");
const sql = readdirSync(schemas)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(schemas, file), "utf8"))
  .join("\n");

const written = new Set(
  [...sql.matchAll(/private\.audit(?:_org)?\(([^;]+);/g)].flatMap((call) =>
    [...call[1]!.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((match) => match[1]!),
  ),
);

test("every action the schema writes is listed in CORE_ACTIONS", () => {
  const known = new Set<string>(CORE_ACTIONS);
  expect([...written].filter((name) => !known.has(name))).toEqual([]);
});

test("registration status actions cover the enum", () => {
  const statuses = /registration_status as enum \(([^)]+)\)/.exec(sql)?.[1] ?? "";
  for (const status of statuses.match(/[a-z]+/g) ?? []) {
    expect(CORE_ACTIONS).toContain(`registration.${status}`);
  }
});

test("nothing listed is dead", () => {
  const unused = CORE_ACTIONS.filter(
    (name) => !written.has(name) && !name.startsWith("registration."),
  );
  expect(unused).toEqual([]);
});
