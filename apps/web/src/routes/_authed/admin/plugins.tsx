import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { IconPuzzle } from "@tabler/icons-react";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { requestFailure } from "@bogey/db/errors";
import {
  isBundledPlugin,
  PLUGIN_API,
  pluginRepositoryUrl,
  pluginStatuses,
  type PluginManifest,
  type PluginStatus,
} from "@bogey/plugins";
import { pluginUpdatesQueryOptions } from "@bogey/plugins/update-check";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldGroup } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { Spinner } from "@bogey/ui/components/spinner";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import {
  pluginAdds,
  pluginMeta,
  pluginUses,
} from "#/components/settings/sections/plugin-facts.tsx";
import { pluginInstanceLimitsQueryOptions, savePluginInstanceLimitsFn } from "#/lib/plugins.ts";
import { msg, useT, type PlainKey, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/plugins")({
  staticData: { title: msg("accountNav.plugins") },
  component: RouteComponent,
});

const STATUS: Record<
  PluginStatus,
  { label: PlainKey; variant: "secondary" | "outline" | "destructive" }
> = {
  on: { label: "adminExt.installed", variant: "secondary" },
  disabled: { label: "adminExt.turnedOff", variant: "outline" },
  incompatible: { label: "adminExt.incompatible", variant: "destructive" },
};

function RouteComponent() {
  const t = useT();
  const plugins = pluginStatuses();
  const updates = useQuery(pluginUpdatesQueryOptions());
  const update = (key: string) => updates.data?.find((item) => item.key === key);

  return (
    <Screen
      title={t("accountNav.plugins")}
      description={t("adminExt.intro", { api: PLUGIN_API })}
      actions={
        plugins.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={updates.isFetching}
            onClick={() => void updates.refetch()}
          >
            {updates.isFetching && <Spinner />}
            {t("adminExt.check")}
          </Button>
        )
      }
    >
      <ErrorAlert
        error={updates.error instanceof Error ? updates.error : null}
        title={t("adminExt.checkFailed")}
      />
      {plugins.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconPuzzle />
            </EmptyMedia>
            <EmptyTitle>{t("adminExt.noneTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("adminExt.none")}{" "}
              <code>
                vpr bogey plugins add
                github:&lt;owner&gt;/&lt;repo&gt;/&lt;plugin&gt;@&lt;version&gt;
              </code>
              {t("adminExt.noneOr")} <code>vpr bogey plugins new &lt;key&gt;</code>.{" "}
              <a
                href="https://github.com/0xethen/bogey/wiki/plugins"
                target="_blank"
                rel="noreferrer noopener"
                className="link"
              >
                {t("adminExt.noneLink")}
              </a>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <RowList>
          {plugins.map(({ manifest, status, detail }) => {
            const repository = pluginRepositoryUrl(manifest);
            const check = update(manifest.key);
            return (
              <DisclosureRow
                key={manifest.key}
                title={manifest.name}
                meta={pluginMeta(manifest, t)}
                actions={
                  <>
                    {check?.state === "outdated" && (
                      <Badge variant="outline">
                        {t("adminExt.available", { version: check.latest ?? "" })}
                      </Badge>
                    )}
                    <Badge variant={STATUS[status].variant}>
                      {status === "on" && isBundledPlugin(manifest.key)
                        ? t("adminExt.bundled")
                        : t(STATUS[status].label)}
                    </Badge>
                  </>
                }
              >
                <div className="flex flex-col gap-2 text-sm">
                  <p>{manifest.description}</p>
                  <p className="text-muted-fg">{pluginAdds(manifest, t)}</p>
                  {pluginUses(manifest, t).map((line) => (
                    <p key={line} className="text-muted-fg">
                      {line}
                    </p>
                  ))}
                  {detail && <p className="text-muted-fg">{detail}</p>}
                  {status === "on" && Object.keys(manifest.limits ?? {}).length > 0 && (
                    <InstanceLimits manifest={manifest} />
                  )}
                  {check?.state === "unknown" && (
                    <p className="text-muted-fg">
                      {t("adminExt.checkFailedDetail", { detail: check.detail ?? "" })}
                    </p>
                  )}
                  {check?.state === "current" && (
                    <p className="text-muted-fg">{t("adminExt.upToDate")}</p>
                  )}
                  <p className="text-muted-fg">
                    {t("adminExt.key")} <code>{manifest.key}</code> · {t("adminExt.api")}{" "}
                    {manifest.api}
                    {repository && (
                      <>
                        {" · "}
                        <a
                          href={check?.url ?? repository}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="link"
                        >
                          {t("adminExt.source")}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </DisclosureRow>
            );
          })}
        </RowList>
      )}
    </Screen>
  );
}

function InstanceLimits({ manifest }: { manifest: PluginManifest }) {
  const queryClient = useQueryClient();
  const stored = useQuery(pluginInstanceLimitsQueryOptions(manifest.key));
  if (!stored.data) return <Spinner />;
  return (
    <LimitFields
      key={stored.dataUpdatedAt}
      manifest={manifest}
      stored={stored.data}
      onSaved={() => queryClient.invalidateQueries({ queryKey: ["instance"] })}
    />
  );
}

const limitsSchema = (t: T) =>
  z.object({
    limits: z.record(z.string(), z.number().min(0, t("adminExt.useZero"))),
  });

function LimitFields({
  manifest,
  stored,
  onSaved,
}: {
  manifest: PluginManifest;
  stored: Record<string, number>;
  onSaved: () => Promise<unknown>;
}) {
  const t = useT();
  const schema = useMemo(() => limitsSchema(t), [t]);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: {
        limits: Object.fromEntries(
          Object.keys(manifest.limits ?? {}).map((name) => [name, stored[name] ?? 0]),
        ),
      },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const limits = Object.fromEntries(
        Object.entries(value.limits).map(([name, limit]) => [name, limit > 0 ? limit : null]),
      );
      const result = await savePluginInstanceLimitsFn({
        data: { key: manifest.key, limits },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError(result.error.message);
      await onSaved();
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form unsaved="save" className="flex flex-col gap-3 border-t border-border pt-3">
        <p className="font-medium">{t("adminExt.limits")}</p>
        <FieldGroup>
          {Object.entries(manifest.limits ?? {}).map(([name, limit]) => (
            <form.Field key={name} name={`limits.${name}`}>
              {(field) => (
                <field.NumberField
                  label={`${limit.label}${limit.unit ? ` (${limit.unit})` : ""}`}
                  description={limit.description}
                  min={0}
                  emptyLabel={t("settingFields.noLimit")}
                />
              )}
            </form.Field>
          ))}
        </FieldGroup>
        <form.FormAlert title={t("adminExt.limitsFailed")} />
      </form.Form>
    </form.AppForm>
  );
}
