import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  addOrgDomainFn,
  instanceOrgsQueryOptions,
  removeOrgDomainFn,
  type InstanceOrg,
} from "@bogey/db/queries/instance";
import { OrgStatusDialog, orgStatusDialog } from "./-components/org-status.tsx";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { formatDate, type FormatOptions } from "@bogey/utils/time";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@bogey/ui/components/context-menu";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Row, RowList } from "@bogey/ui/components/row";
import { DataTable, dataColumns, type DataTableFilter } from "@bogey/ui/components/data-table";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@bogey/ui/components/dialog";
import { Facts } from "@bogey/ui/components/facts";
import { FieldGroup } from "@bogey/ui/components/field";
import { Screen } from "@bogey/ui/components/screen";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { hostnameSchema } from "./-components/hostname.ts";
import { IconExternalLink, IconPlus, IconTrash } from "@tabler/icons-react";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/orgs/")({
  staticData: { title: msg("adminTab.orgs") },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(instanceOrgsQueryOptions()),
      context.query.ensureQueryData(ownSettingsQueryOptions(INSTANCE, "limits")),
    ]),
  component: RouteComponent,
});

const INSTANCE = { scope: "instance" } as const;

const hostnamesDialog = createDialogHandle<InstanceOrg>();

function siteUrl(hostname: string): string {
  return `${/(^|\.)localhost(:\d+)?$/.test(hostname) ? "http" : "https"}://${hostname}`;
}

function ofLimit(count: number, limit: number | undefined, t: T): string {
  return limit === undefined ? String(count) : t("adminOrgs.ofLimit", { count, limit });
}

const column = dataColumns<InstanceOrg>();

const search = {
  text: (org: InstanceOrg) => `${org.name} ${org.slug} ${org.hostnames.join(" ")}`,
};

function orgColumns(t: T, time: FormatOptions) {
  return column.columns([
    column.accessor("name", {
      header: t("orgSettings.name"),
      enableHiding: false,
      cell: (info) => (
        <span className="flex items-center gap-2 font-medium">
          <NameAvatar name={info.getValue()} />
          {info.getValue()}
          {info.row.original.status !== "active" && (
            <Badge variant="outline">
              {info.row.original.status === "suspended"
                ? t("suspended.title")
                : t("adminOrgs.restricted")}
            </Badge>
          )}
        </span>
      ),
    }),
    column.accessor((org) => org.hostnames[0] ?? org.slug, {
      id: "address",
      header: t("adminOrgs.address"),
      cell: (info) => <span className="text-muted-fg">{info.getValue()}</span>,
    }),
    column.accessor("status", { header: t("adminOrgs.status") }),
    column.accessor("events", { header: t("orgTab.events") }),
    column.accessor("members", { header: t("orgTab.members") }),
    column.accessor("createdAt", {
      header: t("adminOrgs.created"),
      cell: (info) => <span className="text-muted-fg">{formatDate(info.getValue(), time)}</span>,
    }),
  ]);
}

function orgFilters(t: T): Tuple<DataTableFilter> {
  return [
    {
      column: "status",
      title: t("adminOrgs.status"),
      single: { all: t("adminOrgs.allStatuses") },
      options: [
        { value: "active", label: t("orgStatus.active") },
        { value: "restricted", label: t("adminOrgs.restricted") },
        { value: "suspended", label: t("suspended.title") },
      ],
    },
  ];
}

function RouteComponent() {
  const t = useT();
  const { data: orgs } = useSuspenseQuery(instanceOrgsQueryOptions());
  const { data: limits } = useSuspenseQuery(ownSettingsQueryOptions(INSTANCE, "limits"));
  const time = useTimeFormat();
  const columns = useMemo(() => orgColumns(t, time), [t, time]);
  const filters = useMemo(() => orgFilters(t), [t]);
  const detail = useCallback(
    (org: InstanceOrg) => (
      <div className="flex flex-col gap-4 py-2">
        <Facts
          facts={[
            { label: t("adminOrgs.address"), value: <code>{org.slug}</code> },
            {
              label: t("adminOrgs.hostnames"),
              value: org.hostnames.join(", ") || t("adminOrgs.none"),
            },
            {
              label: t("adminOrgs.status"),
              value: org.statusReason ? `${org.status}: ${org.statusReason}` : org.status,
            },
            { label: t("adminOrgs.created"), value: formatDate(org.createdAt, time) },
            {
              label: t("adminOrgs.owners"),
              value: org.owners.join(", ") || t("adminOrgs.none"),
            },
            {
              label: t("adminOrgs.ownersAdmins"),
              value: ofLimit(org.admins, limits.adminsPerOrg, t),
            },
            { label: t("orgTab.events"), value: ofLimit(org.events, limits.eventsPerOrg, t) },
            { label: t("orgTab.members"), value: org.members },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {org.hostnames[0] && <OpenSite hostnames={org.hostnames} />}
          <DialogTrigger
            handle={hostnamesDialog}
            payload={org}
            render={<Button size="sm" variant="outline" />}
          >
            {t("adminOrgs.hostnamesButton")}...
          </DialogTrigger>
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/admin/orgs/$slug/limits" params={{ slug: org.slug }} />}
            nativeButton={false}
          >
            {t("adminOrgs.limits")}
          </Button>
          <DialogTrigger
            handle={orgStatusDialog}
            payload={org}
            render={<Button size="sm" variant="outline" />}
          >
            {org.status === "active"
              ? `${t("adminOrgs.restrictButton")}...`
              : `${t("adminOrgs.statusButton")}...`}
          </DialogTrigger>
        </div>
      </div>
    ),
    [t, time, limits],
  );
  return (
    <Screen
      title={t("adminTab.orgs")}
      description={t("adminOrgs.intro")}
      actions={
        <Button
          size="sm"
          variant="outline"
          render={<Link to="/admin/orgs/new" />}
          nativeButton={false}
        >
          <IconPlus />
          {t("adminOrgs.new")}
        </Button>
      }
    >
      <HostnamesDialog />
      <OrgStatusDialog />
      <DataTable
        columns={columns}
        data={orgs}
        getRowId={(org) => org.id}
        search={search}
        filters={filters}
        detail={detail}
        pageSize={25}
      />
    </Screen>
  );
}

// right-click lists every hostname; a plain click opens the primary one
function OpenSite({ hostnames }: { hostnames: Tuple<string> }) {
  const t = useT();
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<span className="contents" />}>
        <Button
          size="sm"
          variant="outline"
          render={
            <a href={siteUrl(hostnames[0] ?? "")} target="_blank" rel="noreferrer noopener" />
          }
          nativeButton={false}
        >
          <IconExternalLink />
          {t("adminOrgs.openSite")}
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuLabel>{t("adminOrgs.openSiteOn")}</ContextMenuLabel>
          {hostnames.map((hostname) => (
            <ContextMenuItem
              key={hostname}
              onClick={() => window.open(siteUrl(hostname), "_blank", "noopener,noreferrer")}
            >
              <IconExternalLink />
              {hostname}
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HostnamesDialog() {
  const t = useT();
  const { data: orgs } = useSuspenseQuery(instanceOrgsQueryOptions());
  return (
    <Dialog handle={hostnamesDialog}>
      {({ payload }) => {
        // the payload is a snapshot; read the live row so removals show
        const org = orgs.find((each) => each.id === payload?.id) ?? payload;
        const name = org?.name ?? t("adminOrgs.theOrg");
        return (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("adminOrgs.hostnamesTitle", { org: name })}</DialogTitle>
              <DialogDescription>{t("adminOrgs.hostnamesHelp", { org: name })}</DialogDescription>
            </DialogHeader>
            {org && (
              <div className="flex flex-col gap-4">
                <HostnameList org={org} />
                <AddHostnameForm org={org} />
              </div>
            )}
          </DialogContent>
        );
      }}
    </Dialog>
  );
}

function HostnameList({ org }: { org: InstanceOrg }) {
  const t = useT();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async (hostname: string) =>
      unwrap(await removeOrgDomainFn({ data: { orgId: org.id, hostname } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance"] }),
  });
  if (org.hostnames.length === 0) return null;
  return (
    <>
      <ErrorAlert error={remove.error} title={t("adminOrgs.removeHostnameFailed")} />
      <RowList variant="boxed" render={<ul />}>
        {org.hostnames.map((hostname, index) => (
          <Row
            key={hostname}
            render={<li />}
            size="sm"
            title={
              <>
                <code>{hostname}</code>
                {index === 0 && <Badge variant="secondary">{t("adminOrgs.primary")}</Badge>}
              </>
            }
            actions={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("adminOrgs.removeHostnameOf", { hostname })}
                disabled={remove.isPending}
                confirm={{
                  title: t("adminOrgs.removeHostnameTitle", { hostname }),
                  description: [
                    t("adminOrgs.removeHostnameBody", { org: org.name }),
                    typeof window !== "undefined" && window.location.host === hostname
                      ? t("adminOrgs.removeHostnameHere")
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                  label: t("adminOrgs.removeHostname"),
                }}
                onClick={() => remove.mutate(hostname)}
              >
                <IconTrash />
              </Button>
            }
          />
        ))}
      </RowList>
    </>
  );
}

const addHostnameSchema = (t: T) =>
  z.object({
    hostname: hostnameSchema(t).meta({
      label: t("adminOrgs.hostname"),
      placeholder: "hack.example.org",
    }),
  });

function AddHostnameForm({ org }: { org: InstanceOrg }) {
  const t = useT();
  const schema = useMemo(() => addHostnameSchema(t), [t]);
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { hostname: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const result = await addOrgDomainFn({
        data: { orgId: org.id, hostname: value.hostname },
      }).catch(requestFailure);
      if (!result.ok) return createValidationError({ fields: { hostname: result.error.message } });
      formApi.reset();
      await queryClient.invalidateQueries({ queryKey: ["instance"] });
      return undefined;
    },
  });
  return (
    <form.AppForm>
      <form.Form>
        <FieldGroup>
          <form.Field name="hostname">{(field) => <field.TextField required />}</form.Field>
          <form.Submit pending={`${t("webhooks.adding")}...`}>
            {t("adminOrgs.addHostnameButton")}
          </form.Submit>
        </FieldGroup>
      </form.Form>
    </form.AppForm>
  );
}
