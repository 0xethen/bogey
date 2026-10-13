import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import {
  safeInternalPath,
  sessionQueryKey,
  signInWithPasswordFn,
  type PasswordSignInResult,
} from "@bogey/db/auth";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { BrandMark } from "#/components/brand-mark.tsx";
import { msg, useT, type PlainKey, type T } from "#/lib/translate.tsx";

const searchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_unauthed/auth/password")({
  staticData: { title: msg("passwordSignIn.title") },
  validateSearch: searchSchema,
  component: RouteComponent,
});

const passwordSchema = (t: T) =>
  z.object({
    email: z
      .email(t("otp.needEmail"))
      .meta({ label: t("checkin.email"), placeholder: "admin@example.com" }),
    password: z
      .string()
      .min(1, t("passwordSignIn.needPassword"))
      .meta({ label: t("security.password"), placeholder: "••••••••" }),
  });

const FAILURE = {
  invalid: "passwordSignIn.invalid",
  not_admin: "passwordSignIn.notAdmin",
  unreachable: "auth.failure.unreachable",
  rate_limited: "passwordSignIn.rateLimited",
} as const satisfies Record<Extract<PasswordSignInResult, { ok: false }>["reason"], PlainKey>;

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => passwordSchema(t), [t]);
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, createValidationError }) => {
      const result = await signInWithPasswordFn({ data: value }).catch(
        (): PasswordSignInResult => ({ ok: false, reason: "unreachable" }),
      );
      if (!result.ok) return createValidationError(t(FAILURE[result.reason]));
      queryClient.removeQueries({ queryKey: sessionQueryKey });
      await navigate({ to: safeInternalPath(redirect) ?? "/admin" });
      return undefined;
    },
  });

  return (
    <Screen.Auth
      mark={<BrandMark />}
      title={t("passwordSignIn.title")}
      description={t("passwordSignIn.intro")}
      footer={
        <Link to="/auth/login" search={{ redirect }} className="link">
          {t("passwordSignIn.linkInstead")}
        </Link>
      }
    >
      <form.AppForm>
        <form.Form className="flex flex-col gap-4">
          <form.Field name="email">
            {(field) => <field.TextField type="email" autoComplete="username" />}
          </form.Field>
          <form.Field name="password">
            {(field) => <field.TextField type="password" autoComplete="current-password" />}
          </form.Field>
          <form.FormAlert title={t("passwordSignIn.failed")} />
          <form.Submit pending={t("passwordSignIn.signingIn")}>{t("nav.signIn")}</form.Submit>
        </form.Form>
      </form.AppForm>
    </Screen.Auth>
  );
}
