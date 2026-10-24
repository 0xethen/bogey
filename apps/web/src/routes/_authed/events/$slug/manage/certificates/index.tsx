import { useCallback, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  certificateDesignsQueryOptions,
  eventCertificatesQueryOptions,
  issueCertificatesFn,
  revokeCertificateFn,
  type Certificate,
} from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  CERTIFICATE_VARIABLES,
  type CertificateKind,
} from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { DataTable, dataColumns, type DataTableFilter } from "@bogey/ui/components/data-table";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { IconCertificate } from "@tabler/icons-react";
import { Panel } from "@bogey/ui/components/panel";
import { Screen } from "@bogey/ui/components/screen";
import { toast } from "@bogey/ui/components/toast";
import { CertificatePrintPage, CertificateSheet } from "#/components/event/certificate-sheet.tsx";
import { useCertificateSample } from "#/components/event/certificate/certificate-sample.ts";
import { DesignCards } from "#/components/event/certificate/design-cards.tsx";
import {
  CertificateSetupDialog,
  certificateKindName,
  SetupList,
} from "#/components/event/certificate/certificate-setup.tsx";
import { givenKinds, unsetKinds } from "#/components/event/certificate/certificate-status.ts";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";
import { msg, sayOr, useT } from "#/lib/translate.tsx";
import { PluginSettingSections } from "#/components/settings/sections/plugin-sections.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/certificates/")({
  staticData: {
    title: msg("certificates.title"),
    settings: (t) => [
      searchSection(t("certificates.title"), {
        id: "certificates",
        keywords: ["award", "participation", "print"],
      }),
      searchSection(t("manageCerts.designs"), {
        id: "designs",
        keywords: ["template", "wording", "logo", "signature", "background"],
      }),
      ...searchSettings("certificates", ["enabled"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      prefetchSettingFields(context.query, { scope: "event", eventId: context.event.id }, [
        "certificates",
      ]),
      context.query.ensureQueryData(
        certificateDesignsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }),
      ),
      context.query.ensureQueryData(eventCertificatesQueryOptions(context.event.id)),
      context.query.ensureQueryData(
        settingsQueryOptions({ eventId: context.event.id }, ["certificates"]),
      ),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const column = dataColumns<Certificate>();

function Issued({
  certificates,
  eventId,
}: {
  certificates: readonly Certificate[];
  eventId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: async (code: string) => unwrap(await revokeCertificateFn({ data: code })),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["certificates", "event", eventId] }),
  });
  const rows = useMemo(() => [...certificates], [certificates]);
  const kindName = useCallback(
    (kind: CertificateKind) => sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind]),
    [t],
  );
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", { header: t("checkin.name"), enableHiding: false }),
        column.accessor((certificate) => kindName(certificate.kind), {
          id: "kind",
          header: t("manageCerts.kindColumn"),
        }),
        column.accessor((certificate) => certificate.label ?? "", {
          id: "label",
          header: t("manageCerts.labelColumn"),
        }),
        column.display({
          id: "withdraw",
          header: () => <span className="sr-only">{t("manageCerts.withdraw")}</span>,
          enableHiding: false,
          cell: (info) => (
            <Button
              size="sm"
              variant="ghost"
              confirm={{
                title: t("manageCerts.withdrawTitle", { name: info.row.original.name }),
                description: t("manageCerts.withdrawBody"),
                label: t("manageCerts.withdrawLabel"),
              }}
              onClick={() => revoke.mutate(info.row.original.code)}
            >
              {t("manageCerts.withdraw")}
            </Button>
          ),
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, kindName],
  );
  const search = useMemo(
    () => ({
      text: (certificate: Certificate) =>
        `${certificate.name} ${kindName(certificate.kind)} ${certificate.label ?? ""}`,
    }),
    [kindName],
  );
  const filters = useMemo(
    (): Tuple<DataTableFilter> => [
      {
        column: "kind",
        title: t("manageCerts.kindColumn"),
        options: CERTIFICATE_KINDS.map((kind) => ({
          value: kindName(kind),
          label: kindName(kind),
        })),
      },
    ],
    [t, kindName],
  );
  return (
    <Panel
      title={t("manageCerts.issued")}
      description={t("manageCerts.soFar", { count: certificates.length })}
    >
      <ErrorAlert error={revoke.error} />
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(certificate) => certificate.code}
        search={search}
        filters={filters}
        pageSize={25}
      />
    </Panel>
  );
}

function RouteComponent() {
  const t = useT();
  const { event, session } = Route.useRouteContext();
  const scope = { scope: "event", eventId: event.id } as const;
  const queryClient = useQueryClient();
  const { data: designs } = useSuspenseQuery(
    certificateDesignsQueryOptions({ orgId: event.org_id, eventId: event.id }),
  );
  const sample = useCertificateSample({
    event: event.name,
    org: session.org?.name ?? "",
    startsAt: event.starts_at,
    endsAt: event.ends_at,
  });
  const { data: issued } = useSuspenseQuery(eventCertificatesQueryOptions(event.id));
  const issue = useMutation({
    mutationFn: async () => unwrap(await issueCertificatesFn({ data: event.id })),
    onSuccess: async (count) => {
      toast.add({
        title: count === 0 ? t("manageCerts.everyoneHas") : t("manageCerts.issuedCount", { count }),
      });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });
  const [printing, setPrinting] = useState(false);
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["certificates"]),
  );
  const { enabled, kinds } = settings.certificates;
  const given = givenKinds(kinds);
  const unset = unsetKinds(designs, kinds);
  const [setup, setSetup] = useState(false);
  return (
    <Screen
      title={t("certificates.title")}
      description={t("manageCerts.intro")}
      width="embedded"
      actions={
        enabled && (
          <>
            <Button
              size="sm"
              variant="outline"
              confirm={{
                title: t("manageCerts.issueTitle"),
                description: t("manageCerts.issueBody"),
                label: t("manageCerts.issueLabel"),
                variant: "default",
              }}
              disabled={issue.isPending}
              onClick={() => issue.mutate()}
            >
              {t("manageCerts.issueAll")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={issued.length === 0}
              tooltip={issued.length === 0 ? t("manageCerts.noneIssued") : undefined}
              onClick={() => {
                setPrinting(true);
                setTimeout(() => {
                  window.print();
                  setPrinting(false);
                }, 100);
              }}
            >
              {t("manageCerts.printAll")}
            </Button>
          </>
        )
      }
    >
      <ErrorAlert error={issue.error} />
      <CertificateSetupDialog
        open={setup}
        onOpenChange={setSetup}
        orgId={event.org_id}
        eventId={event.id}
        slug={event.slug}
        enabled={enabled}
        kinds={kinds}
        designs={designs}
      />
      {enabled ? (
        <>
          <Screen.Section
            id="certificates"
            title={t("certificates.title")}
            actions={
              <Button size="sm" variant="outline" onClick={() => setSetup(true)}>
                {t("certSetup.change")}
              </Button>
            }
          >
            <SettingFields scope={scope} namespace="certificates" keys={["enabled"]} />
            <p className="text-sm text-muted-fg">
              {t("certSetup.given", {
                kinds: given.map((kind) => certificateKindName(t, kind)).join(", "),
              })}
            </p>
          </Screen.Section>
          {unset.length > 0 && (
            <Screen.Section
              id="setup"
              title={t("certSetup.stepsTitle")}
              description={t("certSetup.todo", { count: unset.length })}
            >
              <SetupList
                scope={{ orgId: event.org_id, eventId: event.id }}
                slug={event.slug}
                kinds={unset}
                designs={designs}
              />
            </Screen.Section>
          )}
          <Screen.Section
            id="designs"
            title={t("manageCerts.designs")}
            description={t("manageCerts.designsIntro", {
              variables: Object.keys(CERTIFICATE_VARIABLES)
                .map((name) => `{{${name}}}`)
                .join(", "),
            })}
          >
            <DesignCards
              level="event"
              kinds={given}
              designs={designs}
              sample={sample}
              edit={(kind) => (
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link
                      to="/events/$slug/manage/certificates/$kind"
                      params={{ slug: event.slug, kind }}
                    />
                  }
                  nativeButton={false}
                >
                  {t("manageCerts.edit")}
                </Button>
              )}
            />
          </Screen.Section>
        </>
      ) : (
        <Empty id="certificates" className="jump-target">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconCertificate />
            </EmptyMedia>
            <EmptyTitle>{t("certSetup.offTitle")}</EmptyTitle>
            <EmptyDescription>{t("certSetup.offBody")}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setSetup(true)}>{t("certSetup.turnOn")}</Button>
          </EmptyContent>
        </Empty>
      )}
      {issued.length > 0 && <Issued certificates={issued} eventId={event.id} />}
      {printing && (
        <div data-print-area className="hidden print:block">
          <CertificatePrintPage
            orientations={issued.map((certificate) => certificate.orientation)}
          />
          {issued.map((certificate) => (
            <CertificateSheet key={certificate.code} certificate={certificate} />
          ))}
        </div>
      )}
      <PluginSettingSections page="certificates" />
    </Screen>
  );
}
