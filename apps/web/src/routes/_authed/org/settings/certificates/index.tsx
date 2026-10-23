import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { certificateDesignsQueryOptions } from "@bogey/db/queries/certificates";
import { CERTIFICATE_VARIABLES } from "@bogey/utils/certificate";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { useCertificateSample } from "#/components/event/certificate/certificate-sample.ts";
import { DesignCards } from "#/components/event/certificate/design-cards.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/settings/certificates/")({
  staticData: {
    title: msg("certificates.title"),
    settings: (t) => [
      searchSection(t("manageCerts.designs"), {
        id: "designs",
        keywords: ["certificate", "template", "logo", "signature"],
      }),
    ],
  },
  loader: ({ context }) =>
    context.query.ensureQueryData(
      certificateDesignsQueryOptions({ orgId: context.org.id, eventId: null }),
    ),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" layout="settings" />,
});

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const { data: designs } = useSuspenseQuery(
    certificateDesignsQueryOptions({ orgId: org.id, eventId: null }),
  );
  const sample = useCertificateSample({ org: org.name });
  return (
    <Screen
      title={t("certificates.title")}
      description={t("orgCerts.intro", { org: org.name })}
      width="embedded"
    >
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
          level="org"
          designs={designs}
          sample={sample}
          edit={(kind) => (
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/org/settings/certificates/$kind" params={{ kind }} />}
              nativeButton={false}
            >
              {t("manageCerts.edit")}
            </Button>
          )}
        />
      </Screen.Section>
    </Screen>
  );
}
