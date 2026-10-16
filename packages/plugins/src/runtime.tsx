import type { ComponentType, ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Session } from "@bogey/db/auth";
import type { Messages } from "@bogey/utils/messages";
import type { createServerClient, createServerClientFor } from "@bogey/db/server";
import {
  registerPluginAnswerValidator,
  type AnswerValue,
  type PluginAnswerItem,
  type PluginAnswerKind,
  type PluginAnswerValidator,
} from "@bogey/utils/answers";
import { routeArea } from "./api.ts";
import type {
  AreaOfPath,
  CommandActionsOf,
  HomePanelsOf,
  ItemKindsOf,
  LocaleCodesOf,
  PathsIn,
  PluginManifest,
  PluginSignedInArea,
  ServerRoutesOf,
  SettingsOf,
  TranslationCodesOf,
} from "./types.ts";

export interface PluginContext<TSettings = Record<string, unknown>> {
  eventId: string;
  settings: TSettings;
  session: Session;
  settingsSections?: ReactNode;
}

export type PluginPage<TSettings = Record<string, unknown>> = ComponentType<
  PluginContext<TSettings>
>;

export interface PluginSignedInContext<TSettings = Record<string, unknown>> {
  settings: TSettings;
  session: Session;
}

export interface PluginOrgContext<
  TSettings = Record<string, unknown>,
> extends PluginSignedInContext<TSettings> {
  orgId: string;
}

export interface PluginAreaContexts<TSettings = Record<string, unknown>> {
  event: PluginContext<TSettings>;
  manage: PluginContext<TSettings>;
  org: PluginOrgContext<TSettings>;
  account: PluginSignedInContext<TSettings>;
  admin: PluginSignedInContext<TSettings>;
}

export type PluginPageContext<
  A extends PluginSignedInArea,
  TSettings = Record<string, unknown>,
> = PluginAreaContexts<TSettings>[A] & {
  splat: string;
};

export interface PluginPageDefinition<C> {
  component: ComponentType<C>;
  loader?: (context: C & { queryClient: QueryClient }) => unknown;
  title?: (context: C & { queryClient: QueryClient }) => string | Promise<string>;
}

export type PluginPageEntry<C> = ComponentType<C> | PluginPageDefinition<C>;

export interface PluginRouteContext<
  TSettings = Record<string, unknown>,
> extends PluginContext<TSettings> {
  splat: string;
}

export type PluginRoutePage<TSettings = Record<string, unknown>> = ComponentType<
  PluginRouteContext<TSettings>
>;

export type PluginPreferencesContext<TSettings = Record<string, unknown>> =
  PluginSignedInContext<TSettings>;

export type PluginPreferencesPage<TSettings = Record<string, unknown>> = ComponentType<
  PluginPreferencesContext<TSettings>
>;

export interface PluginLoaderContext<
  TSettings = Record<string, unknown>,
> extends PluginRouteContext<TSettings> {
  queryClient: QueryClient;
}

export type PluginRouteDefinition<TSettings = Record<string, unknown>> = PluginPageDefinition<
  PluginRouteContext<TSettings>
>;

export interface PluginPublicContext {
  splat: string;
}

export type PluginPublicPage = ComponentType<PluginPublicContext>;

export type PluginRouteEntry<TSettings = Record<string, unknown>> = PluginPageEntry<
  PluginRouteContext<TSettings>
>;

export interface PluginActionContext {
  session: Session;
}

export type PluginActionHandler = (context: PluginActionContext) => void;

export interface PluginItemInfo extends PluginAnswerItem {
  key: string;
  help: string | null;
}

export interface PluginItemFieldProps {
  id: string;
  item: PluginItemInfo;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  onBlur: () => void;
  invalid: boolean;
  disabled?: boolean;
}

export interface PluginItemViewProps {
  item: PluginItemInfo;
  value: AnswerValue;
}

export interface PluginItemType {
  Field: ComponentType<PluginItemFieldProps>;
  View: ComponentType<PluginItemViewProps>;
  validate: PluginAnswerValidator;
}

export interface PluginJudgingPanelContext<
  TSettings = Record<string, unknown>,
> extends PluginContext<TSettings> {
  method: string;
  formId: string;
  roundId: string | null;
  submissionId: string;
}

export interface PluginSessionPanelContext<
  TSettings = Record<string, unknown>,
> extends PluginContext<TSettings> {
  sessionId: string;
  kind: string;
}

// settings are the instance's; tokens are single-use, so Bogey remounts the widget after each try
export interface PluginAuthCaptchaContext<TSettings = Record<string, unknown>> {
  settings: TSettings;
  onToken: (token: string | null) => void;
}

// a plugin's own control for one of its settings, in place of the default input
export interface PluginSettingControlProps {
  id: string;
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
}

export interface PluginSlots<TSettings = Record<string, unknown>> {
  pending?: ComponentType;
  authCaptcha?: ComponentType<PluginAuthCaptchaContext<TSettings>>;
  wrapper?: ComponentType<{ children: ReactNode }>;
  eventWrapper?: ComponentType<PluginContext<TSettings> & { children: ReactNode }>;
  preferencesPanel?: PluginPreferencesPage<TSettings>;
  accountMenu?: PluginPreferencesPage<TSettings>;
  menubar?: PluginPreferencesPage<TSettings>;
  organizerPanel?: PluginPage<TSettings>;
  manageOverview?: PluginPage<TSettings>;
  conversationTopic?: ComponentType<PluginContext<TSettings> & { topic: string }>;
  judgingPanel?: ComponentType<PluginJudgingPanelContext<TSettings>>;
  sessionPanel?: ComponentType<PluginSessionPanelContext<TSettings>>;
  /** Keyed by setting name. */
  settingControls?: Record<string, ComponentType<PluginSettingControlProps>>;
}

export interface PluginServerContext {
  supabase: ReturnType<typeof createServerClient>;
  supabaseFor: typeof createServerClientFor;
  user: { id: string; email: string | null } | null;
  eventId: string | null;
  path: string;
  params: Readonly<Record<string, string>>;
  body: () => Promise<Uint8Array>;
}

export type PluginServerHandler = (
  request: Request,
  context: PluginServerContext,
) => Response | Promise<Response>;

type ItemTypesOf<M extends PluginManifest> = [ItemKindsOf<M>] extends [never]
  ? { itemTypes?: undefined }
  : {
      itemTypes: { [K in ItemKindsOf<M>]: PluginItemType };
    };

type CatalogsDefinition<M extends PluginManifest> = [LocaleCodesOf<M>] extends [never]
  ? { catalogs?: undefined }
  : {
      catalogs: { [L in LocaleCodesOf<M>]: () => Promise<Messages> };
    };

type MessagesDefinition<M extends PluginManifest> = [TranslationCodesOf<M>] extends [never]
  ? { messages?: undefined }
  : {
      messages: { [L in TranslationCodesOf<M>]: () => Promise<Messages> };
    };

type ServerRoutesDefinition<M extends PluginManifest> = [ServerRoutesOf<M>] extends [never]
  ? { serverRoutes?: undefined }
  : {
      serverRoutes: { [R in ServerRoutesOf<M>]: PluginServerHandler };
    };

type RoutesDefinition<M extends PluginManifest> = [PathsIn<M, PluginSignedInArea>] extends [never]
  ? { routes?: undefined }
  : {
      routes: {
        [P in PathsIn<M, PluginSignedInArea>]: PluginPageEntry<
          PluginPageContext<AreaOfPath<M, P> & PluginSignedInArea, SettingsOf<M>>
        >;
      };
    };

type PublicRoutesDefinition<M extends PluginManifest> = [PathsIn<M, "public">] extends [never]
  ? { publicRoutes?: undefined }
  : {
      publicRoutes: { [P in PathsIn<M, "public">]: PluginPublicPage };
    };

type HomePanelsDefinition<M extends PluginManifest> = [HomePanelsOf<M>] extends [never]
  ? { homePanels?: undefined }
  : {
      homePanels: { [K in HomePanelsOf<M>]: PluginPage<SettingsOf<M>> };
    };

type ActionsDefinition<M extends PluginManifest> = [CommandActionsOf<M>] extends [never]
  ? { actions?: undefined }
  : {
      actions: { [A in CommandActionsOf<M>]: PluginActionHandler };
    };

export type PluginRuntimeDefinition<M extends PluginManifest> = {
  slots?: PluginSlots<SettingsOf<M>>;
} & RoutesDefinition<M> &
  MessagesDefinition<M> &
  PublicRoutesDefinition<M> &
  ActionsDefinition<M> &
  HomePanelsDefinition<M> &
  ItemTypesOf<M> &
  CatalogsDefinition<M> &
  ServerRoutesDefinition<M>;

export type PluginAreaRoutes<A extends PluginSignedInArea> = Record<
  string,
  PluginPageDefinition<PluginPageContext<A>>
>;

export interface PluginRuntime {
  routes: { [A in PluginSignedInArea]: PluginAreaRoutes<A> };
  publicRoutes: Record<string, PluginPublicPage>;
  slots: PluginSlots;
  actions: Record<string, PluginActionHandler>;
  homePanels: Record<string, PluginPage>;
  itemTypes: Record<string, PluginItemType>;
  catalogs: Record<string, () => Promise<Messages>>;
  messages: Readonly<Record<string, () => Promise<Messages>>>;
  serverRoutes: Record<string, PluginServerHandler>;
}

export function definePluginRuntime<const M extends PluginManifest>(
  manifest: M,
  definition: PluginRuntimeDefinition<M>,
): PluginRuntime {
  const entries = (definition.routes ?? {}) as Readonly<
    Record<string, PluginPageEntry<PluginPageContext<PluginSignedInArea>> | undefined>
  >;
  const publicRoutes = (definition.publicRoutes ?? {}) as Record<string, PluginPublicPage>;
  const routes: PluginRuntime["routes"] = {
    event: {},
    manage: {},
    org: {},
    account: {},
    admin: {},
  };

  for (const route of manifest.routes ?? []) {
    const area = routeArea(route);
    if (area === "public") {
      if (!publicRoutes[route.path]) {
        throw new Error(
          `Plugin "${manifest.key}" declares public route "${route.path}" but its runtime doesn't ` +
            "implement it in `publicRoutes`.",
        );
      }
      continue;
    }
    const entry = entries[route.path];
    if (!entry) {
      throw new Error(
        `Plugin "${manifest.key}" declares ${area} route "${route.path}" but its runtime doesn't ` +
          "implement it in `routes`.",
      );
    }
    const into = routes[area] as PluginAreaRoutes<PluginSignedInArea>;
    into[route.path] = typeof entry === "function" ? { component: entry } : entry;
  }

  const actions = (definition.actions ?? {}) as Record<string, PluginActionHandler>;

  for (const command of manifest.commands ?? []) {
    if (command.action !== undefined && typeof actions[command.action] !== "function") {
      throw new Error(
        `Plugin "${manifest.key}" declares command action "${command.action}" but its ` +
          "runtime doesn't implement it in `actions`.",
      );
    }
  }

  const homePanels: Record<string, PluginPage> = {};
  const panels = (definition.homePanels ?? {}) as Record<string, PluginPage | undefined>;
  for (const panel of manifest.homePanels ?? []) {
    const component = panels[panel.key];
    if (!component) {
      throw new Error(
        `Plugin "${manifest.key}" declares home panel "${panel.key}" but its runtime doesn't ` +
          "implement it in `homePanels`.",
      );
    }
    homePanels[panel.key] = component;
  }

  const itemTypes: Record<string, PluginItemType> = {};
  const declared = (definition.itemTypes ?? {}) as Record<string, PluginItemType | undefined>;
  for (const type of manifest.itemTypes ?? []) {
    const implemented = declared[type.kind];
    if (!implemented) {
      throw new Error(
        `Plugin "${manifest.key}" declares item type "${type.kind}" but its runtime doesn't implement it ` +
          "in `itemTypes`.",
      );
    }
    const kind: PluginAnswerKind = `${manifest.key}.${type.kind}`;
    itemTypes[kind] = implemented;
    registerPluginAnswerValidator(kind, implemented.validate);
  }

  const catalogs: Record<string, () => Promise<Messages>> = {};
  const loaders = (definition.catalogs ?? {}) as Record<
    string,
    (() => Promise<Messages>) | undefined
  >;
  for (const locale of manifest.locales ?? []) {
    const load = loaders[locale.code];
    if (!load) {
      throw new Error(
        `Plugin "${manifest.key}" declares locale "${locale.code}" but its runtime doesn't implement it ` +
          "in `catalogs`.",
      );
    }
    catalogs[locale.code] = load;
  }

  const messages: Record<string, () => Promise<Messages>> = {};
  const translations = (definition.messages ?? {}) as Record<
    string,
    (() => Promise<Messages>) | undefined
  >;
  for (const code of manifest.translations ?? []) {
    const load = translations[code];
    if (!load) {
      throw new Error(
        `Plugin "${manifest.key}" declares translation "${code}" but its runtime doesn't implement ` +
          "it in `messages`.",
      );
    }
    messages[code] = load;
  }

  const serverRoutes: Record<string, PluginServerHandler> = {};
  const handlers = (definition.serverRoutes ?? {}) as Record<
    string,
    PluginServerHandler | undefined
  >;
  for (const route of manifest.serverRoutes ?? []) {
    const id = `${route.method} ${route.path}`;
    const handler = handlers[id];
    if (!handler) {
      throw new Error(
        `Plugin "${manifest.key}" declares server route "${id}" but its runtime doesn't implement it ` +
          "in `serverRoutes`.",
      );
    }
    serverRoutes[id] = handler;
  }

  return {
    routes,
    publicRoutes,
    messages,
    slots: (definition.slots ?? {}) as PluginSlots,
    actions,
    homePanels,
    itemTypes,
    catalogs,
    serverRoutes,
  };
}
