import type { ReactNode } from "react";
import type { CertificateDesigns } from "@bogey/db/queries/certificates";
import {
  CERTIFICATE_KINDS,
  CERTIFICATE_LABELS,
  defaultCertificateLayout,
  type CertificateKind,
} from "@bogey/utils/certificate";
import { Panel } from "@bogey/ui/components/panel";
import { CertificatePage } from "#/components/event/certificate/certificate-page.tsx";
import type { CertificateValues } from "#/components/event/certificate/certificate-page.tsx";
import { sayOr, useT } from "#/lib/translate.tsx";

/** One card per kind of certificate: what it looks like now, whose design it is, and a way in. */
export function DesignCards({
  level,
  kinds = CERTIFICATE_KINDS,
  designs,
  sample,
  edit,
}: {
  level: "event" | "org";
  /** The kinds shown; every kind by default. */
  kinds?: Tuple<CertificateKind>;
  designs: CertificateDesigns;
  sample: Omit<CertificateValues, "name">;
  edit: (kind: CertificateKind) => ReactNode;
}) {
  const t = useT();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {kinds.map((kind) => {
        const own = designs.own.find((design) => design.kind === kind);
        const org = designs.org.find((design) => design.kind === kind);
        const shown = own ?? org;
        const orientation = shown?.orientation ?? "landscape";
        const whose = own
          ? level === "event"
            ? t("manageCerts.own")
            : t("manageCerts.fromOrg")
          : org
            ? t("manageCerts.fromOrg")
            : t("manageCerts.standard");
        return (
          <Panel
            key={kind}
            size="sm"
            title={sayOr(t, `certKind.${kind}`, CERTIFICATE_LABELS[kind])}
            description={whose}
          >
            <div className="flex flex-col gap-3 p-(--panel-spacing) pt-0">
              <div className="flex h-44 items-center justify-center rounded-lg bg-muted/50 p-3">
                <div className={orientation === "landscape" ? "w-56" : "w-28"}>
                  <CertificatePage
                    layout={shown?.layout ?? defaultCertificateLayout(kind, orientation)}
                    orientation={orientation}
                    values={{ ...sample, name: t("certDesign.sampleNameValue") }}
                    qrValue={`https://${sample.link}`}
                    qrLabel={t("certificates.scan")}
                    className="shadow-sm"
                  />
                </div>
              </div>
              <div>{edit(kind)}</div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}
