import { IconLock } from "@tabler/icons-react";
import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { redirectParam, sessionQueryOptions, type Session } from "@bogey/db/auth";
import { BogeyRequestError } from "@bogey/db/errors";
import { rolesQueryOptions } from "@bogey/db/queries/roles";
import { negotiateLocale } from "@bogey/utils/locale";
import { localizationFn, localizationQueryOptions } from "#/lib/i18n.ts";
import { CmdK } from "#/components/app/CmdK.tsx";
import { SignOutDialog } from "#/components/app/SignOutDialog.tsx";
import { AccountMenu } from "#/components/navigation/header/AccountMenu.tsx";
import { NotificationBell } from "#/components/navigation/header/NotificationBell.tsx";
import { PluginMenubar } from "#/components/navigation/header/PluginMenubar.tsx";
import { AccessibilityPreferences } from "#/lib/accessibility.tsx";
import { useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed")({
  staticData: {
    header: {
      type: "menubar",
      content: {
        end: (
          <>
            <PluginMenubar />
            <NotificationBell />
            <AccountMenu />
          </>
        ),
      },
    },
    classNames: { root: "overscroll-y-none" },
  },
  beforeLoad: async ({ context, location }) => {
    const result = await context.query.fetchQuery(sessionQueryOptions());

    if (result.status === "unavailable") {
      throw new BogeyRequestError({
        code: "unavailable",
        message: "We can't reach the server to check your sign-in. Try again in a moment.",
        retryable: true,
      });
    }
    if (result.status === "anonymous") {
      throw Route.redirect({
        to: "/auth/login",
        search: { redirect: redirectParam(location.href) },
      });
    }

    const chosen = result.session.profile?.locale;
    await Promise.all([
      chosen && applyAccountLocale(context.query, chosen),
      context.query.ensureQueryData(rolesQueryOptions()),
    ]);
    return { session: result.session };
  },
  component: RouteComponent,
});

async function applyAccountLocale(query: QueryClient, chosen: string) {
  const current = await query.ensureQueryData(localizationQueryOptions());
  const codes = current.languages.map((language) => language.code);
  if (negotiateLocale([chosen], codes) === current.locale) return;
  query.setQueryData(localizationQueryOptions().queryKey, await localizationFn({ data: chosen }));
}

function RouteComponent() {
  const { session } = Route.useRouteContext();
  return (
    <AccessibilityPreferences>
      <OrgStatusNotice org={session.org} />
      <Outlet />
      <CmdK session={session} />
      <SignOutDialog />
    </AccessibilityPreferences>
  );
}

function OrgStatusNotice({ org }: { org: Session["org"] }) {
  const t = useT();
  if (org?.status !== "restricted") return null;
  return (
    <Alert className="rounded-none border-x-0 border-t-0">
      <IconLock />
      <AlertTitle>{t("restricted.title", { org: org.name })}</AlertTitle>
      <AlertDescription>
        {t("restricted.body")}
        {org.statusReason ? ` ${org.statusReason}` : ""}
      </AlertDescription>
    </Alert>
  );
}
