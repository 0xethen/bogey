import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { fieldMeta, schemaFields, validatorSchema } from "../src/lib/form-meta.ts";

const schema = z
  .object({
    name: z.string().trim().min(1).meta({ label: "Name", placeholder: "Spring Hack" }),
    blurb: z.string().max(200).optional().describe("One line.").meta({ label: "Blurb" }),
    teams: z.array(
      z.object({ title: z.string().meta({ label: "Team name" }).describe("Shown on the board.") }),
    ),
    size: z.number().pipe(z.number().int()).meta({ label: "Size" }),
    plain: z.string(),
  })
  .superRefine(() => undefined);

test("reads a key's label, placeholder and description", () => {
  expect(fieldMeta(schema, "name")).toEqual({ label: "Name", placeholder: "Spring Hack" });
  expect(fieldMeta(schema, "blurb")).toEqual({ label: "Blurb", description: "One line." });
});

test("follows array indexes and nested keys", () => {
  expect(fieldMeta(schema, "teams[3].title")).toEqual({
    label: "Team name",
    description: "Shown on the board.",
  });
});

test("an outer wrapper's meta wins over the inner schema's", () => {
  const wrapped = z.object({
    key: z
      .string()
      .meta({ label: "Inner", placeholder: "kept" })
      .optional()
      .meta({ label: "Outer" }),
  });
  expect(fieldMeta(wrapped, "key")).toEqual({ label: "Outer", placeholder: "kept" });
});

test("unknown paths and keys without meta are empty", () => {
  expect(fieldMeta(schema, "missing")).toEqual({});
  expect(fieldMeta(schema, "plain")).toEqual({});
});

test("lists labelled keys in order", () => {
  expect(schemaFields(schema).map((field) => field.key)).toEqual(["name", "blurb", "size"]);
});

test("finds the Zod schema among a form's validators", () => {
  expect(validatorSchema([{ run: () => undefined }, { run: schema }])).toBe(schema);
  expect(validatorSchema(undefined)).toBeUndefined();
});
