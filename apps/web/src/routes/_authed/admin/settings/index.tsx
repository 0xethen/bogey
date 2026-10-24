import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { brand } from "@bogey/config";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { instanceOrgsQueryOptions } from "@bogey/db/queries/instance";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { useSettingsMutation } from "#/lib/settings.ts";
import { useDraft } from "#/components/unsaved-changes/index.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

const INSTANCE = { scope: "instance" } as const;

export const Route = createFileRoute("/_authed/admin/settings/")({
  staticData: {
    title: msg("orgSettings.general"),
    settings: (t) => [
      searchSection(t("adminSettings.identity"), { keywords: ["brand", "name"], id: "identity" }),
      ...searchSettings("branding", ["name", "shortName", "fallbackMessage"], t),
      searchSection(t("adminSettings.defaultOrg"), {
        keywords: ["hostname", "localhost", "domain"],
        id: "default-organization",
      }),
      searchSection(t("orgTab.audit"), { id: "audit-log" }),
      ...searchSettings("audit", ["retentionDays"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.query({ ...instanceOrgsQueryOptions(), staleTime: "static" }),
      context.query.query({ ...ownSettingsQueryOptions(INSTANCE, "tenancy"), staleTime: "static" }),
      prefetchSettingFields(context.query, INSTANCE, ["branding", "audit"]),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { data: tenancy } = useSuspenseQuery(ownSettingsQueryOptions(INSTANCE, "tenancy"));
  return (
    <Screen
      title={t("orgSettings.general")}
      description={t("adminSettings.intro")}
      width="embedded"
    >
      <Screen.Section
        id="identity"
        title={t("adminSettings.identity")}
        description={t("adminSettings.identityHelp")}
      >
        <SettingFields
          scope={INSTANCE}
          namespace="branding"
          keys={["name", "shortName", "fallbackMessage"]}
          placeholders={{ name: brand.name, shortName: brand.shortName ?? brand.name }}
        />
      </Screen.Section>
      <DefaultOrg current={tenancy.defaultOrg} />
      <Screen.Section id="audit-log" title={t("orgTab.audit")}>
        <SettingFields scope={INSTANCE} namespace="audit" keys={["retentionDays"]} />
      </Screen.Section>
    </Screen>
  );
}

const NONE = "none";

function DefaultOrg({ current }: { current: string | undefined }) {
  const t = useT();
  const { data: orgs } = useSuspenseQuery(instanceOrgsQueryOptions());
  const change = useSettingsMutation(INSTANCE, "tenancy");
  const [value, setValue] = useDraft(
    current && orgs.some((org) => org.id === current) ? current : NONE,
    async (orgId) => {
      try {
        await change.mutateAsync({ defaultOrg: orgId === NONE ? null : orgId });
        return true;
      } catch {
        return false;
      }
    },
  );

  return (
    <Screen.Section
      id="default-organization"
      title={t("adminSettings.defaultOrg")}
      description={t("adminSettings.defaultOrgHelp")}
    >
      <Field>
        <FieldLabel htmlFor="default-org" className="sr-only">
          {t("adminSettings.defaultOrg")}
        </FieldLabel>
        <OptSelect
          id="default-org"
          value={value}
          options={[
            {
              value: NONE,
              label: t("adminSettings.none"),
              description: t("adminSettings.noneHelp"),
            },
            ...orgs.map((org) => ({ value: org.id, label: org.name })),
          ]}
          onChange={setValue}
        />
        <FieldDescription>{t("adminSettings.nextLoad")}</FieldDescription>
      </Field>
      <ErrorAlert error={change.error} title={t("adminSettings.defaultOrgFailed")} />
    </Screen.Section>
  );
}
