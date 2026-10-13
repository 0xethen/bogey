import { sayEnglish, type Say } from "./messages.ts";

export const CORE_ANSWER_KINDS = [
  "text",
  "longtext",
  "markdown",
  "url",
  "video",
  "file",
  "drive",
  "select",
  "boolean",
  "number",
] as const;

export type CoreAnswerKind = (typeof CORE_ANSWER_KINDS)[number];

export type PluginAnswerKind = `${string}.${string}`;

export type AnswerKind = CoreAnswerKind | PluginAnswerKind;

export const PLUGIN_ANSWER_KIND = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$/;

export function isPluginAnswerKind(kind: string): kind is PluginAnswerKind {
  return PLUGIN_ANSWER_KIND.test(kind);
}

export function isCoreAnswerKind(kind: string): kind is CoreAnswerKind {
  return CORE_ANSWER_KINDS.some((core) => core === kind);
}

export function answerKind(kind: string): AnswerKind | null {
  if (isCoreAnswerKind(kind) || isPluginAnswerKind(kind)) return kind;
  return null;
}

export type AnswerValue = string | boolean;

export interface PluginAnswerItem {
  label: string;
  required: boolean;
  config: Readonly<Record<string, string | number | boolean>>;
}

export type PluginAnswerValidator = (value: unknown, item: PluginAnswerItem) => string | null;

export interface AnswerRules {
  kind: AnswerKind;
  label: string;
  required: boolean;
  options?: Tuple<string>;
  maxLength?: number;
  config?: PluginAnswerItem["config"];
}

const pluginValidators = new Map<string, PluginAnswerValidator>();

export function registerPluginAnswerValidator(
  kind: PluginAnswerKind,
  validator: PluginAnswerValidator,
): void {
  pluginValidators.set(kind, validator);
}

export function clearPluginAnswerValidators(): void {
  pluginValidators.clear();
}

let validatorLoader: ((kind: PluginAnswerKind) => Promise<void>) | undefined;

export function setPluginAnswerValidatorLoader(
  loader: ((kind: PluginAnswerKind) => Promise<void>) | undefined,
): void {
  validatorLoader = loader;
}

export async function loadPluginAnswerValidator(kind: PluginAnswerKind): Promise<void> {
  if (!pluginValidators.has(kind)) await validatorLoader?.(kind);
}

export const MAX_PLUGIN_ANSWER_LENGTH = 20_000;

export const DEFAULT_MAX_LENGTH: Record<"text" | "longtext" | "markdown", number> = {
  text: 300,
  longtext: 5_000,
  markdown: 20_000,
};

const DRIVE_HOSTS = ["docs.google.com", "drive.google.com"];

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function answerProblem(
  rules: AnswerRules,
  value: unknown,
  say: Say = sayEnglish,
): string | null {
  const { kind, label, required } = rules;

  if (kind === "file") return null;
  if (isPluginAnswerKind(kind)) return pluginAnswerProblem(kind, rules, value);
  if (kind === "boolean") {
    if (typeof value !== "boolean" && value !== undefined) {
      return say("answer.yesNo", "{label} must be yes or no", { label });
    }
    return required && value !== true
      ? say("answer.check", 'Check "{label}" to continue', { label })
      : null;
  }

  const text = typeof value === "string" ? value.trim() : value === undefined ? "" : null;
  if (text === null) return say("answer.text", "{label} must be text", { label });
  if (!text) return required ? say("answer.required", "{label} is required", { label }) : null;

  switch (kind) {
    case "url":
    case "video":
      return httpUrl(text)
        ? null
        : say("answer.link", "{label} needs a full link starting with https://", { label });
    case "drive": {
      const url = httpUrl(text);
      return url && DRIVE_HOSTS.includes(url.hostname)
        ? null
        : say("answer.drive", "{label} needs a Google Drive or Docs link", { label });
    }
    case "select":
      return rules.options?.includes(text)
        ? null
        : say("answer.option", "Choose one of the options for {label}", { label });
    case "number":
      return Number.isFinite(Number(text))
        ? null
        : say("answer.number", "{label} must be a number", { label });
    default: {
      const max = rules.maxLength ?? DEFAULT_MAX_LENGTH[kind];
      return text.length > max
        ? say("answer.tooLong", "Keep {label} under {max} characters", { label, max })
        : null;
    }
  }
}

function pluginAnswerProblem(
  kind: PluginAnswerKind,
  rules: AnswerRules,
  value: unknown,
): string | null {
  const { label, required } = rules;
  if (value !== undefined && typeof value !== "string" && typeof value !== "boolean") {
    return `${label} has an answer of the wrong kind`;
  }
  if (typeof value === "string" && value.length > MAX_PLUGIN_ANSWER_LENGTH) {
    return `Keep ${label} under ${MAX_PLUGIN_ANSWER_LENGTH.toLocaleString("en-US")} characters`;
  }
  const validator = pluginValidators.get(kind);
  if (!validator)
    return required && (value === undefined || value === "") ? `${label} is required` : null;
  return validator(value, { label, required, config: rules.config ?? {} });
}

export function cleanOptions(options: Tuple<string>): string[] {
  return options.map((option) => option.trim()).filter(Boolean);
}
