import type { SettingsSearchEntry } from "#/components/settings/layout/search-entries.ts";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

import { QueryClient } from "@tanstack/react-query";
import { retryPolicy } from "@bogey/db/errors";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { NotFoundComponent } from "#/components/fallbacks/NotFoundComponent";
import { PendingComponent } from "#/components/fallbacks/PendingComponent";
import { ErrorComponent } from "#/components/fallbacks/ErrorComponent";

import type { HeaderDeclaration } from "#/components/navigation/header/index.tsx";
import type { RouteTitle } from "#/lib/routing.ts";
import type { T } from "#/lib/translate.tsx";
import type { CommandOption } from "#/lib/commands.ts";

export interface Context {
  query: QueryClient;
}

export function getRouter() {
  const query = new QueryClient({
    defaultOptions: {
      queries: {
        retry: retryPolicy,
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchOnMount: false,
        retryOnMount: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

  const router = createTanStackRouter({
    routeTree,
    context: { query },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 300,
    defaultPendingMinMs: 400,

    defaultNotFoundComponent: NotFoundComponent,
    defaultPendingComponent: PendingComponent,
    defaultErrorComponent: ErrorComponent,
  });

  setupRouterSsrQueryIntegration({ router, queryClient: query });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }

  interface StaticDataRouteOption {
    title?: RouteTitle;
    header?: HeaderDeclaration;
    command?: CommandOption | false;
    classNames?: { root?: string; body?: string } | null;
    settings?: Tuple<SettingsSearchEntry> | ((t: T) => Tuple<SettingsSearchEntry>);
  }
}
