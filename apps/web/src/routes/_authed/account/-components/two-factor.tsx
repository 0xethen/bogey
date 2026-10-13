import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthenticatorAssuranceLevels, Factor } from "@supabase/supabase-js";
import { IconShieldCheck } from "@tabler/icons-react";
import { browserClient } from "@bogey/db/browser";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { OTPField, OTPFieldGroup, OTPFieldInput } from "@bogey/ui/components/otp-field";
import { Screen } from "@bogey/ui/components/screen";
import { Spinner } from "@bogey/ui/components/spinner";
import { useSessionRefresh } from "#/lib/refresh.ts";
import { Link } from "@tanstack/react-router";
import { useT } from "#/lib/translate.tsx";

interface MfaState {
  verified: Tuple<Factor>;
  current: AuthenticatorAssuranceLevels | null;
  next: AuthenticatorAssuranceLevels | null;
}

const mfaKey = ["account", "mfa"] as const;

async function loadState(): Promise<MfaState> {
  const mfa = browserClient().auth.mfa;
  const [factors, level] = await Promise.all([
    mfa.listFactors(),
    mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (factors.error) throw factors.error;
  if (level.error) throw level.error;
  return {
    verified: factors.data.totp,
    current: level.data.currentLevel,
    next: level.data.nextLevel,
  };
}

function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id} className="sr-only">
        {t("twoFactor.codeLabel")}
      </FieldLabel>
      <OTPField
        id={id}
        length={6}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        onValueComplete={onComplete}
      >
        <OTPFieldGroup>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <OTPFieldInput
              key={index}
              aria-label={
                index === 0 ? undefined : t("twoFactor.digit", { n: index + 1, total: 6 })
              }
            />
          ))}
        </OTPFieldGroup>
      </OTPField>
    </Field>
  );
}

interface Enrolment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function TwoFactorSection({ forAdmin }: { forAdmin?: boolean }) {
  const t = useT();
  const refreshSession = useSessionRefresh();
  const state = useQuery({ queryKey: mfaKey, queryFn: loadState, retry: false });
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState("");

  const finish = async () => {
    setEnrolment(null);
    setCode("");
    await state.refetch();
    await refreshSession();
  };

  const start = useMutation({
    mutationFn: async () => {
      const mfa = browserClient().auth.mfa;
      const all = await mfa.listFactors();
      for (const factor of all.data?.all ?? []) {
        if (factor.factor_type === "totp" && factor.status === "unverified") {
          await mfa.unenroll({ factorId: factor.id });
        }
      }
      const result = await mfa.enroll({
        factorType: "totp",
        friendlyName: t("twoFactor.factorName"),
      });
      if (result.error) throw result.error;
      return {
        factorId: result.data.id,
        qrCode: result.data.totp.qr_code,
        secret: result.data.totp.secret,
      };
    },
    onSuccess: setEnrolment,
  });

  const verify = useMutation({
    mutationFn: async (factorId: string) => {
      const result = await browserClient().auth.mfa.challengeAndVerify({ factorId, code });
      if (result.error) throw result.error;
    },
    onSuccess: finish,
    onError: () => setCode(""),
  });

  const remove = useMutation({
    mutationFn: async (factorId: string) => {
      const result = await browserClient().auth.mfa.unenroll({ factorId });
      if (result.error) throw result.error;
    },
    onSuccess: finish,
  });

  const factor = state.data?.verified[0];
  const needsCode = factor && state.data?.current !== "aal2";

  return (
    <Screen.Section
      id="two-factor-sign-in"
      title={t("security.twoFactor")}
      description={t("twoFactor.intro")}
    >
      {forAdmin && !factor && (
        <Alert>
          <IconShieldCheck />
          <AlertTitle>{t("twoFactor.adminNeedsTitle")}</AlertTitle>
          <AlertDescription>{t("twoFactor.adminNeedsBody")}</AlertDescription>
        </Alert>
      )}
      {forAdmin && needsCode && (
        <Alert>
          <IconShieldCheck />
          <AlertTitle>{t("twoFactor.adminCodeTitle")}</AlertTitle>
          <AlertDescription>{t("twoFactor.adminCodeBody")}</AlertDescription>
        </Alert>
      )}
      {state.isPending ? (
        <span className="flex items-center gap-2">
          <Spinner /> <span className="text-muted-fg text-sm">{t("twoFactor.checking")}</span>
        </span>
      ) : state.isError ? (
        <ErrorAlert error={t("twoFactor.checkFailed")} title={t("common.wentWrong")} />
      ) : enrolment ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("twoFactor.scan")}</p>
          <img
            src={enrolment.qrCode}
            alt={t("twoFactor.qrAlt")}
            className="size-44 rounded-xl bg-white p-2"
          />
          <p className="text-sm text-muted-fg">
            {t("twoFactor.cantScan")} <code className="select-all">{enrolment.secret}</code>
          </p>
          <CodeInput
            value={code}
            onChange={setCode}
            disabled={verify.isPending}
            onComplete={() => verify.mutate(enrolment.factorId)}
          />
          <ErrorAlert
            error={verify.error ? t("twoFactor.wrongCode") : null}
            title={t("twoFactor.verifyFailed")}
          />
          <div>
            <Button
              variant="ghost"
              size="sm"
              disabled={verify.isPending}
              onClick={() => {
                setEnrolment(null);
                setCode("");
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : needsCode ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t("twoFactor.enterCode")}</p>
          <CodeInput
            value={code}
            onChange={setCode}
            disabled={verify.isPending}
            onComplete={() => verify.mutate(factor.id)}
          />
          <ErrorAlert
            error={verify.error ? t("twoFactor.wrongCode") : null}
            title={t("twoFactor.verifyFailed")}
          />
        </div>
      ) : factor ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {t("twoFactor.isSetUp")}{" "}
            {forAdmin && (
              <Link to="/admin" className="link">
                {t("twoFactor.manageInstance")}
              </Link>
            )}
          </p>
          <div>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              confirm={{
                title: t("twoFactor.removeTitle"),
                description: t("twoFactor.removeBody"),
                label: t("twoFactor.remove"),
              }}
              onClick={() => remove.mutate(factor.id)}
            >
              {t("twoFactor.removeButton")}
            </Button>
          </div>
          <ErrorAlert
            error={remove.error ? t("twoFactor.removeFailed") : null}
            title={t("common.wentWrong")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <Button variant="secondary" disabled={start.isPending} onClick={() => start.mutate()}>
              {start.isPending && <Spinner />}
              {t("twoFactor.setUp")}
            </Button>
          </div>
          <ErrorAlert
            error={start.error ? t("twoFactor.startFailed") : null}
            title={t("common.wentWrong")}
          />
        </div>
      )}
    </Screen.Section>
  );
}
