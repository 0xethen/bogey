import { expect, test } from "vite-plus/test";
import {
  ageOn,
  answerProblem,
  checkAnswers,
  fieldsProblem,
  readFields,
  shownFields,
  type FormField,
} from "../src/registration-form.ts";

const ON = new Date(Date.UTC(2026, 9, 10));

const minors: FormField[] = [
  { key: "dob", label: "Date of birth", kind: "date", required: true },
  {
    key: "guardian",
    label: "Guardian's name",
    kind: "text",
    required: true,
    showWhen: { field: "dob", ageUnder: 18 },
  },
  {
    key: "permission",
    label: "Permission slip",
    kind: "file",
    required: true,
    showWhen: { field: "dob", ageUnder: 18 },
  },
  {
    key: "photo",
    label: "Photo consent",
    kind: "consent",
    required: true,
    text: "We may photograph you.",
  },
];

test("works out whole years of age", () => {
  expect(ageOn("2008-10-10", ON)).toBe(18);
  expect(ageOn("2008-10-11", ON)).toBe(17);
  expect(ageOn("2000-02-29", ON)).toBe(26);
  expect(ageOn("2008-02-30", ON)).toBeNull();
  expect(ageOn("nope", ON)).toBeNull();
});

test("the guardian questions show only for minors", () => {
  expect(shownFields(minors, { dob: "2012-01-01" }, ON).map((f) => f.key)).toEqual([
    "dob",
    "guardian",
    "permission",
    "photo",
  ]);
  expect(shownFields(minors, { dob: "2000-01-01" }, ON).map((f) => f.key)).toEqual([
    "dob",
    "photo",
  ]);
  expect(shownFields(minors, {}, ON).map((f) => f.key)).toEqual(["dob", "photo"]);
});

test("a question under a hidden one stays hidden", () => {
  const chain: FormField[] = [
    { key: "a", label: "A", kind: "boolean", required: false },
    { key: "b", label: "B", kind: "text", required: false, showWhen: { field: "a", in: [true] } },
    { key: "c", label: "C", kind: "text", required: false, showWhen: { field: "b", in: ["x"] } },
  ];
  expect(shownFields(chain, { a: false, b: "x" }, ON).map((f) => f.key)).toEqual(["a"]);
  expect(shownFields(chain, { a: true, b: "x" }, ON).map((f) => f.key)).toEqual(["a", "b", "c"]);
});

test("hidden questions aren't required and their answers are dropped", () => {
  const result = checkAnswers(
    minors,
    { dob: "2000-01-01", guardian: "Someone", photo: { accepted: true } },
    ON,
  );
  expect(result.problems).toEqual({});
  expect(result.answers).toEqual({ dob: "2000-01-01", photo: { accepted: true } });
});

test("a minor must fill the guardian questions and agree", () => {
  const result = checkAnswers(minors, { dob: "2012-01-01" }, ON);
  expect(Object.keys(result.problems).sort()).toEqual(["guardian", "permission", "photo"]);
});

test("each kind checks its own shape", () => {
  const field = (kind: FormField["kind"], extra: Partial<FormField> = {}): FormField => ({
    key: "q",
    label: "Q",
    kind,
    required: true,
    ...extra,
  });
  expect(answerProblem(field("phone"), "+1 (555) 010-9999")).toBeNull();
  expect(answerProblem(field("phone"), "12")).not.toBeNull();
  expect(answerProblem(field("number", { min: 1, max: 5 }), 3)).toBeNull();
  expect(answerProblem(field("number", { min: 1, max: 5 }), 9)).toBe("Q is at most 5");
  expect(answerProblem(field("number"), "3")).not.toBeNull();
  expect(answerProblem(field("multiselect", { options: ["a", "b"] }), ["a"])).toBeNull();
  expect(answerProblem(field("multiselect", { options: ["a", "b"] }), ["c"])).not.toBeNull();
  expect(answerProblem(field("date"), "2026-13-01")).not.toBeNull();
  expect(answerProblem(field("boolean"), false)).toBe("Check Q to continue");
  expect(answerProblem(field("consent"), { accepted: true })).toBeNull();
  expect(
    answerProblem(field("file"), { path: "a/b/c", name: "c", size: 1, type: "image/png" }),
  ).toBeNull();
  expect(answerProblem(field("file"), "c")).not.toBeNull();
  expect(answerProblem(field("text", { required: false }), "")).toBeNull();
});

test("reading a stored list drops what is malformed and keeps new properties", () => {
  const fields = readFields([
    { key: "a", label: "A", kind: "date", required: true },
    { key: "b", label: "B", kind: "weird" },
    { label: "no key" },
    {
      key: "c",
      label: "C",
      kind: "text",
      showWhen: { field: "a", ageUnder: 18 },
      min: 2,
    },
    "junk",
  ]);
  expect(fields.map((f) => [f.key, f.kind])).toEqual([
    ["a", "date"],
    ["b", "text"],
    ["c", "text"],
  ]);
  expect(fields[2]?.showWhen).toEqual({ field: "a", ageUnder: 18 });
});

test("the editor's problems", () => {
  expect(fieldsProblem(minors)).toBeNull();
  expect(
    fieldsProblem([
      {
        key: "x",
        label: "X",
        kind: "text",
        required: false,
        showWhen: { field: "later", in: ["a"] },
      },
      { key: "later", label: "Later", kind: "text", required: false },
    ]),
  ).toMatch(/above it/);
  expect(
    fieldsProblem([
      { key: "x", label: "X", kind: "text", required: false },
      {
        key: "y",
        label: "Y",
        kind: "text",
        required: false,
        showWhen: { field: "x", ageUnder: 18 },
      },
    ]),
  ).toMatch(/date question/);
  expect(fieldsProblem([{ key: "c", label: "C", kind: "consent", required: true }])).toMatch(
    /agree/,
  );
});
