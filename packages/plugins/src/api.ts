import type { EmailKind, EmailVariable } from "@bogey/config/email";
import { isLocale, SOURCE_LOCALE } from "@bogey/utils/locale";
import { SESSION_KIND_ICONS, SESSION_KIND_TONES } from "@bogey/config/settings";
import { KEBAB, PLUGIN_KEY, SEMVER } from "@bogey/utils/keys";
import type {
  CommandActionsOf,
  HomePanelsOf,
  PathsOf,
  PluginAccountLink,
  PluginCommandAction,
  PluginHomePanelDeclaration,
  PluginCommandDeclaration,
  PluginCommandLink,
  PluginCommandPage,
  PluginEventKind,
  PluginEventTypeDeclaration,
  PluginEmailDeclaration,
  PluginItemTypeDeclaration,
  PluginLocaleDeclaration,
  PluginLimitDeclaration,
  PluginNotificationDeclaration,
  PluginApiDeclaration,
  PluginApiMethod,
  PluginRankingDeclaration,
  PluginScope,
  PluginSessionKindDeclaration,
  PluginSettingCondition,
  PluginSettingValue,
  PluginUses,
  PluginShares,
  PluginManifest,
  PluginRoleDeclaration,
  PluginRouteArea,
  PluginRouteDeclaration,
  PluginSetting,
  PluginSettingScope,
  PluginSettingsSection,
  PluginWindowDeclaration,
  SettingsOf,
} from "./types.ts";
import { MANAGE_SETTINGS_PAGES } from "./types.ts";

export type {
  PluginEventKind,
  PluginEventTypeDeclaration,
  PluginEmailDeclaration,
  PluginItemTypeDeclaration,
  PluginLocaleDeclaration,
  PluginLimitDeclaration,
  PluginNotificationDeclaration,
  PluginApiDeclaration,
  PluginApiMethod,
  PluginRankingDeclaration,
  PluginSessionKindDeclaration,
  PluginScope,
  PluginSettingCondition,
  CommandActionsOf,
  HomePanelsOf,
  PathsOf,
  PluginAccountLink,
  PluginHomePanelDeclaration,
  PluginCommandAction,
  PluginCommandDeclaration,
  PluginCommandLink,
  PluginCommandPage,
  PluginUses,
  PluginShares,
  PluginManifest,
  PluginRoleDeclaration,
  PluginRouteArea,
  PluginRouteDeclaration,
  PluginSetting,
  PluginSettingScope,
  PluginWindowDeclaration,
  SettingsOf,
};

export const PLUGIN_API = 1;

export const SUPPORTED_PLUGIN_APIS: Tuple<number> = [1];

export function incompatibility(manifest: Pick<PluginManifest, "api">): string | null {
  if (SUPPORTED_PLUGIN_APIS.includes(manifest.api)) return null;

  return manifest.api > PLUGIN_API
    ? `needs Bogey Plugin API ${manifest.api}. This instace provides ${PLUGIN_API}. Upgrade Bogey.`
    : `uses Bogey Plugin API ${manifest.api}, which this instance no longer supports. Update the plugin.`;
}

const KEY = PLUGIN_KEY;

const API_METHODS: Tuple<PluginApiMethod> = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const API_PATH = /^\/((:[a-z][a-z0-9_]*|[a-z0-9_-]+)(\/(:[a-z][a-z0-9_]*|[a-z0-9_-]+))*)?$/;

const ROUTE_AREAS: Tuple<PluginRouteArea> = [
  "event",
  "manage",
  "org",
  "account",
  "admin",
  "public",
];

export const EVENT_AREAS: Tuple<PluginRouteArea> = ["event", "manage"];

const ACTION_ID = /^[a-z][a-z0-9_]*$/;
const USES_TABLE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/;
const USES_HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const USES_SETTINGS = /^[a-z][a-z0-9_.-]*$/;
const SQL_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function assertHttpsUrl(key: string, what: string, value: string): void {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {}
  if (url?.protocol !== "https:") {
    throw new Error(`Plugin "${key}" ${what} needs an https: URL, got "${value}".`);
  }
}

const ROLE_KEY = KEBAB;

export function showConditions(showWhen: PluginSetting["showWhen"]): Tuple<PluginSettingCondition> {
  if (!showWhen) return [];
  return "setting" in showWhen ? [showWhen] : showWhen;
}

export function isRouteListed(
  manifest: PluginManifest,
  route: PluginRouteDeclaration,
  values: Record<string, unknown>,
): boolean {
  return showConditions(route.showWhen).every((condition) =>
    condition.in.some((allowed) =>
      Object.is(
        allowed,
        values[condition.setting] ?? defaultOf(manifest.settings?.[condition.setting]),
      ),
    ),
  );
}

function defaultOf(setting: PluginSetting | undefined): PluginSettingValue | undefined {
  return setting?.default;
}

export function definePlugin<const M extends PluginManifest>(manifest: M): M {
  if (!KEY.test(manifest.key)) {
    throw new Error(
      `Plugin key "${manifest.key}" must be lowercase letters, digits and dashes ` +
        "(3 to 32 chars), since it appears in URLs and database rows.",
    );
  }

  if (!manifest.name.trim()) {
    throw new Error(`Plugin "${manifest.key}" needs a name.`);
  }

  if (!SEMVER.test(manifest.version)) {
    throw new Error(
      `Plugin "${manifest.key}" version "${manifest.version}" must be semver ` +
        '(e.g. "1.2.3"). Update checks compare versions; anything else can\'t be ordered.',
    );
  }

  if (!manifest.description.trim()) {
    throw new Error(
      `Plugin "${manifest.key}" needs a description; an organizer reads it when ` +
        "deciding whether to switch this on.",
    );
  }

  if (!manifest.author.name.trim()) {
    throw new Error(`Plugin "${manifest.key}" needs an author with a name.`);
  }

  if (!parseRepository(manifest.source.repository)) {
    throw new Error(
      `Plugin "${manifest.key}" source.repository "${manifest.source.repository}" must be ` +
        '"github:owner/repo" or an https URL.',
    );
  }

  const declaredPermissions = new Set(manifest.permissions ?? []);

  for (const permission of manifest.permissions ?? []) {
    if (!KEBAB.test(permission)) {
      throw new Error(
        `Plugin "${manifest.key}" permission "${permission}" must be lowercase kebab-case ` +
          `(it is stored as "${manifest.key}.<permission>").`,
      );
    }
  }

  const roleKeys = new Set<string>();
  for (const role of manifest.roles ?? []) {
    if (!ROLE_KEY.test(role.key)) {
      throw new Error(`Plugin "${manifest.key}" role "${role.key}" must be lowercase kebab-case.`);
    }

    if (roleKeys.has(role.key)) {
      throw new Error(`Plugin "${manifest.key}" declares role "${role.key}" twice.`);
    }
    roleKeys.add(role.key);

    for (const grant of role.grants ?? []) {
      if (!declaredPermissions.has(grant)) {
        throw new Error(
          `Plugin "${manifest.key}" role "${role.key}" grants "${grant}", which it ` +
            "doesn't declare in `permissions`. A plugin can only grant its own.",
        );
      }
    }
  }

  const seen = new Set<string>();
  for (const route of manifest.routes ?? []) {
    if (route.path && !route.path.startsWith("/")) {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" must start with "/" ` +
          '(or be "" for its index).',
      );
    }

    if (route.path.endsWith("/") && route.path !== "") {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" must not end with "/": ` +
          "the host mounts it verbatim, and a trailing slash makes two spellings of one page.",
      );
    }

    if (route.area !== undefined && !ROUTE_AREAS.includes(route.area)) {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" has area "${route.area}"; use one of ` +
          `${ROUTE_AREAS.join(", ")}.`,
      );
    }

    if (route.public && route.area !== undefined && route.area !== "public") {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" is \`public\` but in area "${route.area}". ` +
          'Use `area: "public"` alone.',
      );
    }

    const area = routeArea(route);

    if (area === "public" && route.splat) {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" is public; public pages always get the ` +
          "rest of the path, so `splat` is only for signed-in routes.",
      );
    }

    if (route.permission && area !== "event" && area !== "manage") {
      throw new Error(
        `Plugin "${manifest.key}" route "${route.path}" is in area "${area}" but requires a ` +
          "permission, which is checked against an event. Only event and manage pages take one.",
      );
    }

    if (seen.has(route.path)) {
      throw new Error(`Plugin "${manifest.key}" declares route "${route.path}" twice.`);
    }
    seen.add(route.path);
  }

  for (const route of manifest.routes ?? []) {
    for (const { setting: other, in: values } of showConditions(route.showWhen)) {
      if (!manifest.settings?.[other] || values.length === 0) {
        throw new Error(
          `Plugin "${manifest.key}" route "${route.path}" is listed when "${other}" holds a value, ` +
            "which needs a setting it declares and at least one value.",
        );
      }
    }
  }

  for (const [name, setting] of Object.entries(manifest.settings ?? {})) {
    if (setting.lock !== undefined && setting.scope !== undefined) {
      throw new Error(
        `Plugin "${manifest.key}" setting "${name}" has both \`lock\` and \`scope\`; \`lock\` replaces ` +
          "`scope` (it shows the setting read-only below that level instead of hiding it).",
      );
    }
    for (const { setting: other, in: values } of showConditions(setting.showWhen)) {
      const names = Object.keys(manifest.settings ?? {});
      if (!names.includes(other) || names.indexOf(other) >= names.indexOf(name)) {
        throw new Error(
          `Plugin "${manifest.key}" setting "${name}" is shown when "${other}" is set, which ` +
            "isn't a setting declared before it.",
        );
      }
      if (values.length === 0) {
        throw new Error(
          `Plugin "${manifest.key}" setting "${name}" has a \`showWhen\` with no values, so it ` +
            "would never show.",
        );
      }
    }

    if (setting.type === "select") {
      if (setting.options.length === 0) {
        throw new Error(`Plugin "${manifest.key}" setting "${name}" needs at least one option.`);
      }

      if (
        setting.default !== undefined &&
        !setting.options.some((o) => o.value === setting.default)
      )
        throw new Error(
          `Plugin "${manifest.key}" setting "${name}" defaults to "${setting.default}", ` +
            "which is not one of its options.",
        );
    }
  }

  if (!Number.isInteger(manifest.api) || manifest.api < 1) {
    throw new Error(
      `Plugin "${manifest.key}" needs \`api\`, the plugin API it was written for (now ${PLUGIN_API}).`,
    );
  }

  const pages = new Set(
    (manifest.routes ?? [])
      .filter((route) => EVENT_AREAS.includes(routeArea(route)))
      .map((route) => route.path),
  );
  const menuPages = new Set(
    (manifest.routes ?? [])
      .filter((route) => routeArea(route) === "public" || routeArea(route) === "account")
      .map((route) => route.path),
  );
  const commandActions = new Set<string>();
  for (const command of manifest.commands ?? []) {
    if (!command.label.trim()) {
      throw new Error(`Plugin "${manifest.key}" has a command without a label.`);
    }
    const kinds = [command.path, command.href, command.action].filter((v) => v !== undefined);
    if (kinds.length !== 1) {
      throw new Error(
        `Plugin "${manifest.key}" command "${command.label}" needs exactly one of ` +
          "`path`, `href` or `action`.",
      );
    }
    if (command.path !== undefined && !pages.has(command.path)) {
      throw new Error(
        `Plugin "${manifest.key}" command "${command.label}" opens "${command.path}", ` +
          "which isn't one of its event or manage routes.",
      );
    }
    if (command.href !== undefined)
      assertHttpsUrl(manifest.key, `command "${command.label}"`, command.href);
    if (command.action !== undefined) {
      if (!ACTION_ID.test(command.action) || commandActions.has(command.action)) {
        throw new Error(
          `Plugin "${manifest.key}" command action "${command.action}" needs a unique id of ` +
            "lowercase letters, digits and underscores.",
        );
      }
      commandActions.add(command.action);
    }
  }

  for (const link of manifest.accountLinks ?? []) {
    if (!link.label.trim()) {
      throw new Error(`Plugin "${manifest.key}" has an account link without a label.`);
    }
    if ((link.path === undefined) === (link.href === undefined)) {
      throw new Error(
        `Plugin "${manifest.key}" account link "${link.label}" needs exactly one of ` +
          "`path` or `href`.",
      );
    }
    if (link.path !== undefined && !menuPages.has(link.path)) {
      throw new Error(
        `Plugin "${manifest.key}" account link "${link.label}" opens "${link.path}", ` +
          "which isn't one of its public or account routes. The account menu works outside events.",
      );
    }
    if (link.href !== undefined)
      assertHttpsUrl(manifest.key, `account link "${link.label}"`, link.href);
  }

  for (const table of manifest.uses?.tables ?? []) {
    if (!USES_TABLE.test(table)) {
      throw new Error(`Plugin "${manifest.key}" uses.tables entry "${table}" isn't a table name.`);
    }
  }
  for (const host of manifest.uses?.network ?? []) {
    if (!USES_HOST.test(host)) {
      throw new Error(
        `Plugin "${manifest.key}" uses.network entry "${host}" must be a bare host name ` +
          '(like "api.github.com"), without a scheme or path.',
      );
    }
  }
  for (const namespace of manifest.uses?.settings ?? []) {
    if (!USES_SETTINGS.test(namespace)) {
      throw new Error(
        `Plugin "${manifest.key}" uses.settings entry "${namespace}" isn't a settings namespace.`,
      );
    }
  }

  for (const required of manifest.requires ?? []) {
    if (!KEY.test(required) || required === manifest.key) {
      throw new Error(
        `Plugin "${manifest.key}" requires "${required}", which isn't another plugin's key.`,
      );
    }
  }
  for (const name of manifest.shares?.sql ?? []) {
    if (!SQL_NAME.test(name)) {
      throw new Error(
        `Plugin "${manifest.key}" shares.sql entry "${name}" must be the bare name of one of its ` +
          'SQL objects (like "challenges_scoreboard"), without a schema or arguments.',
      );
    }
  }

  const KIND_NAME = /^[a-z][a-z0-9_-]{0,40}$/;
  const notificationKinds = new Set<string>();
  for (const notification of manifest.notifications ?? []) {
    if (!KIND_NAME.test(notification.kind) || notificationKinds.has(notification.kind)) {
      throw new Error(
        `Plugin "${manifest.key}" notification "${notification.kind}" needs a unique kind of ` +
          "lowercase letters, digits, dashes and underscores.",
      );
    }
    notificationKinds.add(notification.kind);
    if (!notification.label.trim()) {
      throw new Error(
        `Plugin "${manifest.key}" notification "${notification.kind}" needs a label.`,
      );
    }
  }

  const signals = new Set<string>();
  for (const signal of manifest.signals ?? []) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(signal.key) || signals.has(signal.key)) {
      throw new Error(
        `Plugin "${manifest.key}" signal "${signal.key}" needs a unique key of lowercase ` +
          "letters, digits and dashes.",
      );
    }
    signals.add(signal.key);
    if (!signal.label.trim()) {
      throw new Error(`Plugin "${manifest.key}" signal "${signal.key}" needs a label.`);
    }
  }

  const homePanels = new Set<string>();
  for (const panel of manifest.homePanels ?? []) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(panel.key) || homePanels.has(panel.key)) {
      throw new Error(
        `Plugin "${manifest.key}" home panel "${panel.key}" needs a unique key of lowercase ` +
          "letters, digits and dashes.",
      );
    }
    homePanels.add(panel.key);
    if (!panel.label.trim()) {
      throw new Error(`Plugin "${manifest.key}" home panel "${panel.key}" needs a label.`);
    }
  }

  const emailKinds = new Set<string>();
  for (const email of manifest.emails ?? []) {
    if (!KIND_NAME.test(email.kind) || emailKinds.has(email.kind)) {
      throw new Error(
        `Plugin "${manifest.key}" email "${email.kind}" needs a unique kind of lowercase letters, ` +
          "digits, dashes and underscores.",
      );
    }
    emailKinds.add(email.kind);
    const names = new Set(email.variables.map((variable) => variable.name));
    for (const name of email.required) {
      if (!names.has(name)) {
        throw new Error(
          `Plugin "${manifest.key}" email "${email.kind}" requires {{${name}}}, which isn't one of its variables.`,
        );
      }
    }
  }

  const RESERVED_ITEM_CONFIG = ["maxLength", "accept", "maxMb", "namesPeople", "options"];
  const itemKinds = new Set<string>();
  for (const type of manifest.itemTypes ?? []) {
    if (!KIND_NAME.test(type.kind) || itemKinds.has(type.kind)) {
      throw new Error(
        `Plugin "${manifest.key}" item type "${type.kind}" needs a unique kind of lowercase ` +
          "letters, digits, dashes and underscores. Bogey adds the plugin's prefix.",
      );
    }
    itemKinds.add(type.kind);
    if (!type.label.trim() || !type.description.trim()) {
      throw new Error(
        `Plugin "${manifest.key}" item type "${type.kind}" needs a label and a description.`,
      );
    }
    for (const name of Object.keys(type.config ?? {})) {
      if (!/^[a-z][A-Za-z0-9_]*$/.test(name) || RESERVED_ITEM_CONFIG.includes(name)) {
        throw new Error(
          `Plugin "${manifest.key}" item type "${type.kind}" setting "${name}" must be letters, digits ` +
            `and underscores, and not one of ${RESERVED_ITEM_CONFIG.join(", ")}.`,
        );
      }
    }
  }

  const rankingKeys = new Set<string>();
  for (const method of manifest.ranking ?? []) {
    if (!KEBAB.test(method.key) || rankingKeys.has(method.key)) {
      throw new Error(
        `Plugin "${manifest.key}" ranking method "${method.key}" needs a unique lowercase kebab-case key.`,
      );
    }
    rankingKeys.add(method.key);
    if (!method.label.trim() || !method.description.trim()) {
      throw new Error(
        `Plugin "${manifest.key}" ranking method "${method.key}" needs a label and a description.`,
      );
    }
  }

  const localeCodes = new Set<string>();
  for (const locale of manifest.locales ?? []) {
    if (!isLocale(locale.code) || locale.code === SOURCE_LOCALE || localeCodes.has(locale.code)) {
      throw new Error(
        `Plugin "${manifest.key}" locale "${locale.code}" needs a unique language tag like "es" or "pt-BR" ` +
          `(not "${SOURCE_LOCALE}", which Bogey ships).`,
      );
    }
    localeCodes.add(locale.code);
    if (!locale.label.trim() || locale.label.length > 40) {
      throw new Error(
        `Plugin "${manifest.key}" locale "${locale.code}" needs a label of up to 40 characters.`,
      );
    }
  }

  const translations = new Set<string>();
  for (const code of manifest.translations ?? []) {
    if (!isLocale(code) || code === SOURCE_LOCALE || translations.has(code)) {
      throw new Error(
        `Plugin "${manifest.key}" translation "${code}" needs a unique language tag like "es" or ` +
          `"pt-BR" (not "${SOURCE_LOCALE}": its English messages are the source).`,
      );
    }
    translations.add(code);
  }

  const sessionKinds = new Set<string>();
  for (const kind of manifest.sessionKinds ?? []) {
    if (!KEBAB.test(kind.key) || sessionKinds.has(kind.key)) {
      throw new Error(
        `Plugin "${manifest.key}" session kind "${kind.key}" needs a unique lowercase kebab-case key.`,
      );
    }
    sessionKinds.add(kind.key);
    if (!kind.label.trim() || kind.label.length > 40) {
      throw new Error(
        `Plugin "${manifest.key}" session kind "${kind.key}" needs a label of up to 40 characters.`,
      );
    }
    if (!SESSION_KIND_ICONS.includes(kind.icon) || !SESSION_KIND_TONES.includes(kind.tone)) {
      throw new Error(
        `Plugin "${manifest.key}" session kind "${kind.key}" needs one of Bogey's icons and tones ` +
          "(SESSION_KIND_ICONS, SESSION_KIND_TONES).",
      );
    }
  }

  const apiRoutes = new Set<string>();
  for (const route of manifest.serverRoutes ?? []) {
    if (!API_PATH.test(route.path) || !API_METHODS.includes(route.method)) {
      throw new Error(
        `Plugin "${manifest.key}" server route "${route.method} ${route.path}" needs a path of lowercase ` +
          `letters, digits, dashes and underscores (or :name parameters) starting with "/", and a method of ${API_METHODS.join(", ")}.`,
      );
    }
    if (
      route.maxBodyMb !== undefined &&
      (!Number.isInteger(route.maxBodyMb) || route.maxBodyMb < 1 || route.maxBodyMb > 64)
    ) {
      throw new Error(
        `Plugin "${manifest.key}" server route "${route.method} ${route.path}" maxBodyMb must be a whole number from 1 to 64.`,
      );
    }
    const id = `${route.method} ${route.path}`;
    if (apiRoutes.has(id)) {
      throw new Error(`Plugin "${manifest.key}" declares server route "${id}" twice.`);
    }
    apiRoutes.add(id);
  }

  const hotkeys = new Set<string>();
  for (const hotkey of manifest.hotkeys ?? []) {
    if (!/^[a-z][a-z0-9_]*$/.test(hotkey.id) || hotkeys.has(hotkey.id)) {
      throw new Error(
        `Plugin "${manifest.key}" hotkey "${hotkey.id}" needs a unique id of lowercase letters, digits and underscores.`,
      );
    }
    hotkeys.add(hotkey.id);
    if (!pages.has(hotkey.path)) {
      throw new Error(
        `Plugin "${manifest.key}" hotkey "${hotkey.label}" opens "${hotkey.path}", ` +
          "which isn't one of its event or manage routes.",
      );
    }
  }

  const actions = new Set<string>();
  for (const action of manifest.actions ?? []) {
    if (!/^[a-z][a-z0-9_-]*$/.test(action)) {
      throw new Error(
        `Plugin "${manifest.key}" action "${action}" must be lowercase letters, digits, ` +
          `dashes and underscores. Bogey adds the "${manifest.key}." prefix.`,
      );
    }
    if (actions.has(action)) {
      throw new Error(`Plugin "${manifest.key}" declares action "${action}" twice.`);
    }
    actions.add(action);
  }
  for (const action of Object.keys(manifest.actionLabels ?? {})) {
    if (!actions.has(action)) {
      throw new Error(
        `Plugin "${manifest.key}" labels action "${action}", which isn't one of its actions.`,
      );
    }
  }

  const eventTypes = new Set<string>();
  for (const type of manifest.eventTypes ?? []) {
    if (!ROLE_KEY.test(type.key) || eventTypes.has(type.key)) {
      throw new Error(
        `Plugin "${manifest.key}" event type "${type.key}" needs a unique lowercase kebab-case key.`,
      );
    }
    eventTypes.add(type.key);
    if (!type.label.trim() || !type.description.trim()) {
      throw new Error(
        `Plugin "${manifest.key}" event type "${type.key}" needs a label and a description.`,
      );
    }
    if (type.teamSize) {
      const [min, max] = type.teamSize;
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 50) {
        throw new Error(
          `Plugin "${manifest.key}" event type "${type.key}" teamSize must be whole numbers, ` +
            "1 to 50, smallest first.",
        );
      }
    }
  }
  for (const type of manifest.eventTypes ?? []) {
    for (const [name, value] of Object.entries(type.settings ?? {})) {
      const setting = manifest.settings?.[name];
      if (!setting || !matches(setting, value)) {
        throw new Error(
          `Plugin "${manifest.key}" event type "${type.key}" starts "${name}" at a value that ` +
            "isn't one of the plugin's settings, or doesn't fit it.",
        );
      }
    }
  }
  for (const name of Object.keys(manifest.limits ?? {})) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) {
      throw new Error(
        `Plugin "${manifest.key}" limit "${name}" must be camelCase letters and digits.`,
      );
    }
  }
  if (manifest.scope === "org" && eventTypes.size === 0) {
    throw new Error(
      `Plugin "${manifest.key}" is org-scoped, so it's switched on by creating an event of one ` +
        "of its `eventTypes`; it declares none.",
    );
  }
  if (manifest.scope !== "org" && eventTypes.size > 0) {
    throw new Error(
      `Plugin "${manifest.key}" declares \`eventTypes\` but isn't org-scoped. Set \`scope: "org"\`; ` +
        "an event-scoped plugin is turned on by each event's organizers instead.",
    );
  }

  for (const window of manifest.windows ?? []) {
    if (!ROLE_KEY.test(window.key)) {
      throw new Error(
        `Plugin "${manifest.key}" window "${window.key}" must be lowercase kebab-case. Bogey adds ` +
          `the "${manifest.key}." prefix. See pluginWindow().`,
      );
    }
  }

  checkSettingsSections(manifest);
  return manifest;
}

function checkSettingsSections(manifest: PluginManifest): void {
  const pages = new Set<string>();
  const corePages: Tuple<string> = MANAGE_SETTINGS_PAGES;
  for (const page of manifest.settingsPages ?? []) {
    if (!ROLE_KEY.test(page.key) || pages.has(page.key) || corePages.includes(page.key)) {
      throw new Error(
        `Plugin "${manifest.key}" settings page "${page.key}" must be a unique lowercase kebab-case key, not a Manage page's.`,
      );
    }
    if (
      page.route === undefined &&
      manifest.routes?.some(
        (route) => routeArea(route) === "manage" && route.path.split("/")[1] === page.key,
      )
    ) {
      throw new Error(
        `Plugin "${manifest.key}" settings page "${page.key}" has the address of one of its Manage routes. ` +
          `Give it another key, or that route (route: "/${page.key}").`,
      );
    }
    if (page.route !== undefined && !manifest.routes?.some((route) => route.path === page.route)) {
      throw new Error(
        `Plugin "${manifest.key}" settings page "${page.key}" names route "${page.route}", which isn't one of its routes.`,
      );
    }
    pages.add(page.key);
  }
  const core: Tuple<string> = MANAGE_SETTINGS_PAGES;
  const sections = new Set<string>();
  const placed = new Set<string>();
  for (const section of manifest.settingsSections ?? []) {
    if (!ROLE_KEY.test(section.key) || sections.has(section.key)) {
      throw new Error(
        `Plugin "${manifest.key}" settings section "${section.key}" must be a unique lowercase kebab-case key.`,
      );
    }
    sections.add(section.key);
    if (!core.includes(section.page) && !pages.has(section.page)) {
      throw new Error(
        `Plugin "${manifest.key}" settings section "${section.key}" names page "${section.page}", ` +
          `which is neither a Manage page (${core.join(", ")}) nor one of its settingsPages.`,
      );
    }
    for (const name of section.settings) {
      if (!manifest.settings?.[name]) {
        throw new Error(
          `Plugin "${manifest.key}" settings section "${section.key}" names "${name}", which isn't one of its settings.`,
        );
      }
      if (placed.has(name)) {
        throw new Error(`Plugin "${manifest.key}" puts setting "${name}" in two sections.`);
      }
      placed.add(name);
    }
  }
  for (const page of pages) {
    if (![...(manifest.settingsSections ?? [])].some((section) => section.page === page)) {
      throw new Error(`Plugin "${manifest.key}" settings page "${page}" has no sections.`);
    }
  }
}

export function generalSettingNames(manifest: PluginManifest): string[] {
  const placed = new Set((manifest.settingsSections ?? []).flatMap((section) => section.settings));
  return Object.keys(manifest.settings ?? {}).filter((name) => !placed.has(name));
}

export function settingsSectionsOn(
  plugins: Tuple<PluginManifest>,
  page: string,
): Array<{ manifest: PluginManifest; section: PluginSettingsSection }> {
  return plugins.flatMap((manifest) =>
    (manifest.settingsSections ?? [])
      .filter((section) => {
        const own = (manifest.settingsPages ?? []).some((each) => each.key === section.page);
        return own ? `${manifest.key}:${section.page}` === page : section.page === page;
      })
      .map((section) => ({ manifest, section })),
  );
}

export function pluginWindow(manifest: PluginManifest, window: string): string {
  return `${manifest.key}.${window}`;
}

export function pluginNamespace(manifest: Pick<PluginManifest, "key">): string {
  return `plugin.${manifest.key}`;
}

export function pluginAction(manifest: PluginManifest, action: string): string {
  return `${manifest.key}.${action}`;
}

export function routeArea(route: Pick<PluginRouteDeclaration, "area" | "public">): PluginRouteArea {
  return route.area ?? (route.public ? "public" : "event");
}

export function pluginAreaPrefix(area: PluginRouteArea, slug?: string): string {
  switch (area) {
    case "event":
      return `/events/${slug ?? ""}`;
    case "manage":
      return `/events/${slug ?? ""}/manage`;
    case "org":
      return "/org";
    case "account":
      return "/account";
    case "admin":
      return "/admin";
    case "public":
      return "";
  }
}

export function pluginPageUrl(
  manifest: Pick<PluginManifest, "key">,
  area: PluginRouteArea,
  path = "",
  slug?: string,
): string {
  return `${pluginAreaPrefix(area, slug)}/x/${manifest.key}${path}`;
}

export function pluginPath(manifest: Pick<PluginManifest, "key">, path = ""): string {
  return pluginPageUrl(manifest, "public", path);
}

export function pluginPublicUrl(manifest: PluginManifest, path: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}${pluginPath(manifest, path)}`;
}

export interface MatchedPluginRoute {
  route: PluginRouteDeclaration;
  splat: string;
}

export function matchPluginRoute(
  manifest: PluginManifest,
  area: PluginRouteArea,
  below: string | undefined,
): MatchedPluginRoute | null {
  const rest = below ? `/${below}` : "";
  const route = (manifest.routes ?? [])
    .filter(
      (candidate) =>
        routeArea(candidate) === area &&
        (candidate.path === rest ||
          ((area === "public" || candidate.splat === true) &&
            rest.startsWith(`${candidate.path}/`))),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!route) return null;
  return { route, splat: rest.slice(route.path.length).replace(/^\//, "") };
}

export function pluginDefaults(manifest: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [name, setting] of Object.entries(manifest.settings ?? {})) {
    if (setting.default !== undefined) out[name] = setting.default;
    else if (setting.type === "boolean") out[name] = false;
    else if (setting.type === "string") out[name] = "";
    else if (setting.type === "number") out[name] = setting.min ?? 0;
    else if (setting.type === "select") out[name] = setting.options[0]?.value ?? "";
  }

  return out;
}

export function readPluginSettings<M extends PluginManifest>(
  manifest: M,
  stored: Readonly<Record<string, unknown>> | null | undefined,
): SettingsOf<M> {
  const values = stored ?? {};
  const out = pluginDefaults(manifest);

  for (const [name, setting] of Object.entries(manifest.settings ?? {})) {
    const value = values[name];
    if (value === undefined || value === null) continue;
    if (matches(setting, value)) out[name] = value;
  }

  return out as SettingsOf<M>;
}

export function settingScope(setting: PluginSetting): PluginSettingScope {
  return setting.lock ?? setting.scope ?? "event";
}

const SCOPE_ORDER: Record<PluginSettingScope, number> = { instance: 0, org: 1, event: 2 };

export function settingsEditableAt(
  manifest: PluginManifest,
  scope: PluginSettingScope,
): Array<[string, PluginSetting]> {
  return Object.entries(manifest.settings ?? {}).filter(
    ([, setting]) => SCOPE_ORDER[settingScope(setting)] >= SCOPE_ORDER[scope],
  );
}

export function settingsLockedAbove(
  manifest: PluginManifest,
  scope: PluginSettingScope,
): Array<[string, PluginSetting]> {
  return Object.entries(manifest.settings ?? {}).filter(
    ([, setting]) => setting.lock !== undefined && SCOPE_ORDER[setting.lock] < SCOPE_ORDER[scope],
  );
}

export function isSettingVisible(
  manifest: PluginManifest,
  name: string,
  values: Record<string, unknown>,
): boolean {
  return showConditions(manifest.settings?.[name]?.showWhen).every(
    (condition) =>
      isSettingVisible(manifest, condition.setting, values) &&
      condition.in.some((allowed) => Object.is(allowed, values[condition.setting])),
  );
}

export function pluginTogglesPerEvent(manifest: PluginManifest): boolean {
  return (manifest.scope ?? "event") === "event";
}

export interface MountedEventType {
  id: string;
  plugin: string;
  pluginName: string;
  label: string;
  description: string;
  kind: PluginEventKind;
  teamSize: readonly [min: number, max: number];
  settings: Record<string, PluginSettingValue>;
}

export function pluginEventTypes(installed: Tuple<PluginManifest>): MountedEventType[] {
  return installed.flatMap((manifest) =>
    (manifest.eventTypes ?? []).map((type) => ({
      id: `${manifest.key}.${type.key}`,
      plugin: manifest.key,
      pluginName: manifest.name,
      label: type.label,
      description: type.description,
      kind: type.kind ?? "custom",
      teamSize: type.teamSize ?? [1, 4],
      settings: type.settings ?? {},
    })),
  );
}

export interface MountedLimit {
  key: string;
  plugin: string;
  pluginName: string;
  name: string;
  label: string;
  description?: string;
  unit?: string;
}

export function pluginLimits(installed: Tuple<PluginManifest>): MountedLimit[] {
  return installed.flatMap((manifest) =>
    Object.entries(manifest.limits ?? {}).map(([name, limit]) => ({
      key: `${manifest.key}.${name}`,
      plugin: manifest.key,
      pluginName: manifest.name,
      name,
      label: limit.label,
      ...(limit.description ? { description: limit.description } : {}),
      ...(limit.unit ? { unit: limit.unit } : {}),
    })),
  );
}

export function pluginLimitsNamespace(manifest: Pick<PluginManifest, "key">): string {
  return `plugin.${manifest.key}.limits`;
}

export function validPluginSettings(
  manifest: PluginManifest,
  values: Record<string, unknown>,
): Record<string, PluginSettingValue> {
  const out: Record<string, PluginSettingValue> = {};
  for (const [name, setting] of Object.entries(manifest.settings ?? {})) {
    const value = values[name];
    if (matches(setting, value)) out[name] = value;
  }
  return out;
}

function matches(setting: PluginSetting, value: unknown): value is PluginSettingValue {
  switch (setting.type) {
    case "boolean":
      return typeof value === "boolean";
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (setting.min !== undefined && value < setting.min) return false;
      if (setting.max !== undefined && value > setting.max) return false;
      return true;
    case "string":
      return typeof value === "string";
    case "select":
      return typeof value === "string" && setting.options.some((o) => o.value === value);
  }
}

export interface MountedRoute extends PluginRouteDeclaration {
  key: string;
  name: string;
  area: PluginRouteArea;
}

export function pluginRoutes(
  installed: Tuple<PluginManifest>,
  area?: PluginRouteArea,
): MountedRoute[] {
  return installed.flatMap((manifest) =>
    (manifest.routes ?? [])
      .map((route) => ({
        ...route,
        key: manifest.key,
        name: manifest.name,
        area: routeArea(route),
      }))
      .filter((route) => area === undefined || route.area === area),
  );
}

export interface PluginWindow {
  key: string;
  label: string;
}

export function pluginWindows(installed: Tuple<PluginManifest>): PluginWindow[] {
  return installed.flatMap((manifest) =>
    (manifest.windows ?? []).map((window) => ({
      key: pluginWindow(manifest, window.key),
      label: window.label,
    })),
  );
}

export function pluginPermissions(installed: Tuple<PluginManifest>): string[] {
  return installed.flatMap((manifest) =>
    (manifest.permissions ?? []).map((permission) => `${manifest.key}.${permission}`),
  );
}

export interface PluginRole {
  key: string;
  label: string;
  grants: string[];
  source: string;
}

export function pluginRoles(installed: Tuple<PluginManifest>): PluginRole[] {
  return installed.flatMap((manifest) =>
    (manifest.roles ?? []).map((role) => ({
      key: `${manifest.key}.${role.key}`,
      label: role.label,
      grants: (role.grants ?? []).map((grant) => `${manifest.key}.${grant}`),
      source: manifest.key,
    })),
  );
}

export function pluginActionLabel(installed: Tuple<PluginManifest>, action: string): string | null {
  const [key, ...rest] = action.split(".");
  const manifest = installed.find((plugin) => plugin.key === key);
  return manifest?.actionLabels?.[rest.join(".")] ?? null;
}

export function pluginActions(installed: Tuple<PluginManifest>): string[] {
  return installed.flatMap((manifest) =>
    (manifest.actions ?? []).map((action) => pluginAction(manifest, action)),
  );
}

export interface ParsedRepository {
  owner: string;
  repo: string;
  url: string;
}

export function parseRepository(repository: string): ParsedRepository | null {
  const shorthand = /^github:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(repository);
  if (shorthand) {
    return {
      owner: shorthand[1]!,
      repo: shorthand[2]!,
      url: `https://github.com/${shorthand[1]}/${shorthand[2]}`,
    };
  }

  const url = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(repository);
  if (url) {
    return { owner: url[1]!, repo: url[2]!, url: `https://github.com/${url[1]}/${url[2]}` };
  }

  return null;
}

export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value
      .split(/[-+]/)[0]!
      .split(".")
      .map((piece) => Number.parseInt(piece, 10) || 0);

  const left = parts(a);
  const right = parts(b);

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }

  return 0;
}

export function pluginRepositoryUrl(manifest: PluginManifest): string | null {
  const parsed = parseRepository(manifest.source.repository);
  if (!parsed) return null;

  return manifest.source.directory
    ? `${parsed.url}/tree/HEAD/${manifest.source.directory.replace(/^\/+/, "")}`
    : parsed.url;
}

export interface MountedAccountLink {
  key: string;
  plugin: string;
  pluginName: string;
  label: string;
  href: string;
  external: boolean;
}

export function pluginAccountLinks(installed: Tuple<PluginManifest>): MountedAccountLink[] {
  return installed.flatMap((manifest) =>
    (manifest.accountLinks ?? []).map((link) => ({
      key: `${manifest.key}:${link.label}`,
      plugin: manifest.key,
      pluginName: manifest.name,
      label: link.label,
      href:
        link.href ??
        pluginPageUrl(
          manifest,
          routeArea(
            manifest.routes?.find((route) => route.path === link.path) ?? { area: "public" },
          ),
          link.path,
        ),
      external: link.href !== undefined,
    })),
  );
}

export interface MountedCommand {
  id: string;
  key: string;
  name: string;
  label: string;
  keywords: Tuple<string>;
  href?: string;
  action?: string;
}

export function pluginChromeCommands(installed: Tuple<PluginManifest>): MountedCommand[] {
  return installed.flatMap((manifest) =>
    (manifest.commands ?? []).flatMap((command): MountedCommand[] => {
      if (command.path !== undefined) return [];
      return [
        {
          id: `plugin-${manifest.key}-${command.href ?? command.action}`,
          key: manifest.key,
          name: manifest.name,
          label: command.label,
          keywords: [manifest.name, ...(command.keywords ?? [])],
          ...(command.href !== undefined ? { href: command.href } : {}),
          ...(command.action !== undefined ? { action: command.action } : {}),
        },
      ];
    }),
  );
}

export interface MountedItemType {
  kind: string;
  plugin: string;
  pluginName: string;
  label: string;
  description: string;
  config: Record<string, PluginSetting>;
}

export function pluginItemTypes(installed: Tuple<PluginManifest>): MountedItemType[] {
  return installed.flatMap((manifest) =>
    (manifest.itemTypes ?? []).map((type) => ({
      kind: `${manifest.key}.${type.kind}`,
      plugin: manifest.key,
      pluginName: manifest.name,
      label: type.label,
      description: type.description,
      config: type.config ?? {},
    })),
  );
}

export function validItemConfig(
  type: Pick<MountedItemType, "config">,
  values: Record<string, unknown>,
): Record<string, PluginSettingValue> {
  const out: Record<string, PluginSettingValue> = {};
  for (const [name, setting] of Object.entries(type.config)) {
    const value = values[name];
    if (matches(setting, value)) out[name] = value;
  }
  return out;
}

export function itemConfigDefaults(
  type: Pick<MountedItemType, "config">,
): Record<string, PluginSettingValue> {
  const out: Record<string, PluginSettingValue> = {};
  for (const [name, setting] of Object.entries(type.config)) {
    if (setting.default !== undefined) out[name] = setting.default;
  }
  return out;
}

export interface MountedRankingMethod {
  id: string;
  plugin: string;
  pluginName: string;
  label: string;
  description: string;
}

export function pluginRankingMethods(installed: Tuple<PluginManifest>): MountedRankingMethod[] {
  return installed.flatMap((manifest) =>
    (manifest.ranking ?? []).map((method) => ({
      id: `${manifest.key}.${method.key}`,
      plugin: manifest.key,
      pluginName: manifest.name,
      label: method.label,
      description: method.description,
    })),
  );
}

export interface MountedSessionKind extends PluginSessionKindDeclaration {
  id: string;
  plugin: string;
}

export function pluginSessionKinds(installed: Tuple<PluginManifest>): MountedSessionKind[] {
  return installed.flatMap((manifest) =>
    (manifest.sessionKinds ?? []).map((kind) => ({
      ...kind,
      id: `${manifest.key}.${kind.key}`,
      plugin: manifest.key,
    })),
  );
}

export interface MountedApiRoute extends PluginApiDeclaration {
  plugin: string;
  url: string;
}

export function pluginApiRoutes(installed: Tuple<PluginManifest>): MountedApiRoute[] {
  return installed.flatMap((manifest) =>
    (manifest.serverRoutes ?? []).map((route) => ({
      ...route,
      plugin: manifest.key,
      url: `/api/x/${manifest.key}${route.path === "/" ? "" : route.path}`,
    })),
  );
}

export function pluginEmailKinds(
  installed: Tuple<PluginManifest>,
): Tuple<{ key: string; kind: EmailKind }> {
  const common: Tuple<EmailVariable> = [
    { name: "event", label: "The event's name", example: "Spring Hackathon" },
    {
      name: "link",
      label: "A link to the event",
      example: "https://hacks.example.com/events/spring",
    },
    { name: "org", label: "The organization's name", example: "Acme Hack Club" },
    { name: "platform", label: "The platform's name", example: "Bogey" },
    { name: "email", label: "The person's email address", example: "ada@example.com" },
  ];
  return installed.flatMap((manifest) =>
    (manifest.emails ?? []).map((email) => ({
      key: `${manifest.key}.${email.kind}`,
      kind: {
        label: `${manifest.name}: ${email.label}`,
        description: email.description,
        variables: [
          ...email.variables,
          ...common.filter(
            (variable) => !email.variables.some((own) => own.name === variable.name),
          ),
        ],
        requires: email.required,
        reason: email.reason,
        defaults: email.defaults,
      },
    })),
  );
}

export function pluginNotificationKinds(
  installed: Tuple<PluginManifest>,
): Tuple<{ key: string; plugin: string; label: string; email: boolean }> {
  return installed.flatMap((manifest) =>
    (manifest.notifications ?? []).map((notification) => ({
      key: `${manifest.key}.${notification.kind}`,
      plugin: manifest.key,
      label: `${manifest.name}: ${notification.label}`,
      email: notification.email ?? false,
    })),
  );
}
