import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { safeInternalPath, sessionQueryKey, verifyEmailOtpFn } from "@bogey/db/auth";
import { OTPField, OTPFieldGroup, OTPFieldInput } from "@bogey/ui/components/otp-field";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import { BrandMark } from "#/components/brand-mark.tsx";
import { msg, useT, type T } from "#/lib/translate.tsx";

const searchSchema = z.object({
  email: z.string().optional().catch(undefined),
  redirect: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_unauthed/auth/otp")({
  staticData: { title: msg("otp.title") },
  validateSearch: searchSchema,
  component: RouteComponent,
});

const codeSchema = (t: T) =>
  z.object({
    email: z
      .email(t("otp.needEmail"))
      .meta({ label: t("checkin.email"), placeholder: "you@example.com" }),
    code: z
      .string()
      .regex(/^\d{6}$/, t("otp.sixDigits"))
      .meta({ label: t("otp.code") }),
  });

function RouteComponent() {
  const t = useT();
  const schema = useMemo(() => codeSchema(t), [t]);
  const { email, redirect } = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const knownEmail = email && z.email().safeParse(email).success ? email : null;

  const form = useAppForm({
    defaultValues: { email: knownEmail ?? "", code: "" },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, createValidationError }) => {
      const result = await verifyEmailOtpFn({
        data: { email: value.email, token: value.code },
      });

      if (!result.ok) {
        return createValidationError(
          result.retryable ? t("auth.failure.unreachable") : t("otp.wrong"),
        );
      }

      queryClient.removeQueries({ queryKey: sessionQueryKey });
      await navigate({ to: safeInternalPath(redirect) ?? "/" });
      return undefined;
    },
  });

  return (
    <Screen.Auth
      mark={<BrandMark />}
      title={t("otp.title")}
      description={
        knownEmail ? (
          <>
            {t("otp.sentTo")} <strong>{knownEmail}</strong>.
          </>
        ) : (
          t("otp.inEmail")
        )
      }
      footer={
        <Link to="/auth/login" search={{ redirect }} className="link">
          {knownEmail ? t("otp.differentEmail") : t("otp.newLink")}
        </Link>
      }
    >
      <form.AppForm>
        <form.Form className="flex flex-col gap-4">
          {!knownEmail && (
            <form.Field name="email">
              {(field) => <field.TextField type="email" autoComplete="email" />}
            </form.Field>
          )}

          <form.Field name="code">
            {(field) => (
              <field.Field className="items-center">
                <field.Label className="sr-only" />
                <OTPField
                  id={field.name}
                  length={6}
                  className="justify-center"
                  value={field.value}
                  onValueChange={(value) => field.handleChange(value)}
                  onValueComplete={() => void form.handleSubmit()}
                >
                  <OTPFieldGroup onBlur={field.handleBlur}>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <OTPFieldInput
                        key={index}
                        autoFocus={index === 0 && !!knownEmail}
                        aria-invalid={field.meta.isInvalid || undefined}
                        aria-label={
                          index === 0 ? undefined : t("twoFactor.digit", { n: index + 1, total: 6 })
                        }
                      />
                    ))}
                  </OTPFieldGroup>
                </OTPField>
                <field.Error className="text-center" />
              </field.Field>
            )}
          </form.Field>

          <form.FormAlert title={t("auth.providerFailedTitle")} />
          <form.Submit pending={`${t("otp.checking")}...`}>{t("nav.signIn")}</form.Submit>
        </form.Form>
      </form.AppForm>
    </Screen.Auth>
  );
}
