import { expect, test } from "vite-plus/test";
import { SESSION_KIND_TONES } from "@bogey/config/settings";
import { AWARD_KINDS } from "@bogey/utils/awards";
import { CERTIFICATE_KINDS } from "@bogey/utils/certificate";
import { COLUMN_VALUES } from "../src/types.ts";

// lists that live outside packages/db (no dependency on it) but must match a column's check
test("lists kept elsewhere allow what the schema's checks allow", () => {
  expect(AWARD_KINDS).toEqual(COLUMN_VALUES.awards.kind);
  expect(CERTIFICATE_KINDS).toEqual(COLUMN_VALUES.certificates.kind);
  expect(CERTIFICATE_KINDS).toEqual(COLUMN_VALUES.certificate_templates.kind);
  expect(SESSION_KIND_TONES).toEqual(COLUMN_VALUES.tags.tone);
});
