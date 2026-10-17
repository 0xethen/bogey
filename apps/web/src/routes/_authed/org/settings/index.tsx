import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { z } from "zod";
import { renameOrgFn } from "@bogey/db/queries/org";
import { sessionQueryKey } from "@bogey/db/auth";
import { orgQueryKey } from "@bogey/db/tenant";
import { requestFailure } from "@bogey/db/errors";
import { Screen } from "@bogey/ui/components/screen";
import { errorVisibility, rewardEarlyPunishLate, useAppForm } from "@bogey/ui/lib/form";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import {
  searchFields,
  searchSection,
  searchSettings,
} from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

const orgNameSchema = (t: T) =>
  z.object({
    name: z
      .string()
      .trim()
      .min(1, t("orgSettings.needName"))
      .max(120, t("form.maxLength", { max: 120 }))
      .meta({ label: t("orgSettings.orgName") }),
  });

export const Route = createFileRoute("/_authed/org/settings/")({
  staticData: {
    title: msg("orgSettings.general"),
    settings: (t) => [
      searchSection(t("orgSettings.name"), { id: "name" }),
      ...searchFields(orgNameSchema(t), "org", t("orgSettings.name")),
      searchSection(t("accounts.section"), { id: "accounts" }),
      ...searchSettings("registration", ["signup"], t),
      searchSection(t("orgTab.audit"), { id: "audit-log" }),
      ...searchSettings("audit", ["retentionDays"], t),
    ],
  },
  loader: ({ context }) =>
    prefetchSettingFields(context.query, { scope: "org", orgId: context.org.id }, [
      "registration",
      "audit",
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const scope = { scope: "org", orgId: org.id } as const;
  return (
    <Screen
      title={t("orgSettings.general")}
      description={t("orgSettings.intro", { org: org.name })}
      width="embedded"
    >
      <OrgName />
      <Screen.Section id="accounts" title={t("accounts.section")}>
        <SettingFields scope={scope} namespace="registration" keys={["signup"]} />
      </Screen.Section>
      <Screen.Section id="audit-log" title={t("orgTab.audit")}>
        <SettingFields scope={scope} namespace="audit" keys={["retentionDays"]} />
      </Screen.Section>
    </Screen>
  );
}

function OrgName() {
  const t = useT();
  const schema = useMemo(() => orgNameSchema(t), [t]);
  const { org } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useAppForm({
    defaultValues: { name: org.name },
    errorVisibility,
    validators: [rewardEarlyPunishLate(schema)],
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await renameOrgFn({ data: { orgId: org.id, name: value.name } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionQueryKey }),
        queryClient.invalidateQueries({ queryKey: orgQueryKey }),
      ]);
      await router.invalidate();
      return undefined;
    },
  });

  return (
    <Screen.Section id="name" title={t("orgSettings.name")}>
      <form.AppForm>
        <form.Form unsaved="save" anchor="org" className="flex flex-col gap-3">
          <form.Field name="name">
            {(field) => (
              <field.Field>
                <field.Label className="sr-only" />
                <field.TextInput maxLength={120} />
                <field.Error />
              </field.Field>
            )}
          </form.Field>
          <form.FormAlert title={t("orgSettings.renameFailed")} />
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}
