import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ACTION_GROUPS, actionLabel } from "@bogey/db/audit";
import { installedPlugins, pluginActionLabel } from "@bogey/plugins";
import { auditLogQueryOptions, type AuditEntry, type AuditFilter } from "@bogey/db/queries/audit";
import { eventsQueryOptions } from "@bogey/db/queries/events";
import { orgMembersQueryOptions } from "@bogey/db/queries/org";
import type { Json } from "@bogey/db/types";
import { formatDateTime, type FormatOptions } from "@bogey/utils/time";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { Button } from "@bogey/ui/components/button";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { DateRangePicker } from "@bogey/ui/components/date-range-picker";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { cn } from "@bogey/ui/lib/utils";
import { SearchSelect } from "@bogey/ui/components/search-select";
import { Spinner } from "@bogey/ui/components/spinner";
import { sayOr, useT, type T } from "#/lib/translate.tsx";
import { Link } from "@tanstack/react-router";

export const auditSearchSchema = z.object({
  group: z.string().optional().catch(undefined),
  event: z.string().optional().catch(undefined),
  actor: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
});

const groupOptions = (t: T) => [
  { value: "", label: t("audit.everything") },
  ...ACTION_GROUPS.map((group) => ({
    value: group.prefix,
    label: sayOr(t, `auditGroup.${group.prefix}`, group.label),
  })),
  ...installedPlugins()
    .filter((plugin) => plugin.actions?.length)
    .map((plugin) => ({ value: plugin.key, label: plugin.name })),
];

const NO_ENTRIES: AuditEntry[] = [];

export function AuditLog({
  orgId,
  eventId,
  filter,
  onFilterChange,
}: {
  orgId: string;
  eventId?: string;
  filter: AuditFilter;
  onFilterChange: (filter: AuditFilter) => void;
}) {
  const t = useT();
  const time = useTimeFormat();
  const scoped = eventId ? { ...filter, event: eventId } : filter;
  const log = useInfiniteQuery(auditLogQueryOptions(orgId, scoped));
  const events = useQuery({ ...eventsQueryOptions(orgId), enabled: !eventId });
  const members = useQuery(orgMembersQueryOptions(orgId));
  const entries = useMemo(
    () => log.data?.pages.flatMap((page) => page.entries) ?? NO_ENTRIES,
    [log.data],
  );
  const columns = useMemo(() => auditColumns(time, t, !eventId), [time, t, eventId]);
  const search = useMemo(
    () => ({
      text: (entry: AuditEntry) =>
        [
          entry.actorName ?? t("audit.bogey"),
          actionText(entry, t),
          entry.targetName,
          entry.event?.name,
          describe(entry, t),
        ].join(" "),
    }),
    [t],
  );
  const set = (patch: AuditFilter) => onFilterChange({ ...filter, ...patch });

  return (
    <div className="flex flex-col gap-6">
      <div
        className={cn("grid gap-3 sm:grid-cols-2", eventId ? "lg:grid-cols-3" : "lg:grid-cols-4")}
      >
        <Field>
          <FieldLabel htmlFor="audit-group">{t("audit.what")}</FieldLabel>
          <OptSelect
            id="audit-group"
            value={filter.group ?? ""}
            options={groupOptions(t)}
            onChange={(group) => set({ group: group || undefined })}
          />
        </Field>
        {!eventId && (
          <Field>
            <FieldLabel htmlFor="audit-event">{t("webhooks.event")}</FieldLabel>
            <SearchSelect
              id="audit-event"
              value={filter.event}
              placeholder={t("audit.allEvents")}
              options={(events.data ?? []).map((event) => ({ value: event.id, label: event.name }))}
              onValueChange={(event) => set({ event })}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="audit-actor">{t("audit.who")}</FieldLabel>
          <SearchSelect
            id="audit-actor"
            placeholder={t("audit.anyone")}
            options={(members.data ?? []).map((member) => ({
              value: member.userId,
              label: member.name,
            }))}
            value={filter.actor}
            onValueChange={(actor) => set({ actor })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="audit-dates">{t("audit.date")}</FieldLabel>
          <DateRangePicker
            id="audit-dates"
            value={{ from: filter.from, to: filter.to }}
            onChange={(range) => set({ from: range.from, to: range.to })}
          />
        </Field>
      </div>

      <ErrorAlert
        error={log.error instanceof Error ? log.error : null}
        title={t("audit.loadFailed")}
      />
      {log.isPending ? (
        <Spinner />
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          getRowId={(entry) => String(entry.id)}
          search={search}
          pageSize={25}
          empty={t("audit.empty")}
        />
      )}
      {log.hasNextPage && (
        <div>
          <Button
            variant="outline"
            disabled={log.isFetchingNextPage}
            onClick={() => void log.fetchNextPage()}
          >
            {log.isFetchingNextPage && <Spinner />}
            {t("audit.older")}
          </Button>
        </div>
      )}
    </div>
  );
}

const column = dataColumns<AuditEntry>();

function auditColumns(time: FormatOptions, t: T, withEvent: boolean) {
  return column.columns([
    column.accessor("at", {
      header: t("audit.date"),
      cell: (info) => (
        <time dateTime={info.getValue()} className="whitespace-nowrap text-muted-fg tabular-nums">
          {formatDateTime(info.getValue(), time)}
        </time>
      ),
    }),
    column.accessor((entry) => entry.actorName ?? t("audit.bogey"), {
      id: "who",
      header: t("audit.admin"),
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    column.accessor((entry) => actionText(entry, t), {
      id: "what",
      header: t("audit.action"),
      cell: (info) => {
        const entry = info.row.original;
        return (
          <span>
            {info.getValue()}
            {entry.targetName && <span className="font-medium"> {entry.targetName}</span>}
          </span>
        );
      },
    }),
    ...(withEvent ? [eventColumn(t)] : []),
    column.display({
      id: "details",
      header: t("audit.details"),
      cell: (info) => (
        <span className="wrap-break-word text-muted-fg">{describe(info.row.original, t)}</span>
      ),
    }),
  ]);
}

function actionText(entry: AuditEntry, t: T): string {
  return sayOr(
    t,
    `auditAction.${entry.action}`,
    pluginActionLabel(installedPlugins(), entry.action) ?? actionLabel(entry.action),
  );
}

function eventColumn(t: T) {
  return column.accessor((entry) => entry.event?.name ?? "", {
    id: "event",
    header: t("webhooks.event"),
    cell: (info) => {
      const value = info.getValue();

      return value ? (
        <Link
          to="/events/$slug/manage"
          params={{ slug: info.row.original.event!.slug! }}
          className="link text-muted-fg decoration-muted-fg"
        >
          {value}
        </Link>
      ) : (
        <span className="text-muted-fg">{t("audit.org")}</span>
      );
    },
  });
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isId(value: Json | undefined): boolean {
  return typeof value === "string" && ID.test(value);
}

function fieldName(key: string): string {
  return key.replace(/_md$/, "").replace(/_/g, " ");
}

function show(value: Json | undefined, t: T): string {
  if (value === null || value === undefined) return t("audit.nothing");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function describe(entry: AuditEntry, t: T): string | null {
  const { meta } = entry;
  const changes = meta.changes;
  if (
    entry.action === "event.updated" &&
    changes &&
    typeof changes === "object" &&
    !Array.isArray(changes)
  ) {
    const fields = Array.isArray(meta.fields) ? meta.fields.map(String) : [];
    const shown = Object.entries(changes).map(([key, change]) => {
      const pair = change && typeof change === "object" && !Array.isArray(change) ? change : {};
      return `${fieldName(key)}: ${show(pair.from, t)} → ${show(pair.to, t)}`;
    });
    const rest = fields.filter((field) => !(field in changes)).map(fieldName);
    return [
      ...shown,
      ...(rest.length ? [t("audit.aswell", { fields: rest.join(", ") })] : []),
    ].join("; ");
  }
  if (entry.action === "settings.changed") {
    const keys = Array.isArray(meta.keys) ? meta.keys.map(String) : [];
    return `${show(meta.namespace, t)}: ${keys.join(", ") || t("audit.locks")}`;
  }
  if ("from" in meta && "to" in meta) return `${show(meta.from, t)} → ${show(meta.to, t)}`;
  const parts = Object.entries(meta)
    .filter(([, value]) => value !== null && typeof value !== "object" && !isId(value))
    .map(([key, value]) => `${fieldName(key)}: ${show(value, t)}`);
  return parts.length ? parts.join(", ") : null;
}
