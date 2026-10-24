import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { orgQueryOptions } from "@bogey/db/tenant";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { sendSignInLinkFn, stashRedirect, type SendLinkResult } from "@bogey/db/auth";
import { signInProvidersQueryOptions, signInProviderUrlFn } from "@bogey/db/queries/sign-in";
import { providerLabel, type SignInProvider } from "@bogey/config/sign-in";
import { requestFailure } from "@bogey/db/errors";
import type { MessageKey } from "@bogey/config/messages";
import { useT } from "#/lib/translate.tsx";
import { brand } from "@bogey/config";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "@bogey/ui/components/code-block";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldGroup, FieldSeparator } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import {
  IconAlertCircle,
  IconBrandAzure,
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandGitlab,
  IconBrandGoogle,
  IconBuildingCommunity,
  IconKey,
  IconLock,
  type Icon,
} from "@tabler/icons-react";
import { BrandMark } from "#/components/brand-mark.tsx";
import { useAuthCaptcha } from "#/components/plugins/auth-captcha.tsx";

const searchSchema = z.object({
  error: z.literal("auth").optional().catch(undefined),
  redirect: z.string().optional().catch(undefined),
  invite: z
    .string()
    .regex(/^[0-9a-f]{24}$/)
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute("/_unauthed/auth/login")({
  staticData: { title: "Sign in" },
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const org = await context.query.query({ ...orgQueryOptions(), staleTime: "static" });
    if (org) {
      await Promise.all([
        context.query.query({
          ...settingsQueryOptions({ orgId: org.id }, ["registration", "branding"]),
          staleTime: "static",
        }),
        context.query.query({ ...signInProvidersQueryOptions(), staleTime: "static" }),
      ]);
    }
    return { org };
  },
  component: RouteComponent,
});

const emailSchema = z.object({
  email: z
    .email("Enter your email address")
    .meta({ label: "Email", placeholder: "you@example.com" }),
});

const FAILURE_KEYS = {
  unreachable: "auth.failure.unreachable",
  rate_limited: "auth.failure.rateLimited",
  closed: "auth.failure.closed",
  refused: "auth.failure.refused",
  captcha: "auth.failure.captcha",
  unknown: "auth.failure.unknown",
} as const satisfies Record<Exclude<SendLinkResult, { ok: true }>["reason"], MessageKey>;

function RouteComponent() {
  const t = useT();
  const { error, redirect, invite } = Route.useSearch();
  const navigate = useNavigate();
  const { org } = Route.useLoaderData();
  const settings = useQuery({
    ...settingsQueryOptions({ orgId: org?.id }, ["registration", "branding"]),
    enabled: !!org,
  });
  const brandName = org?.name ?? settings.data?.branding.name ?? brand.name;
  const newAccounts = !!org && settings.data?.registration.signup !== "closed";
  const captcha = useAuthCaptcha();

  const form = useAppForm({
    defaultValues: { email: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(emailSchema)],
    onSubmit: async ({ value, createValidationError }) => {
      stashRedirect(redirect);
      const result = await sendSignInLinkFn({
        data: { email: value.email, invite, captchaToken: captcha.token() },
      }).catch(requestFailure);
      captcha.reset();
      if ("reason" in result) {
        return createValidationError(result.message ?? t(FAILURE_KEYS[result.reason]));
      }
      if (!result.ok) return createValidationError(result.error.message);
      await navigate({
        to: "/auth/sent",
        search: { email: value.email, redirect },
        mask: { to: "/auth/sent", search: { redirect } },
      });
      return undefined;
    },
  });

  const providers = useQuery({ ...signInProvidersQueryOptions(), enabled: !!org });
  const [ssoOpen, setSsoOpen] = useState(false);
  const providerSignIn = useMutation({
    mutationFn: async (input: { provider: SignInProvider; email?: string }) => {
      stashRedirect(redirect);
      const captchaToken = input.provider === "sso" ? captcha.token() : undefined;
      const result = await signInProviderUrlFn({ data: { ...input, captchaToken } });
      if (input.provider === "sso") captcha.reset();
      if (!result.ok) throw new Error(result.message);
      window.location.assign(result.url);
    },
  });

  if (!org) return <NotSetUp />;

  return (
    <Screen.Auth
      mark={<BrandMark />}
      title={t("auth.signInTitle", { name: brandName })}
      description={newAccounts ? t("auth.signInNewAccounts") : t("auth.signInExisting")}
    >
      <form.AppForm>
        <form.Form>
          <FieldGroup>
            <form.Field name="email">
              {(field) => <field.TextField type="email" autoComplete="email" />}
            </form.Field>

            {error && (
              <Alert variant="destructive">
                <IconAlertCircle />
                <AlertTitle>{t("auth.linkFailedTitle")}</AlertTitle>
                <AlertDescription>
                  {t("auth.linkFailedBefore")}
                  <Link to="/auth/otp" search={{ redirect }} className="link">
                    {t("auth.linkFailedCode")}
                  </Link>
                  {t("auth.linkFailedAfter")}
                </AlertDescription>
              </Alert>
            )}

            {captcha.widget}

            <Field>
              <form.FormAlert title={t("auth.sendFailedTitle")} />
              <form.Submit pending={`${t("auth.sending")}...`}>{t("auth.emailMeLink")}</form.Submit>
            </Field>

            <p className="text-center text-sm text-muted-fg">
              {t("auth.or")}{" "}
              <Link to="/auth/password" search={{ redirect }} className="link">
                {t("auth.usePassword")}
              </Link>
            </p>
          </FieldGroup>
        </form.Form>
      </form.AppForm>

      <FieldGroup className="mt-6">
        {!!providers.data?.length && (
          <>
            <FieldSeparator>{t("auth.or")}</FieldSeparator>
            <Field>
              {providers.data
                .filter((provider) => provider !== "sso")
                .map((provider) => (
                  <Button
                    key={provider}
                    type="button"
                    variant="outline"
                    disabled={providerSignIn.isPending}
                    onClick={() => providerSignIn.mutate({ provider })}
                  >
                    <ProviderIcon provider={provider} />
                    {t("auth.continueWith", { provider: providerLabel(provider) })}
                  </Button>
                ))}
              {providers.data.includes("sso") &&
                (ssoOpen ? (
                  <SsoForm
                    onSubmit={(email) => providerSignIn.mutate({ provider: "sso", email })}
                  />
                ) : (
                  <Button type="button" variant="outline" onClick={() => setSsoOpen(true)}>
                    <ProviderIcon provider="sso" />
                    {t("auth.sso")}...
                  </Button>
                ))}
              <ErrorAlert error={providerSignIn.error} title={t("auth.providerFailedTitle")} />
            </Field>
          </>
        )}
      </FieldGroup>
    </Screen.Auth>
  );
}

const PROVIDER_ICONS: Record<SignInProvider, Icon> = {
  google: IconBrandGoogle,
  github: IconBrandGithub,
  azure: IconBrandAzure,
  gitlab: IconBrandGitlab,
  discord: IconBrandDiscord,
  keycloak: IconKey,
  sso: IconLock,
};

function ProviderIcon({ provider }: { provider: SignInProvider }) {
  const Glyph = PROVIDER_ICONS[provider];
  return <Glyph />;
}

const ssoSchema = z.object({
  email: z
    .email("Enter your work email address")
    .meta({ label: "Work email", placeholder: "you@company.com" }),
});

function SsoForm({ onSubmit }: { onSubmit: (email: string) => void }) {
  const t = useT();
  const form = useAppForm({
    defaultValues: { email: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(ssoSchema)],
    onSubmit: ({ value }) => onSubmit(value.email),
  });
  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="email">
            {(field) => <field.TextField type="email" autoComplete="email" />}
          </form.Field>
          <form.Submit pending={`${t("auth.opening")}...`}>{t("auth.ssoContinue")}</form.Submit>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}

function NotSetUp() {
  const t = useT();
  return (
    <Screen.Fallback
      icon={<IconBuildingCommunity />}
      title={t("auth.notSetUpTitle")}
      description={t("auth.notSetUpBody")}
    >
      {import.meta.env.DEV && (
        <CodeBlock className="text-left">
          <CodeBlockActions>
            <CodeBlockCopyButton value="vpr bogey setup" />
          </CodeBlockActions>
          <CodeBlockContent>vpr bogey setup</CodeBlockContent>
        </CodeBlock>
      )}
    </Screen.Fallback>
  );
}
