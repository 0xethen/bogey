import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { authProvidersQueryOptions } from "@bogey/db/queries/sign-in";
import { ownSettingsQueryOptions, type OwnScope } from "@bogey/db/queries/settings";
import { SIGN_IN_PROVIDERS, type SignInProvider } from "@bogey/config/sign-in";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { CheckboxGroup } from "@bogey/ui/components/checkbox-group";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldDescription } from "@bogey/ui/components/field";
import { useSettingsMutation } from "#/lib/settings.ts";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import { searchSection } from "../layout/search-entries.ts";
import { useT, type T } from "#/lib/translate.tsx";

export const signInSearch = (t: T) =>
  searchSection(t("signInMethods.title"), {
    keywords: ["oauth", "login", ...SIGN_IN_PROVIDERS.map((provider) => provider.label)],
    id: "sign-in-methods",
  });

const same = (a: Tuple<SignInProvider>, b: Tuple<SignInProvider>) =>
  a.length === b.length && a.every((key) => b.includes(key));

export function SignInMethods({
  scope,
  allowed,
}: {
  scope: OwnScope;
  allowed?: Tuple<SignInProvider>;
}) {
  const t = useT();
  const { data: own } = useSuspenseQuery(ownSettingsQueryOptions(scope, "signin"));
  const { data: on } = useQuery(authProvidersQueryOptions());
  const change = useSettingsMutation(scope, "signin");
  const choices = SIGN_IN_PROVIDERS.filter(
    (provider) => !allowed || allowed.includes(provider.key),
  );
  const saved = own.providers ?? (allowed ? [...allowed] : []);
  const [value, setValue] = useDraft<Tuple<SignInProvider>>(
    saved,
    async (next) => {
      try {
        const inherit = allowed && same(next, allowed);
        await change.mutateAsync({ providers: inherit ? null : [...next] });
        return true;
      } catch {
        return false;
      }
    },
    same,
  );

  return (
    <div className="flex flex-col gap-3">
      <CheckboxGroup
        value={[...value]}
        onValueChange={(next) =>
          setValue(SIGN_IN_PROVIDERS.map((p) => p.key).filter((key) => next.includes(key)))
        }
      >
        {choices.map((provider) => (
          <label key={provider.key} className="flex items-start gap-3">
            <Checkbox value={provider.key} className="mt-1" />
            <span className="flex flex-col">
              <span>{provider.label}</span>
              {on && !on.includes(provider.key) && (
                <span className="text-sm text-muted-fg">{t("signInMethods.notOn")}</span>
              )}
            </span>
          </label>
        ))}
      </CheckboxGroup>
      {!choices.length && <FieldDescription>{t("signInMethods.none")}</FieldDescription>}
      <FieldDescription>
        {allowed ? t("signInMethods.helpOrg") : t("signInMethods.helpInstance")}
      </FieldDescription>
      <ErrorAlert error={change.error} title={t("signInMethods.saveFailed")} />
    </div>
  );
}
