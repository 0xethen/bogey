import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  certificateDesignsQueryOptions,
  saveCertificateDesignFn,
} from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import {
  CERTIFICATE_LABELS,
  defaultCertificateLayout,
  isCertificateKind,
} from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { toast } from "@bogey/ui/components/toast";
import { CertificateEditor } from "#/components/event/certificate/certificate-editor.tsx";
import { useCertificateSample } from "#/components/event/certificate/certificate-sample.ts";
import { msg, sayOr, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/settings/certificates/$kind")({
  staticData: { title: msg("certDesign.title"), command: false },
  beforeLoad: ({ params }) => {
    if (!isCertificateKind(params.kind)) throw notFound();
    return { kind: params.kind };
  },
  loader: ({ context }) =>
    context.query.query({
      ...certificateDesignsQueryOptions({ orgId: context.org.id, eventId: null }),
      staleTime: "static",
    }),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org, kind } = Route.useRouteContext();
  const scope = { orgId: org.id, eventId: null };
  const queryClient = useQueryClient();
  const { data: designs } = useSuspenseQuery(certificateDesignsQueryOptions(scope));
  const own = designs.own.find((design) => design.kind === kind);
  const kindName = sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind]);
  const sample = useCertificateSample({ org: org.name });
  const goBack = useMutation({
    mutationFn: async () =>
      unwrap(
        await saveCertificateDesignFn({
          data: { ...scope, kind, layout: null, orientation: "landscape" },
        }),
      ),
    onSuccess: async () => {
      toast.add({ title: t("manageCerts.backToStandard") });
      await queryClient.invalidateQueries({ queryKey: ["certificates"] });
    },
  });
  return (
    <Screen
      title={t("certDesign.heading", { kind: kindName })}
      description={t("orgCerts.designIntro")}
      width="embedded"
      actions={
        own && (
          <Button
            size="sm"
            variant="outline"
            disabled={goBack.isPending}
            confirm={{
              title: t("manageCerts.useStandardTitle"),
              description: t("orgCerts.goBackBody"),
              label: t("manageCerts.goBackLabel"),
            }}
            onClick={() => goBack.mutate()}
          >
            {t("manageCerts.useStandard")}...
          </Button>
        )
      }
    >
      <ErrorAlert error={goBack.error} />
      <CertificateEditor
        key={own ? "own" : "standard"}
        scope={scope}
        kind={kind}
        kindName={kindName}
        initial={
          own
            ? { layout: own.layout, orientation: own.orientation }
            : { layout: defaultCertificateLayout(kind), orientation: "landscape" }
        }
        saved={Boolean(own)}
        sample={sample}
      />
    </Screen>
  );
}
