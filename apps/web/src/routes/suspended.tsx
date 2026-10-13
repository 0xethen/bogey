import { createFileRoute, redirect } from "@tanstack/react-router";
import { suspensionQueryOptions } from "@bogey/db/tenant";
import { Screen } from "@bogey/ui/components/screen";
import { BrandMark } from "#/components/brand-mark.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/suspended")({
  staticData: { title: msg("suspended.title") },
  beforeLoad: async ({ context }) => {
    const suspension = await context.query.ensureQueryData(suspensionQueryOptions());
    if (!suspension) throw redirect({ to: "/", replace: true });
  },
  loader: ({ context }) => context.query.ensureQueryData(suspensionQueryOptions()),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const suspension = Route.useLoaderData();
  return (
    <Screen.Auth
      mark={<BrandMark />}
      title={t("suspended.heading", { name: suspension?.name ?? t("suspended.thisOrg") })}
      description={
        suspension?.reason
          ? t("suspended.reason", { reason: suspension.reason })
          : t("suspended.off")
      }
    >
      <p className="text-center text-sm text-muted-fg">{t("suspended.mistake")}</p>
    </Screen.Auth>
  );
}
