import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  orgLimitsQueryOptions,
  setOrgLimitsFn,
  setOrgStatusFn,
  type InstanceOrg,
  type OrgLimit,
  type OrgLimitKey,
  type OrgStatus,
} from "@bogey/db/queries/instance";
import { requestFailure } from "@bogey/db/errors";
import { installedPlugins, pluginLimits } from "@bogey/plugins";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldGroup } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Spinner } from "@bogey/ui/components/spinner";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

export const orgStatusDialog = createDialogHandle<InstanceOrg>();
export const orgLimitsDialog = createDialogHandle<InstanceOrg>();

const statusOptions = (t: T): Tuple<{ value: OrgStatus; label: string; description: string }> => [
  { value: "active", label: t("orgStatus.active"), description: t("orgStatus.activeHelp") },
  {
    value: "restricted",
    label: t("adminOrgs.restricted"),
    description: t("orgStatus.restrictedHelp"),
  },
  {
    value: "suspended",
    label: t("suspended.title"),
    description: t("orgStatus.suspendedHelp"),
  },
];

const statusSchema = (t: T) =>
  z.object({
    status: z.enum(["active", "restricted", "suspended"]).meta({ label: t("adminOrgs.status") }),
    reason: z
      .string()
      .trim()
      .max(500, t("form.maxLength", { max: 500 }))
      .meta({ label: t("orgStatus.reason") })
      .describe(t("orgStatus.reasonHelp")),
  });

function StatusForm({ org }: { org: InstanceOrg }) {
  const t = useT();
  const schema = useMemo(() => statusSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { status: org.status, reason: org.statusReason ?? "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const result = await setOrgStatusFn({
        data: { orgId: org.id, status: value.status, reason: value.reason },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      orgStatusDialog.close();
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="status">
            {(field) => (
              <field.Field>
                <field.Label className="sr-only" />
                <FieldSelect field={field} options={statusOptions(t)} />
              </field.Field>
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.status !== "active"}>
            {(restricted) =>
              restricted && (
                <form.Field name="reason">{(field) => <field.TextAreaField rows={3} />}</form.Field>
              )
            }
          </form.Subscribe>
          <form.FormAlert title={t("orgStatus.failed")} />
          <form.Submit pending={t("common.saving")}>{t("orgStatus.save")}</form.Submit>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}

export function OrgStatusDialog() {
  const t = useT();
  return (
    <Dialog handle={orgStatusDialog}>
      {({ payload }) => (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("orgStatus.title", { org: payload?.name ?? t("orgStatus.organization") })}
            </DialogTitle>
            <DialogDescription>{t("orgStatus.intro")}</DialogDescription>
          </DialogHeader>
          {payload && <StatusForm key={payload.id} org={payload} />}
        </DialogContent>
      )}
    </Dialog>
  );
}

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

function LimitsForm({ org, limits }: { org: InstanceOrg; limits: Tuple<OrgLimit> }) {
  const t = useT();
  const schema = useMemo(() => limitsSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        limits: limits.map((limit) => ({ key: limit.key, ...startingDraft(limit) })),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const overrides: Record<string, number | null> = {};
      for (const draft of value.limits) {
        if (draft.mode === "none") overrides[draft.key] = null;
        if (draft.mode === "set") overrides[draft.key] = Math.max(0, Math.round(draft.value));
      }
      const result = await setOrgLimitsFn({ data: { orgId: org.id, limits: overrides } }).catch(
        requestFailure,
      );
      if (!result.ok) return createValidationError(result.error.message);
      orgLimitsDialog.close();
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
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
        <form.Submit pending={t("common.saving")}>{t("orgLimit.save")}</form.Submit>
      </form.Form>
    </form.AppForm>
  );
}

function LimitsBody({ org }: { org: InstanceOrg }) {
  const t = useT();
  const { data, error } = useQuery(
    orgLimitsQueryOptions(
      org.id,
      PLUGIN_LIMITS.map((limit) => limit.key),
    ),
  );
  if (error)
    return (
      <ErrorAlert error={error instanceof Error ? error : null} title={t("orgLimit.loadFailed")} />
    );
  if (!data) return <Spinner />;
  return <LimitsForm org={org} limits={data} />;
}

export function OrgLimitsDialog() {
  const t = useT();
  return (
    <Dialog handle={orgLimitsDialog}>
      {({ payload }) => (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("orgLimit.title", { org: payload?.name ?? t("orgStatus.organization") })}
            </DialogTitle>
            <DialogDescription>{t("orgLimit.intro")}</DialogDescription>
          </DialogHeader>
          {payload && <LimitsBody key={payload.id} org={payload} />}
        </DialogContent>
      )}
    </Dialog>
  );
}
