import type { Certificate } from "@bogey/db/queries/certificates";
import {
  defaultCertificateLayout,
  eventDates,
  verificationPath,
  type CertificateOrientation,
} from "@bogey/utils/certificate";
import { useExternalValue } from "@bogey/ui/hooks/external";
import { CertificatePage } from "#/components/event/certificate/certificate-page.tsx";
import { useT } from "#/lib/translate.tsx";

/** One issued certificate, as it prints (A4, one per page). */
export function CertificateSheet({ certificate }: { certificate: Certificate }) {
  const t = useT();
  const origin = useExternalValue(
    () => () => undefined,
    () => location.origin,
    "",
  );
  const address = `${origin}${verificationPath(certificate.code)}`;
  const orientation = certificate.orientation;
  return (
    <section
      data-orientation={orientation}
      className={`certificate-sheet mx-auto w-full break-after-page border border-border shadow-sm print:border-0 print:shadow-none ${orientation === "landscape" ? "max-w-4xl" : "max-w-2xl"}`}
    >
      <CertificatePage
        layout={certificate.layout ?? defaultCertificateLayout(certificate.kind, orientation)}
        orientation={orientation}
        values={{
          name: certificate.name,
          event: certificate.event,
          org: certificate.org,
          award: certificate.label,
          date: eventDates(certificate.startsAt, certificate.endsAt),
          code: certificate.code,
          link: address.replace(/^https?:\/\//, ""),
        }}
        qrValue={address}
        qrLabel={t("certificates.scan")}
      />
    </section>
  );
}

/** Sizes the printed page to the certificates: A4, no margins, turned the way most of them are. */
export function CertificatePrintPage({
  orientations,
}: {
  orientations: readonly CertificateOrientation[];
}) {
  const portrait = orientations.filter((each) => each === "portrait").length;
  const turn = portrait > orientations.length / 2 ? "portrait" : "landscape";
  return (
    <style>{`@page { size: A4 ${turn}; margin: 0; }
@media print {
  .certificate-sheet { max-width: none; width: ${turn === "landscape" ? "297mm" : "210mm"}; margin: 0; }
}`}</style>
  );
}
