import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { signOut } from "@bogey/db/auth";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/auth/logout")({
  preload: false,
  staticData: { title: msg("logout.title"), command: false },
  beforeLoad: async ({ context, location }) => {
    if ((location.state.__TSR_index ?? 0) === 0) return { confirm: true };

    await signOut(context.query);

    throw Route.redirect({
      to: "/auth/login",
      search: { error: undefined, redirect: undefined },
      replace: true,
    });
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const signOutMutation = useMutation({
    mutationFn: () => signOut(queryClient),
    onSuccess: () =>
      navigate({
        to: "/auth/login",
        search: { error: undefined, redirect: undefined },
        replace: true,
      }),
  });

  return (
    <Screen.Auth
      title={t("signOut.title")}
      description={
        <>
          {session.user.email
            ? t("logout.signedInAs", { email: session.user.email })
            : t("logout.signedIn")}{" "}
          {t("logout.needNew")}
        </>
      }
    >
      <ErrorAlert error={signOutMutation.error} title={t("logout.failed")} />
      <div className="flex flex-col gap-2">
        <Button onClick={() => signOutMutation.mutate()} disabled={signOutMutation.isPending}>
          {signOutMutation.isPending ? t("logout.signingOut") : t("signOut.confirm")}
        </Button>
        <Button
          variant="outline"
          disabled={signOutMutation.isPending}
          render={<Route.Link to="/" />}
          nativeButton={false}
        >
          {t("logout.stay")}
        </Button>
      </div>
    </Screen.Auth>
  );
}
