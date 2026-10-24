import { usePreference } from "@bogey/db/queries/preferences";
import type { NotificationChannels } from "@bogey/db/queries/notifications";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_KEYS,
  type NotificationKind,
} from "@bogey/config/notifications";
import { installedPlugins, pluginNotificationKinds } from "@bogey/plugins";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { FieldFrame, FieldLabel } from "@bogey/ui/components/field";
import { RowList } from "@bogey/ui/components/row";
import { Switch } from "@bogey/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";
import { sayOr, useT, type T } from "#/lib/translate.tsx";

function isChannels(raw: unknown): raw is NotificationChannels {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

interface KindInfo {
  key: string;
  label: string;
  description?: string;
  defaults: { inApp: boolean; email: boolean };
  transactional: boolean;
}

function KindRow({
  row,
  channels,
  onChange,
}: {
  row: KindInfo;
  channels: NotificationChannels;
  onChange: (channels: NotificationChannels) => void;
}) {
  const t = useT();
  const own = channels[row.key];
  const inApp = own?.inApp ?? row.defaults.inApp;
  const email = row.transactional || (own?.email ?? row.defaults.email);
  const set = (channel: "inApp" | "email", value: boolean) =>
    onChange({ ...channels, [row.key]: { ...own, [channel]: value } });
  return (
    <li className="py-3">
      <FieldFrame
        layout="row"
        label={<FieldLabel>{row.label}</FieldLabel>}
        description={row.description}
      >
        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={inApp} onCheckedChange={(checked) => set("inApp", checked)} />
            {t("notifications.bell")}
          </label>
          <Tooltip>
            <TooltipTrigger
              disabled={!row.transactional}
              render={<label className="flex items-center gap-2 text-sm" />}
            >
              <Switch
                checked={email}
                disabled={row.transactional}
                onCheckedChange={(checked) => set("email", checked)}
              />
              {t("notifications.email")}
            </TooltipTrigger>
            {row.transactional && (
              <TooltipContent>{t("notifications.emailRequired")}</TooltipContent>
            )}
          </Tooltip>
        </div>
      </FieldFrame>
    </li>
  );
}

function coreRow(key: (typeof NOTIFICATION_KIND_KEYS)[number], t: T): KindInfo & { group: string } {
  const kind: NotificationKind = NOTIFICATION_KINDS[key];
  return {
    key,
    label: sayOr(t, `notif.${key}`, kind.label),
    description: sayOr(t, `notif.${key}.help`, kind.description),
    defaults: kind.channels,
    transactional: kind.transactional,
    group: kind.group,
  };
}

export function NotificationSettings() {
  const t = useT();
  const preference = usePreference<NotificationChannels>(
    "notifications",
    "channels",
    {},
    isChannels,
  );
  const plugins = pluginNotificationKinds(installedPlugins());
  const core = NOTIFICATION_KIND_KEYS.map((key) => coreRow(key, t));

  return (
    <div className="flex flex-col gap-4">
      {NOTIFICATION_GROUPS.map((group) => {
        const rows = core.filter((row) => row.group === group);
        return rows.length === 0 ? null : (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="text-sm font-medium text-muted-fg">
              {sayOr(t, `notifGroup.${group}`, group)}
            </h3>
            <RowList variant="flush" render={<ul />}>
              {rows.map((row) => (
                <KindRow
                  key={row.key}
                  row={row}
                  channels={preference.value}
                  onChange={preference.set}
                />
              ))}
            </RowList>
          </div>
        );
      })}
      {plugins.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-muted-fg">{t("accountNav.plugins")}</h3>
          <RowList variant="flush" render={<ul />}>
            {plugins.map((plugin) => (
              <KindRow
                key={plugin.key}
                row={{
                  key: plugin.key,
                  label: plugin.label,
                  defaults: { inApp: true, email: plugin.email },
                  transactional: false,
                }}
                channels={preference.value}
                onChange={preference.set}
              />
            ))}
          </RowList>
        </div>
      )}
      <ErrorAlert
        error={preference.error instanceof Error ? preference.error : null}
        title={t("notifications.saveFailed")}
      />
    </div>
  );
}
