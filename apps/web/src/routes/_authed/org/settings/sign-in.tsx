import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";
import { signInSearch, SignInMethods } from "#/components/settings/sections/sign-in-methods.tsx";

export const Route = createFileRoute("/_authed/org/settings/sign-in")({
  staticData: { title: msg("signInMethods.title"), settings: (t) => [signInSearch(t)] },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({
        ...ownSettingsQueryOptions({ scope: "instance" }, "signin"),
        staleTime: "static",
      }),
      context.query.query({
        ...ownSettingsQueryOptions({ scope: "org", orgId: context.org.id }, "signin"),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const { data: instance } = useSuspenseQuery(
    ownSettingsQueryOptions({ scope: "instance" }, "signin"),
  );
  return (
    <Screen
      title={t("signInMethods.title")}
      description={t("signInMethods.orgIntro")}
      width="embedded"
    >
      {instance.providers?.length ? (
        <SignInMethods scope={{ scope: "org", orgId: org.id }} allowed={instance.providers} />
      ) : (
        <p className="text-sm text-muted-fg">{t("signInMethods.instanceNone")}</p>
      )}
    </Screen>
  );
}
