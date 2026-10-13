import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { IconPassword } from "@tabler/icons-react";
import { BrandMark } from "#/components/brand-mark.tsx";
import { msg, useT } from "#/lib/translate.tsx";

const searchSchema = z.object({
  email: z.string().optional().catch(undefined),
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_unauthed/auth/sent")({
  staticData: { title: msg("sent.title") },
  validateSearch: searchSchema,
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { email, redirect } = Route.useSearch();

  return (
    <Screen.Auth
      mark={<BrandMark />}
      title={t("sent.title")}
      description={
        <>
          {t("sent.emailed")} {email ? <strong>{email}</strong> : t("sent.you")}. {t("sent.open")}
        </>
      }
      footer={
        <Link to="/auth/login" search={{ redirect }} className="link">
          {t("otp.differentEmail")}
        </Link>
      }
    >
      <div className="flex flex-col gap-3 rounded-2xl bg-muted/50 p-4 text-center text-sm">
        <p>{t("sent.otherDevice")}</p>
        {/* <p className="text-muted-fg">
          The same email has a six-digit code!
        </p> */}
        <Button
          variant="outline"
          nativeButton={false}
          render={
            <Link
              to="/auth/otp"
              search={{ email, redirect }}
              mask={{ to: "/auth/otp", search: { redirect } }}
            />
          }
        >
          <IconPassword />
          {t("sent.enterCode")}
        </Button>
      </div>
    </Screen.Auth>
  );
}
