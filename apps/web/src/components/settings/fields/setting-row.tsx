import type { ReactNode } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { IconArrowBack, IconLock, IconLockOpen } from "@tabler/icons-react";
import { Button } from "@bogey/ui/components/button";
import { useT } from "#/lib/translate.tsx";

export interface SettingLock {
  locked: boolean;
  below: string;
  onChange: (locked: boolean) => void;
}

export type SettingSource =
  | { kind: "own"; onReset: () => void }
  | { kind: "inherited"; from?: string }
  | { kind: "locked"; by: string }
  | { kind: "operator"; path?: string | null };

function Label({
  id,
  label,
  keyName,
  source,
  lock,
}: {
  id: string;
  label: string;
  keyName?: string;
  source: SettingSource;
  lock?: SettingLock;
}) {
  const t = useT();
  const lockLabel = lock
    ? lock.locked
      ? t("settingRow.unlockFor", { below: lock.below })
      : t("settingRow.lockFor", { below: lock.below })
    : "";
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={id} title={keyName}>
        {label}
      </FieldLabel>
      {source.kind === "own" && (
        <Button
          type="button"
          variant="ghost"
          size="icon-3xs"
          aria-label={t("settingRow.reset")}
          tooltip={t("settingRow.reset")}
          onClick={source.onReset}
        >
          <IconArrowBack />
        </Button>
      )}
      <div className="flex items-center gap-0.5">
        {lock && (
          <Button
            type="button"
            variant="ghost"
            size="icon-2xs"
            aria-pressed={lock.locked}
            aria-label={lockLabel}
            tooltip={lockLabel}
            className={
              lock.locked
                ? "text-fg"
                : "text-muted-fg transition-opacity md:opacity-0 md:group-hover/setting:opacity-100 md:group-focus-within/setting:opacity-100"
            }
            onClick={() => lock.onChange(!lock.locked)}
          >
            {lock.locked ? <IconLock /> : <IconLockOpen />}
          </Button>
        )}
        {lock?.locked && <span className="text-xs text-muted-fg">{t("settingRow.locked")}</span>}
      </div>
    </div>
  );
}

function Origin({ source }: { source: SettingSource }) {
  const t = useT();
  if (source.kind === "locked") {
    return <p className="text-xs text-muted-fg">{t("settingRow.lockedBy", { by: source.by })}</p>;
  }
  if (source.kind === "operator") {
    return (
      <p className="text-xs text-muted-fg">
        {source.path ? t("settingRow.operatorAt", { path: source.path }) : t("settingRow.operator")}
      </p>
    );
  }
  if (source.kind === "inherited" && source.from) {
    return <p className="text-xs text-muted-fg">{t("settingRow.from", { from: source.from })}</p>;
  }
  return null;
}

export function SettingRow({
  id,
  anchor,
  keyName,
  label,
  description,
  source,
  inline = false,
  row = false,
  lock,
  children,
}: {
  id: string;
  anchor?: string;
  keyName?: string;
  label: string;
  description?: ReactNode;
  source: SettingSource;
  inline?: boolean;
  // short controls: label left, control right on wide screens
  row?: boolean;
  lock?: SettingLock;
  children: ReactNode;
}) {
  if (inline) {
    return (
      <Field
        id={anchor}
        orientation="horizontal"
        className="group/setting jump-target justify-between"
      >
        <FieldContent>
          <Label id={id} label={label} keyName={keyName} source={source} lock={lock} />
          {description && <FieldDescription>{description}</FieldDescription>}
          <Origin source={source} />
        </FieldContent>
        {children}
      </Field>
    );
  }
  if (row) {
    return (
      <Field
        id={anchor}
        className="group/setting jump-target md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:items-start md:gap-x-6 md:gap-y-1"
      >
        <div className="flex flex-col gap-1 md:col-start-1 md:row-start-1">
          <Label id={id} label={label} keyName={keyName} source={source} lock={lock} />
          {description && <FieldDescription>{description}</FieldDescription>}
          <Origin source={source} />
        </div>
        <div className="md:col-start-2 md:row-start-1">{children}</div>
      </Field>
    );
  }
  return (
    <Field id={anchor} className="group/setting jump-target">
      <Label id={id} label={label} keyName={keyName} source={source} lock={lock} />
      {children}
      <div className="flex flex-col gap-1">
        {description && <FieldDescription>{description}</FieldDescription>}
        <Origin source={source} />
      </div>
    </Field>
  );
}
