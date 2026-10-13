import type { SessionKindIcon, SessionKindTone } from "@bogey/config/settings";

export type PluginSettingScope = "instance" | "org" | "event";

export type PluginSettingValue = string | number | boolean;

export interface PluginSettingCondition {
  setting: string;
  in: Tuple<PluginSettingValue>;
}

interface PluginSettingBase {
  label: string;
  description?: string;
  scope?: PluginSettingScope;
  lock?: Exclude<PluginSettingScope, "event">;
  showWhen?: PluginSettingCondition | Tuple<PluginSettingCondition>;
}

export type PluginSetting =
  | (PluginSettingBase & { type: "boolean"; default?: boolean })
  | (PluginSettingBase & {
      type: "number";
      default?: number;
      min?: number;
      max?: number;
      placeholder?: string;
      scrub?: boolean;
    })
  | (PluginSettingBase & {
      type: "string";
      default?: string;
      placeholder?: string;
      multiline?: boolean;
    })
  | (PluginSettingBase & {
      type: "select";
      default?: string;
      options: Tuple<{ value: string; label: string }>;
    });

export type PluginRouteArea = "event" | "manage" | "org" | "account" | "admin" | "public";

export type PluginSignedInArea = Exclude<PluginRouteArea, "public">;

export interface PluginRouteDeclaration {
  path: string;
  label?: string;
  permission?: string;
  area?: PluginRouteArea;
  /** @deprecated Use `area: "public"`. Kept for plugin API 1. */
  public?: boolean;
  splat?: boolean;
  showWhen?: PluginSettingCondition | Tuple<PluginSettingCondition>;
}

interface PluginCommandBase {
  label: string;
  keywords?: Tuple<string>;
}

export interface PluginCommandPage extends PluginCommandBase {
  path: string;
  href?: never;
  action?: never;
}

export interface PluginCommandLink extends PluginCommandBase {
  href: string;
  path?: never;
  action?: never;
}

export interface PluginCommandAction extends PluginCommandBase {
  action: string;
  path?: never;
  href?: never;
}

export type PluginCommandDeclaration = PluginCommandPage | PluginCommandLink | PluginCommandAction;

export interface PluginAccountLinkBase {
  label: string;
}

export type PluginAccountLink =
  | (PluginAccountLinkBase & {
      path: string;
      href?: never;
    })
  | (PluginAccountLinkBase & {
      href: string;
      path?: never;
    });

export interface PluginUses {
  tables?: Tuple<string>;
  network?: Tuple<string>;
  settings?: Tuple<string>;
}

export interface PluginShares {
  messages?: boolean;
  sql?: Tuple<string>;
}

export interface PluginHotkeyDeclaration {
  id: string;
  label: string;
  description?: string;
  keys: string;
  path: string;
}

export interface PluginWindowDeclaration {
  key: string;
  label: string;
}

export interface PluginRoleDeclaration {
  key: string;
  label: string;
  grants?: Tuple<string>;
}

export type PluginEventKind = "hackathon" | "contest" | "custom";

export interface PluginEventTypeDeclaration {
  key: string;
  label: string;
  description: string;
  kind?: PluginEventKind;
  teamSize?: readonly [min: number, max: number];
  settings?: Record<string, PluginSettingValue>;
}

export interface PluginLimitDeclaration {
  label: string;
  description?: string;
  unit?: string;
}

export interface PluginNotificationDeclaration {
  kind: string;
  label: string;
  email?: boolean;
}

export interface PluginEmailVariable {
  name: string;
  label: string;
  example: string;
}

export interface PluginEmailDeclaration {
  kind: string;
  label: string;
  description: string;
  variables: Tuple<PluginEmailVariable>;
  required: Tuple<string>;
  reason: string;
  defaults: { subject: string; body: string };
}

export interface PluginLocaleDeclaration {
  code: string;
  label: string;
}

export interface PluginItemTypeDeclaration {
  kind: string;
  label: string;
  description: string;
  config?: Record<string, PluginSetting>;
}

export interface PluginRankingDeclaration {
  key: string;
  label: string;
  description: string;
}

export interface PluginSessionKindDeclaration {
  key: string;
  label: string;
  icon: SessionKindIcon;
  tone: SessionKindTone;
}

export type PluginApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface PluginApiDeclaration {
  path: string;
  method: PluginApiMethod;
  maxBodyMb?: number;
}

export type PluginScope = "event" | "org";

export interface PluginAuthor {
  name: string;
  url?: string;
  email?: string;
}

export const MANAGE_SETTINGS_PAGES = [
  "details",
  "agenda",
  "security",
  "registration",
  "people",
  "teams",
  "divisions",
  "submissions",
  "prizes",
  "certificates",
  "judging",
  "announcements",
  "email",
  "messages",
] as const;

export type ManageSettingsPage = (typeof MANAGE_SETTINGS_PAGES)[number];

export interface PluginSettingsSection {
  key: string;
  title: string;
  description?: string;
  page: string;
  settings: Tuple<string>;
}

export interface PluginSettingsPage {
  key: string;
  label: string;
  description?: string;
  route?: string;
}

export interface PluginSource {
  repository: string;
  directory?: string;
  homepage?: string;
}

export interface PluginManifest {
  key: string;
  name: string;
  api: number;
  version: string;
  description: string;
  author: PluginAuthor;
  license?: string;
  source: PluginSource;
  windows?: Tuple<PluginWindowDeclaration>;
  actions?: Tuple<string>;
  actionLabels?: Readonly<Record<string, string>>;
  settings?: Record<string, PluginSetting>;
  settingsSections?: Tuple<PluginSettingsSection>;
  settingsPages?: Tuple<PluginSettingsPage>;
  routes?: Tuple<PluginRouteDeclaration>;
  permissions?: Tuple<string>;
  roles?: Tuple<PluginRoleDeclaration>;
  commands?: Tuple<PluginCommandDeclaration>;
  accountLinks?: Tuple<PluginAccountLink>;
  uses?: PluginUses;
  requires?: Tuple<string>;
  shares?: PluginShares;
  hotkeys?: Tuple<PluginHotkeyDeclaration>;
  scope?: PluginScope;
  eventTypes?: Tuple<PluginEventTypeDeclaration>;
  limits?: Record<string, PluginLimitDeclaration>;
  notifications?: Tuple<PluginNotificationDeclaration>;
  emails?: Tuple<PluginEmailDeclaration>;
  itemTypes?: Tuple<PluginItemTypeDeclaration>;
  locales?: Tuple<PluginLocaleDeclaration>;
  translations?: Tuple<string>;
  ranking?: Tuple<PluginRankingDeclaration>;
  sessionKinds?: Tuple<PluginSessionKindDeclaration>;
  serverRoutes?: Tuple<PluginApiDeclaration>;
  signals?: Tuple<PluginSignalDeclaration>;
  homePanels?: Tuple<PluginHomePanelDeclaration>;
}

export interface PluginHomePanelDeclaration {
  key: string;
  label: string;
  description?: string;
}

export interface PluginSignalDeclaration {
  key: string;
  label: string;
}

export type SettingValue<S> = S extends { type: "boolean" }
  ? boolean
  : S extends { type: "number" }
    ? number
    : S extends { type: "select"; options: Tuple<{ value: infer V }> }
      ? V
      : S extends { type: "string" }
        ? string
        : never;

export type SettingsOf<M extends PluginManifest> = M["settings"] extends infer S
  ? S extends Record<string, PluginSetting>
    ? { [K in keyof S]-?: SettingValue<S[K]> }
    : Record<string, never>
  : Record<string, never>;

export type CommandActionsOf<M extends PluginManifest> =
  M["commands"] extends Tuple<infer C> ? Extract<C, { action: string }>["action"] : never;

export type HomePanelsOf<M extends PluginManifest> =
  M["homePanels"] extends Tuple<infer P> ? Extract<P, { key: string }>["key"] : never;

export type ItemKindsOf<M extends PluginManifest> =
  M["itemTypes"] extends Tuple<infer T> ? Extract<T, { kind: string }>["kind"] : never;

export type LocaleCodesOf<M extends PluginManifest> =
  M["locales"] extends Tuple<infer T> ? Extract<T, { code: string }>["code"] : never;

export type TranslationCodesOf<M extends PluginManifest> =
  M["translations"] extends Tuple<infer T extends string> ? T : never;

export type RankingKeysOf<M extends PluginManifest> =
  M["ranking"] extends Tuple<infer T> ? Extract<T, { key: string }>["key"] : never;

export type ServerRoutesOf<M extends PluginManifest> =
  M["serverRoutes"] extends Tuple<infer T>
    ? T extends { path: infer P; method: infer Me }
      ? `${Me & string} ${P & string}`
      : never
    : never;

export type PathsOf<M extends PluginManifest> =
  M["routes"] extends Tuple<{
    path: infer P;
  }>
    ? P & string
    : never;

export type AreaOf<R> = R extends { area: infer A extends PluginRouteArea }
  ? A
  : R extends { public: true }
    ? "public"
    : "event";

type RoutesOf<M extends PluginManifest> = M["routes"] extends Tuple<infer R> ? R : never;

export type PathsIn<M extends PluginManifest, A extends PluginRouteArea> =
  RoutesOf<M> extends infer R
    ? R extends { path: infer P extends string }
      ? AreaOf<R> extends A
        ? P
        : never
      : never
    : never;

export type AreaOfPath<M extends PluginManifest, P extends string> =
  RoutesOf<M> extends infer R ? (R extends { path: P } ? AreaOf<R> : never) : never;
