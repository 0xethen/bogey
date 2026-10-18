import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { callsOf, generateSchemaTypes, readSchemaTypes } from "../../src/lib/schema-types.ts";

const root = fileURLToPath(new URL("../../../..", import.meta.url));

test("the committed schema types match supabase/schemas", () => {
  const result = generateSchemaTypes(root, true);
  expect(result.output).toMatch(/up to date/);
  expect(result.ok).toBe(true);
});

test("splits a call's arguments at its own commas only", () => {
  expect(
    callsOf("perform private.audit(p, 'a.b', jsonb_build_object('x', f(1, 2)));", "private.audit"),
  ).toEqual([["p", "'a.b'", "jsonb_build_object('x', f(1, 2))"]]);
});

test("reads permissions, audit actions and checked columns", () => {
  const types = readSchemaTypes([
    {
      file: "00.sql",
      sql: `create type public.thing_status as enum ('open', 'shut');
create table public.things (
  id uuid,
  kind text not null check (kind in ('big', 'small')) -- a comment's 'x.y' is skipped
);
insert into public.role_permissions (role_key, permission) values ('judge', 'judging.score');
select private.has_permission(p_event, 'event.view');
-- select private.has_permission(p_event, 'commented.out');
perform private.audit(p_event, case when v then 'thing.made' else 'thing.unmade' end, 'thing', v_id, '{}');
perform private.audit_org(p_org, 'thing.' || new.status::text, 'thing', new.id, '{}');`,
    },
  ]);
  expect(types.problems).toEqual([]);
  expect(types.permissions).toEqual(["event.view", "judging.score"]);
  expect(types.auditActions).toEqual(["thing.made", "thing.open", "thing.shut", "thing.unmade"]);
  expect(Object.fromEntries(types.columnValues.get("things") ?? [])).toEqual({
    kind: ["big", "small"],
  });
});

test("names a dynamic audit action it can't expand", () => {
  const types = readSchemaTypes([
    {
      file: "01.sql",
      sql: "perform private.audit(p, 'thing.' || new.mood::text, 't', null, '{}');",
    },
  ]);
  expect(types.problems).toEqual([
    "01.sql: 'thing.' || new.mood::text needs an enum named thing_mood to list its actions",
  ]);
});
