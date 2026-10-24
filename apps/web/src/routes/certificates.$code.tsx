import { createFileRoute, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { sessionQueryOptions } from "@bogey/db/auth";
import { certificateQueryOptions } from "@bogey/db/queries/certificates";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { CertificatePrintPage, CertificateSheet } from "#/components/event/certificate-sheet.tsx";
import { PublicBar } from "#/components/navigation/header/PublicBar.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/certificates/$code")({
  staticData: { title: msg("certificates.one"), command: false },
  loader: async ({ context, params }) => {
    const [certificate] = await Promise.all([
      context.query.query({ ...certificateQueryOptions(params.code), staleTime: "static" }),
      context.query.query({ ...sessionQueryOptions(), staleTime: "static" }),
    ]);
    if (!certificate) throw notFound();
    return { title: `${certificate.name}, ${certificate.event}` };
  },
  head: ({ loaderData }) =>
    loaderData ? { meta: [{ property: "og:title", content: loaderData.title }] } : {},
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { code } = Route.useParams();
  const { data: certificate } = useSuspenseQuery(certificateQueryOptions(code));
  if (!certificate) return null;
  return (
    <>
      <PublicBar />
      <Screen
        title={t("certificates.one")}
        width="wide"
        actions={
          !certificate.revoked && (
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              {t("common.print")}...
            </Button>
          )
        }
      >
        {certificate.revoked ? (
          <Alert variant="destructive">
            <AlertTitle>{t("certificates.withdrawn")}</AlertTitle>
            <AlertDescription>
              {t("certificates.withdrawnBody", { org: certificate.org })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Alert>
              <AlertTitle>{t("certificates.genuine")}</AlertTitle>
              <AlertDescription>
                {t("certificates.issued", {
                  org: certificate.org,
                  name: certificate.name,
                  event: certificate.event,
                })}
              </AlertDescription>
            </Alert>
            <div data-print-area>
              <CertificatePrintPage orientations={[certificate.orientation]} />
              <CertificateSheet certificate={certificate} />
            </div>
          </>
        )}
      </Screen>
    </>
  );
}
