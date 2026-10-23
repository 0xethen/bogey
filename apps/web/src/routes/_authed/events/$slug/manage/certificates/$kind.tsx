import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  certificateDesignsQueryOptions,
  copyCertificateDesignFn,
  saveCertificateDesignFn,
} from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_LABELS,
  defaultCertificateLayout,
  isCertificateKind,
} from "@bogey/utils/certificate";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { toast } from "@bogey/ui/components/toast";
import { CertificateEditor } from "#/components/event/certificate/certificate-editor.tsx";
import { CertificatePage } from "#/components/event/certificate/certificate-page.tsx";
import { useCertificateSample } from "#/components/event/certificate/certificate-sample.ts";
import { msg, sayOr, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/certificates/$kind")({
  staticData: { title: msg("certDesign.title"), command: false },
  beforeLoad: ({ params }) => {
    if (!isCertificateKind(params.kind)) throw notFound();
    return { kind: params.kind };
  },
  loader: ({ context }) =>
    context.query.ensureQueryData(
      certificateDesignsQueryOptions({ orgId: context.event.org_id, eventId: context.event.id }),
    ),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

function RouteComponent() {
  const t = useT();
  const { event, session, kind } = Route.useRouteContext();
  const scope = { orgId: event.org_id, eventId: event.id };
  const queryClient = useQueryClient();
  const { data: designs } = useSuspenseQuery(certificateDesignsQueryOptions(scope));
  const own = designs.own.find((design) => design.kind === kind);
  const org = designs.org.find((design) => design.kind === kind);
  const kindName = sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind]);
  const sample = useCertificateSample({
    event: event.name,
    org: session.org?.name ?? "",
    startsAt: event.starts_at,
    endsAt: event.ends_at,
  });

  const copy = useMutation({
    mutationFn: async () =>
      unwrap(await copyCertificateDesignFn({ data: { eventId: event.id, kind } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["certificates"] }),
  });
  const goBack = useMutation({
    mutationFn: async () =>
      unwrap(
        await saveCertificateDesignFn({
          data: { ...scope, kind, layout: null, orientation: "landscape" },
        }),
      ),
    onSuccess: async () => {
      toast.add({ title: org ? t("manageCerts.backToOrg") : t("manageCerts.backToStandard") });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });

  return (
    <Screen
      title={t("certDesign.heading", { kind: kindName })}
      description={t("certDesign.intro")}
      width="embedded"
      actions={
        own && (
          <Button
            size="sm"
            variant="outline"
            disabled={goBack.isPending}
            confirm={{
              title: org ? t("manageCerts.useOrgTitle") : t("manageCerts.useStandardTitle"),
              description: t("manageCerts.goBackBody"),
              label: t("manageCerts.goBackLabel"),
            }}
            onClick={() => goBack.mutate()}
          >
            {org ? t("manageCerts.useOrg") : t("manageCerts.useStandard")}
          </Button>
        )
      }
    >
      <ErrorAlert error={goBack.error} />
      {own ? (
        <CertificateEditor
          key="own"
          scope={scope}
          kind={kind}
          kindName={kindName}
          initial={{ layout: own.layout, orientation: own.orientation }}
          saved
          sample={sample}
        />
      ) : org ? (
        <div className="flex flex-col gap-4">
          <Alert>
            <AlertTitle>{t("manageCerts.fromOrg")}</AlertTitle>
            <AlertDescription>{t("manageCerts.customizeHelp")}</AlertDescription>
            <AlertAction>
              <Button size="sm" disabled={copy.isPending} onClick={() => copy.mutate()}>
                {t("manageCerts.customize")}
              </Button>
            </AlertAction>
          </Alert>
          <ErrorAlert error={copy.error} />
          <CertificatePage
            layout={org.layout}
            orientation={org.orientation}
            values={{ ...sample, name: t("certDesign.sampleNameValue") }}
            qrValue={`https://${sample.link}`}
            qrLabel={t("certificates.scan")}
            className={`mx-auto border border-border shadow-sm ${org.orientation === "landscape" ? "max-w-4xl" : "max-w-2xl"}`}
          />
        </div>
      ) : (
        <CertificateEditor
          key="standard"
          scope={scope}
          kind={kind}
          kindName={kindName}
          initial={{ layout: defaultCertificateLayout(kind), orientation: "landscape" }}
          saved={false}
          sample={sample}
        />
      )}
    </Screen>
  );
}
