import type { Certificate } from "@bogey/db/queries/certificates";
import {
  DEFAULT_CERTIFICATE_BODY,
  eventDates,
  fillCertificate,
  verificationPath,
} from "@bogey/utils/certificate";
import { Markdown } from "@bogey/ui/components/markdown";
import { useExternalValue } from "@bogey/ui/hooks/external";
import { QrCode } from "#/components/event/qr-code.tsx";
import { useT } from "#/lib/translate.tsx";

export function CertificateSheet({ certificate }: { certificate: Certificate }) {
  const t = useT();
  const origin = useExternalValue(
    () => () => undefined,
    () => location.origin,
    "",
  );
  const body = fillCertificate(certificate.body ?? DEFAULT_CERTIFICATE_BODY[certificate.kind], {
    name: certificate.name,
    event: certificate.event,
    org: certificate.org,
    award: certificate.label,
    date: eventDates(certificate.startsAt, certificate.endsAt),
  });
  const address = `${origin}${verificationPath(certificate.code)}`;
  const landscape = certificate.orientation === "landscape";
  return (
    <section
      className={`certificate-sheet relative mx-auto flex w-full flex-col items-center justify-between gap-6 overflow-hidden border-4 border-double border-border bg-white p-8 text-center text-black break-after-page print:border-black ${landscape ? "aspect-[297/210] max-w-4xl" : "aspect-[210/297] max-w-2xl"}`}
      style={
        certificate.background
          ? {
              backgroundImage: `url(${certificate.background})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      <div className="flex flex-1 flex-col items-center justify-center">
        <Markdown className="typeset-center text-black [&_h1]:text-4xl [&_h2]:text-3xl">
          {body}
        </Markdown>
      </div>
      <footer className="flex items-center gap-3 text-xs text-black/70">
        <QrCode value={address} size={64} label={t("certificates.scan")} />
        <span className="text-left">
          {t("certificates.check")}
          <br />
          {address.replace(/^https?:\/\//, "")}
        </span>
      </footer>
    </section>
  );
}
