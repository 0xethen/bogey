import { useLayoutEffect, type ReactNode } from "react";
import {
  ScriptOnce,
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  redirect,
  useMatches,
  useRouter,
} from "@tanstack/react-router";

import { localizationQueryOptions } from "#/lib/i18n.ts";
import { I18nProvider, sayWith, translatorFor } from "#/lib/translate.tsx";
import { consumeRedirectFn, exchangeCodeForSessionFn } from "@bogey/db/auth";
import { suspensionQueryOptions } from "@bogey/db/tenant";
import { getPublicEnv, publicEnvScript } from "@bogey/db/env";
import { classNamesOf, makeTitle } from "#/lib/routing";
import { loadSeo, seoMeta } from "#/lib/seo.ts";
import { useJumpHighlight } from "#/lib/jump.ts";
import { ShortcutsHelp } from "#/components/app/ShortcutsHelp.tsx";
import { BogeyDevtools } from "./-components/BogeyDevtools.tsx";
import { UnsavedChanges } from "#/components/unsaved-changes/index.tsx";
import { loadedPluginSlots, pluginSlots } from "@bogey/plugins";
import type { Context } from "#/router";

import { TooltipProvider } from "@bogey/ui/components/tooltip";
import { TimeFormatProvider } from "@bogey/ui/lib/time-format";
import {
  browserTimeZoneQueryOptions,
  useSyncBrowserTimeZone,
  useViewerTimeFormat,
} from "#/lib/time.ts";
import { Toaster } from "@bogey/ui/components/toast";
import { cn } from "@bogey/ui/lib/utils";
import css from "#/index.css?url";

import { Mesurer } from "mesurer";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { Header, resolveHeader, useResolvedHeader } from "#/components/navigation/header/index.tsx";
import { useViewAs } from "@bogey/db/permissions";
import { INSTANCE_THEME, themeAttribute } from "#/lib/brand-theme.ts";
import { initTheme } from "#/lib/theme.ts";
import { brand, publicConfig, publicConfigScript } from "@bogey/config";

export const Route = createRootRouteWithContext<Context>()({
  staticData: { title: brand.name || "Bogey" },
  beforeLoad: async ({ context, location }) => {
    await pluginSlots();
    const search: Record<string, unknown> = location.search;

    if (location.pathname !== "/suspended") {
      const suspension = await context.query.ensureQueryData(suspensionQueryOptions());
      if (suspension) throw redirect({ to: "/suspended", replace: true });
    }

    const tokenHash = search.token_hash;
    if (typeof tokenHash === "string" && location.pathname !== "/auth/confirm") {
      const type = typeof search.type === "string" ? search.type : undefined;
      throw redirect({
        to: "/auth/confirm",
        search: { token_hash: tokenHash, type },
        replace: true,
      });
    }

    const code = search.code;
    if (typeof code !== "string" || !code) return;

    const result = await exchangeCodeForSessionFn({ data: code });

    const destination = await consumeRedirectFn();

    if (!result.ok) throw redirect({ to: "/auth/login", search: { error: "auth" } });

    if (destination) throw redirect({ href: destination, replace: true });
    throw redirect({ to: "/", replace: true });
  },
  loader: async ({ context }) => {
    const [seo, localization] = await Promise.all([
      loadSeo(context.query),
      context.query.ensureQueryData(localizationQueryOptions()),
      context.query.ensureQueryData(browserTimeZoneQueryOptions()),
    ]);
    return { seo, localization };
  },
  head: ({ matches, loaderData }) => {
    const say = sayWith(translatorFor(loaderData?.localization));
    return {
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        {
          name: "theme-color",
          content: "#0B0B12",
        },
        {
          title: makeTitle(matches, say) || "Bogey",
        },
        ...(loaderData
          ? seoMeta({
              seo: loaderData.seo,
              signedIn: matches.some((match) => match.routeId.startsWith("/_authed")),
              title: makeTitle(matches, say) || brand.name,
              siteName: brand.name,
            })
          : []),
      ],
      links: [
        {
          rel: "stylesheet",
          href: css,
        },
        ...faviconLinks(),
      ],
    };
  },
  shellComponent: RootDocument,
  component: RouteComponent,
});

// favicon from bogey.config's brand.icons, with Bogey's own as the fallback
function faviconLinks() {
  if (!brand.icons) return [{ rel: "icon", href: "/favicon.ico" }];
  const { default: light, dark } = brand.icons;
  const type = (href: string) =>
    href.endsWith(".svg")
      ? "image/svg+xml"
      : href.endsWith(".ico")
        ? "image/x-icon"
        : href.endsWith(".png")
          ? "image/png"
          : undefined;
  return dark
    ? [
        { rel: "icon", href: light, type: type(light), media: "(prefers-color-scheme: light)" },
        { rel: "icon", href: dark, type: type(dark), media: "(prefers-color-scheme: dark)" },
      ]
    : [{ rel: "icon", href: light, type: type(light) }];
}

function RootDocument({ children }: { children: ReactNode }) {
  const router = useRouter({ warn: false });
  const matches = router ? router.stores.matches.get() : [];
  const lang = matches[0]?.loaderData?.localization?.locale ?? "en";

  return (
    <html
      lang={lang}
      className={cn(classNamesOf(matches)?.root)}
      data-header-type={resolveHeader(matches).type}
      data-theme={themeAttribute(INSTANCE_THEME)}
      suppressHydrationWarning
    >
      <head>
        <ScriptOnce>{publicEnvScript(getPublicEnv())}</ScriptOnce>
        <ScriptOnce>{publicConfigScript(publicConfig)}</ScriptOnce>
        <HeadContent />
      </head>
      <body className={cn(classNamesOf(matches)?.body)}>
        <ScriptOnce>{initTheme}</ScriptOnce>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RouteComponent() {
  const { localization } = Route.useLoaderData();
  const matches = useMatches();
  const header = useResolvedHeader();
  const classNames = classNamesOf(matches);
  const previewing = useViewAs();

  useDocumentChrome(header.type, previewing, classNames?.root, classNames?.body);
  useJumpHighlight();

  return (
    <I18nProvider
      locale={localization.locale}
      overlay={localization.overlay}
      missing={localization.missing}
      fallback={localization.fallback}
    >
      <TooltipProvider>
        <ViewerTime>
          <>
            <UnsavedChanges>
              <PluginWrappers>
                <Header />
                <Outlet />
              </PluginWrappers>
            </UnsavedChanges>
            <ShortcutsHelp />
            {import.meta.env.DEV && <Mesurer />}
            <Toaster />
            <TanStackDevtools
              config={{ position: "bottom-right" }}
              plugins={[
                {
                  name: "Tanstack Router",
                  render: <TanStackRouterDevtoolsPanel />,
                },
                {
                  name: "Tanstack Query",
                  render: <ReactQueryDevtoolsPanel />,
                },
                formDevtoolsPlugin(),
                {
                  name: "Bogey",
                  render: (_element, { theme }) => <BogeyDevtools theme={theme} />,
                },
              ]}
              eventBusConfig={{
                connectToServerBus: true,
              }}
            />
          </>
        </ViewerTime>
      </TooltipProvider>
    </I18nProvider>
  );
}

function useDocumentChrome(
  headerType: string | undefined,
  previewing: string | null,
  rootClass: string | undefined,
  bodyClass: string | undefined,
) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.headerType = headerType || "none";

    if (previewing) root.dataset.previewing = "true";
    else delete root.dataset.previewing;

    root.classList.remove(...previous.root);
    root.classList.add(...split(rootClass));
    previous.root = split(rootClass);

    document.body.classList.remove(...previous.body);
    document.body.classList.add(...split(bodyClass));
    previous.body = split(bodyClass);
  }, [headerType, previewing, rootClass, bodyClass]);
}

// TODO: type with ext type
const previous = { root: [] as string[], body: [] as string[] };

function split(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function ViewerTime({ children }: { children: ReactNode }) {
  useSyncBrowserTimeZone();
  return <TimeFormatProvider value={useViewerTimeFormat()}>{children}</TimeFormatProvider>;
}

function PluginWrappers({ children }: { children: ReactNode }) {
  return loadedPluginSlots().reduceRight<ReactNode>((inner, { key, slots }) => {
    const Wrapper = slots.wrapper;
    return Wrapper ? <Wrapper key={key}>{inner}</Wrapper> : inner;
  }, children);
}
