import { expect, test } from "vite-plus/test";
import { audienceReaches, hasAudience } from "../src/audience.ts";
import { readFields } from "../src/registration-form.ts";

const nobody = { divisionId: null, tagIds: [] };

test("no divisions or tags reaches everyone", () => {
  expect(hasAudience({})).toBe(false);
  expect(hasAudience({ divisionIds: [], tagIds: [] })).toBe(false);
  expect(audienceReaches({ divisionIds: [] }, nobody)).toBe(true);
});

test("one matching division or tag is enough", () => {
  const audience = { divisionIds: ["middle"], tagIds: ["mentor"] };
  expect(audienceReaches(audience, { divisionId: "middle", tagIds: [] })).toBe(true);
  expect(audienceReaches(audience, { divisionId: "high", tagIds: ["mentor"] })).toBe(true);
  expect(audienceReaches(audience, { divisionId: "high", tagIds: ["judge"] })).toBe(false);
  expect(audienceReaches(audience, nobody)).toBe(false);
});

test("readFields keeps a question's audience and drops empty lists", () => {
  const [kept, plain] = readFields([
    { key: "a", label: "A", kind: "text", divisionIds: ["d1", 3], tagIds: ["t1"] },
    { key: "b", label: "B", kind: "text", divisionIds: [], tagIds: "t1" },
  ]);
  expect(kept).toMatchObject({ divisionIds: ["d1"], tagIds: ["t1"] });
  expect(plain).not.toHaveProperty("divisionIds");
  expect(plain).not.toHaveProperty("tagIds");
});
