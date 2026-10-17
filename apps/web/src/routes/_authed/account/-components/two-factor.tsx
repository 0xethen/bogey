import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { AuthenticatorAssuranceLevels, Factor } from "@supabase/supabase-js";
import { IconDeviceMobile, IconFingerprint, IconShieldCheck } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { browserClient } from "@bogey/db/browser";
import { getPublicEnv } from "@bogey/db/env";
import { resolveSettings } from "@bogey/config/settings";
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
  apps: Tuple<Factor>;
  passkeys: Tuple<Factor>;
  /** How many passkeys one person can add (security.maxPasskeys in bogey.config.ts). */
  maxPasskeys: number;
  current: AuthenticatorAssuranceLevels | null;
  next: AuthenticatorAssuranceLevels | null;
}

const mfaKey = ["account", "mfa"] as const;

async function loadState(): Promise<MfaState> {
  const supabase = browserClient();
  const mfa = supabase.auth.mfa;
  const [factors, level, settings] = await Promise.all([
    mfa.listFactors(),
    mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc("settings_for", { p_namespaces: ["accounts"] }),
  ]);
  if (factors.error) throw factors.error;
  if (level.error) throw level.error;
  if (settings.error) throw settings.error;
  const accounts =
    settings.data && typeof settings.data === "object" && !Array.isArray(settings.data)
      ? settings.data.accounts
      : undefined;
  return {
    apps: factors.data.totp,
    passkeys: factors.data.webauthn,
    maxPasskeys: resolveSettings("accounts", accounts).maxPasskeys,
    current: level.data.currentLevel,
    next: level.data.nextLevel,
  };
}

// the passkey host when this browser can use passkeys here, or null
function passkeyHost(): string | null {
  if (typeof window === "undefined" || !window.PublicKeyCredential) return null;
  const host = getPublicEnv().passkeyHost;
  if (!host) return null;
  const here = window.location.hostname;
  return here === host || here.endsWith(`.${host}`) ? host : null;
}

function webauthnFor(host: string) {
  return { rpId: host, rpOrigins: [window.location.origin] };
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

  const host = passkeyHost();

  const addPasskey = useMutation({
    mutationFn: async () => {
      if (!host) throw new Error("passkeys aren't available here");
      const mfa = browserClient().auth.mfa;
      const all = await mfa.listFactors();
      for (const factor of all.data?.all ?? []) {
        if (factor.factor_type === "webauthn" && factor.status === "unverified") {
          await mfa.unenroll({ factorId: factor.id });
        }
      }
      const result = await mfa.webauthn.register({
        friendlyName: `${t("twoFactor.passkey")} ${new Date().toLocaleString()}`,
        webauthn: webauthnFor(host),
      });
      if (result.error) throw result.error;
    },
    onSuccess: finish,
  });

  const verifyPasskey = useMutation({
    mutationFn: async (factorId: string) => {
      if (!host) throw new Error("passkeys aren't available here");
      const result = await browserClient().auth.mfa.webauthn.authenticate({
        factorId,
        webauthn: webauthnFor(host),
      });
      if (result.error) throw result.error;
    },
    onSuccess: finish,
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

  const app = state.data?.apps[0];
  const passkeys = state.data?.passkeys ?? [];
  const maxPasskeys = state.data?.maxPasskeys ?? 0;
  const usable = host ? passkeys : [];
  const any = app ?? passkeys[0];
  const needsCode = any && state.data?.current !== "aal2";

  return (
    <Screen.Section
      id="two-factor-sign-in"
      title={t("security.twoFactor")}
      description={t("twoFactor.intro")}
    >
      {forAdmin && !any && (
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
          {app && (
            <>
              <p className="text-sm">{t("twoFactor.enterCode")}</p>
              <CodeInput
                value={code}
                onChange={setCode}
                disabled={verify.isPending}
                onComplete={() => verify.mutate(app.id)}
              />
              <ErrorAlert
                error={verify.error ? t("twoFactor.wrongCode") : null}
                title={t("twoFactor.verifyFailed")}
              />
            </>
          )}
          {usable.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {usable.map((passkey) => (
                <Button
                  key={passkey.id}
                  variant={app ? "outline" : "secondary"}
                  disabled={verifyPasskey.isPending}
                  onClick={() => verifyPasskey.mutate(passkey.id)}
                >
                  <IconFingerprint />
                  {usable.length > 1
                    ? t("twoFactor.useNamed", { name: passkey.friendly_name ?? "" })
                    : t("twoFactor.usePasskey")}
                </Button>
              ))}
            </div>
          )}
          {!app && usable.length === 0 && (
            <p className="text-sm text-muted-fg">{t("twoFactor.passkeyElsewhere")}</p>
          )}
          <ErrorAlert
            error={verifyPasskey.error ? t("twoFactor.passkeyFailed") : null}
            title={t("twoFactor.verifyFailed")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {any && forAdmin && (
            <p className="text-sm">
              <Link to="/admin" className="link">
                {t("twoFactor.manageInstance")}
              </Link>
            </p>
          )}
          <FactorRow
            icon={<IconDeviceMobile />}
            name={t("twoFactor.factorName")}
            status={app ? t("twoFactor.isSetUp") : t("twoFactor.notSetUp")}
          >
            {app ? (
              <RemoveButton
                pending={remove.isPending}
                title={t("twoFactor.removeTitle")}
                last={!passkeys.length}
                onRemove={() => remove.mutate(app.id)}
              />
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending && <Spinner />}
                {t("twoFactor.setUp")}
              </Button>
            )}
          </FactorRow>
          {(maxPasskeys > 0 || passkeys.length > 0) && (
            <FactorRow
              icon={<IconFingerprint />}
              name={t("twoFactor.passkeys")}
              status={
                passkeys.length
                  ? t("twoFactor.passkeyCount", { count: passkeys.length, max: maxPasskeys })
                  : t("twoFactor.notSetUp")
              }
            >
              {host && passkeys.length < maxPasskeys && (
                <Button
                  size="sm"
                  variant={passkeys.length ? "outline" : "secondary"}
                  disabled={addPasskey.isPending}
                  onClick={() => addPasskey.mutate()}
                >
                  {addPasskey.isPending && <Spinner />}
                  {passkeys.length ? t("twoFactor.addAnotherPasskey") : t("twoFactor.addPasskey")}
                </Button>
              )}
            </FactorRow>
          )}
          {passkeys.length > 0 && (
            <div className="ms-8 flex flex-col gap-3">
              {passkeys.map((passkey) => (
                <FactorRow
                  key={passkey.id}
                  name={passkey.friendly_name || t("twoFactor.passkey")}
                  status={t("twoFactor.passkeyAdded")}
                >
                  <RemoveButton
                    pending={remove.isPending}
                    title={t("twoFactor.removePasskeyTitle")}
                    last={!app && passkeys.length === 1}
                    onRemove={() => remove.mutate(passkey.id)}
                  />
                </FactorRow>
              ))}
            </div>
          )}
          <ErrorAlert
            error={start.error ? t("twoFactor.startFailed") : null}
            title={t("common.wentWrong")}
          />
          <ErrorAlert
            error={addPasskey.error ? t("twoFactor.passkeyAddFailed") : null}
            title={t("common.wentWrong")}
          />
          <ErrorAlert
            error={remove.error ? t("twoFactor.removeFailed") : null}
            title={t("common.wentWrong")}
          />
        </div>
      )}
    </Screen.Section>
  );
}

function FactorRow({
  icon,
  name,
  status,
  children,
}: {
  icon?: ReactNode;
  name: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {icon && <span className="text-muted-fg [&_svg]:size-5">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-xs text-muted-fg">{status}</span>
      </div>
      {children}
    </div>
  );
}

function RemoveButton({
  pending,
  title,
  last,
  onRemove,
}: {
  pending: boolean;
  title: string;
  last: boolean;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      confirm={{
        title,
        description: last ? t("twoFactor.removeBody") : t("twoFactor.removeOtherStays"),
        label: t("twoFactor.remove"),
      }}
      onClick={onRemove}
    >
      {t("twoFactor.removeButton")}
    </Button>
  );
}
