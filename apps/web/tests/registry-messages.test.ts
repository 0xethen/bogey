import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";
import { en } from "@bogey/config/messages";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_KEYS,
} from "@bogey/config/notifications";
import { settingsRegistry, type SettingField } from "@bogey/config/settings";
import { ACTION_GROUPS, ACTION_LABELS } from "@bogey/db/audit";
import { EMAIL_KINDS } from "@bogey/config/email";
import { ENGLISH_FOOTER } from "@bogey/utils/email-template";
import { COLUMN_KINDS } from "@bogey/utils/roster";
import { RULE_ACTIONS } from "@bogey/utils/roster-rules";
import { CORE_WINDOW_INFO } from "@bogey/config/windows";
import { SHORTCUT_IDS, SHORTCUTS } from "../src/lib/shortcuts.ts";

const catalog: Record<string, string> = en;

test("every notification kind and group is in the catalog, worded as the registry has it", () => {
  for (const key of NOTIFICATION_KIND_KEYS) {
    expect(catalog[`notif.${key}`], key).toBe(NOTIFICATION_KINDS[key].label);
    expect(catalog[`notif.${key}.help`], key).toBe(NOTIFICATION_KINDS[key].description);
  }
  for (const group of NOTIFICATION_GROUPS) expect(catalog[`notifGroup.${group}`]).toBe(group);
});

test("every core shortcut is in the catalog, worded as the registry has it", () => {
  for (const id of SHORTCUT_IDS) {
    expect(catalog[`shortcut.${id}`], id).toBe(SHORTCUTS[id].name);
    expect(catalog[`shortcut.${id}.help`], id).toBe(SHORTCUTS[id].description);
  }
});

test("every core window is in the catalog, named as the registry has it", () => {
  for (const window of CORE_WINDOW_INFO) {
    expect(catalog[`window.${window.key}`], window.key).toBe(window.label);
  }
});

test("every setting's label, help and options are in the catalog, worded as the registry has it", () => {
  for (const [namespace, definition] of Object.entries(settingsRegistry)) {
    const fields: Record<string, SettingField<unknown> | undefined> = definition.fields ?? {};
    for (const [key, field] of Object.entries(fields)) {
      if (!field) continue;
      const base = `setting.${namespace}.${key}`;
      expect(catalog[base], base).toBe(field.label);
      if (field.description) expect(catalog[`${base}.help`], base).toBe(field.description);
      for (const option of field.options ?? []) {
        expect(catalog[`${base}.${String(option.value)}`], base).toBe(option.label);
      }
    }
  }
});

test("the roster import's column kinds and rule actions are in the catalog", () => {
  for (const each of COLUMN_KINDS) {
    expect(catalog[`columnKind.${each.kind}`], each.kind).toBe(each.label);
    if (each.description)
      expect(catalog[`columnKind.${each.kind}.help`], each.kind).toBe(each.description);
  }
  for (const action of RULE_ACTIONS)
    expect(catalog[`ruleAction.${action.kind}`], action.kind).toBe(action.label);
});

test("every core audit action and group is in the catalog, worded as the registry has it", () => {
  for (const [action, label] of Object.entries(ACTION_LABELS)) {
    expect(catalog[`auditAction.${action}`], action).toBe(label);
  }
  for (const group of ACTION_GROUPS)
    expect(catalog[`auditGroup.${group.prefix}`]).toBe(group.label);
});

test("every email kind's name and default wording are in the catalog, as the registry has them", () => {
  for (const [key, kind] of Object.entries(EMAIL_KINDS)) {
    expect(catalog[`emailKind.${key}`], key).toBe(kind.label);
    expect(catalog[`emailKind.${key}.help`], key).toBe(kind.description);
    expect(catalog[`emailTemplate.${key}.subject`], key).toBe(kind.defaults.subject);
    expect(catalog[`emailTemplate.${key}.body`], key).toBe(kind.defaults.body);
    expect(catalog[`emailTemplate.${key}.reason`], key).toBe(kind.reason);
  }
  for (const [name, text] of Object.entries(ENGLISH_FOOTER)) {
    expect(catalog[`emailFooter.${name}`], name).toBe(text);
  }
});

test("every message @bogey/utils words with say() is in the catalog, as the helper writes it", () => {
  const dir = fileURLToPath(new URL("../../../packages/utils/src", import.meta.url));
  const call = /\bsay\(\s*"([^"]+)",\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
  let found = 0;
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(dir, file), "utf-8");
    for (const match of source.matchAll(call)) {
      const english = (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1");
      expect(catalog[match[1] ?? ""], `${file}: ${match[1]}`).toBe(english);
      found += 1;
    }
  }
  expect(found).toBeGreaterThan(50);
});
