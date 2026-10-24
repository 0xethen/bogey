import { useMemo } from "react";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  orgLimitsQueryOptions,
  setOrgLimitsFn,
  type InstanceOrg,
  type OrgLimit,
  type OrgLimitKey,
} from "@bogey/db/queries/instance";
import { requestFailure } from "@bogey/db/errors";
import { installedPlugins, pluginLimits } from "@bogey/plugins";
import { OptSelect } from "@bogey/ui/components/opt-select";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

const CORE_LIMIT_LABELS = {
  eventsPerOrg: "orgLimit.events",
  adminsPerOrg: "orgLimit.admins",
  participantsPerEvent: "orgLimit.participants",
  emailsPerDay: "orgLimit.emails",
  storageMbPerOrg: "orgLimit.storage",
  maxUploadMb: "orgLimit.upload",
  customDomainsPerOrg: "orgLimit.hostnames",
  pendingInvitesPerOrg: "orgLimit.invites",
} as const satisfies Record<OrgLimitKey, PlainKey>;

const PLUGIN_LIMITS = pluginLimits(installedPlugins());

export const orgLimitsQuery = (orgId: string) =>
  orgLimitsQueryOptions(
    orgId,
    PLUGIN_LIMITS.map((limit) => limit.key),
  );

function limitLabel(key: string, t: T): string {
  const core = Object.entries(CORE_LIMIT_LABELS).find(([each]) => each === key)?.[1];
  if (core) return t(core);
  const plugin = PLUGIN_LIMITS.find((each) => each.key === key);
  return plugin
    ? `${plugin.pluginName}: ${plugin.label}${plugin.unit ? ` (${plugin.unit})` : ""}`
    : key;
}

type Mode = "instance" | "set" | "none";

const modeOptions = (t: T): Tuple<{ value: Mode; label: string }> => [
  { value: "instance", label: t("orgLimit.instanceDefault") },
  { value: "set", label: t("orgLimit.set") },
  { value: "none", label: t("orgLimit.none") },
];

interface Draft {
  mode: Mode;
  value: number;
}

function startingDraft(limit: OrgLimit): Draft {
  if (!limit.override) return { mode: "instance", value: limit.limit ?? 0 };
  return limit.limit === null ? { mode: "none", value: 0 } : { mode: "set", value: limit.limit };
}

const limitsSchema = (t: T) =>
  z.object({
    limits: z.array(
      z.object({
        key: z.string(),
        mode: z.enum(["instance", "set", "none"]),
        value: z.number(t("orgLimit.enterNumber")).min(0, t("adminExt.useZero")),
      }),
    ),
  });

export function OrgLimits({ org }: { org: InstanceOrg }) {
  const { data: limits } = useSuspenseQuery(orgLimitsQuery(org.id));
  return <LimitsForm key={org.id} org={org} limits={limits} />;
}

function LimitsForm({ org, limits }: { org: InstanceOrg; limits: Tuple<OrgLimit> }) {
  const t = useT();
  const schema = useMemo(() => limitsSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: {
        limits: limits.map((limit) => ({ key: limit.key, ...startingDraft(limit) })),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const overrides: Record<string, number | null> = {};
      for (const draft of value.limits) {
        if (draft.mode === "none") overrides[draft.key] = null;
        if (draft.mode === "set") overrides[draft.key] = Math.max(0, Math.round(draft.value));
      }
      const result = await setOrgLimitsFn({ data: { orgId: org.id, limits: overrides } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      formApi.reset(value);
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-6">
        <ul className="flex flex-col gap-3">
          {limits.map((limit, index) => (
            <li key={limit.key} className="flex flex-wrap items-center gap-2">
              <div className="flex min-w-40 flex-1 flex-col">
                <span className="text-sm font-medium">{limitLabel(limit.key, t)}</span>
                <span className="text-xs text-muted-fg">
                  {t("orgLimit.using", { used: limit.used })}
                </span>
              </div>
              <form.Field name={`limits[${index}].mode`}>
                {(field) => (
                  <OptSelect
                    ariaLabel={t("orgLimit.limitOf", { name: limitLabel(limit.key, t) })}
                    value={field.value}
                    options={modeOptions(t)}
                    size="sm"
                    onChange={(mode) => field.handleChange(mode)}
                  />
                )}
              </form.Field>
              <form.Subscribe selector={(state) => state.values.limits[index]?.mode === "set"}>
                {(setting) =>
                  setting && (
                    <form.Field name={`limits[${index}].value`}>
                      {(field) => <field.NumberInput min={0} />}
                    </form.Field>
                  )
                }
              </form.Subscribe>
            </li>
          ))}
        </ul>
        <form.FormAlert title={t("adminExt.limitsFailed")} />
      </form.Form>
    </form.AppForm>
  );
}
