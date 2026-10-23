import { useState } from "react";
import { eventDates, verificationPath } from "@bogey/utils/certificate";
import { useExternalValue } from "@bogey/ui/hooks/external";
import type { CertificateValues } from "#/components/event/certificate/certificate-page.tsx";
import { useT } from "#/lib/translate.tsx";

const SAMPLE_CODE = "SAMP2E4CDE";

/** Everything but the name for previewing a design; the event's own details when there is one. */
export function useCertificateSample({
  event,
  org,
  startsAt = null,
  endsAt = null,
}: {
  event?: string;
  org: string;
  startsAt?: string | null;
  endsAt?: string | null;
}): Omit<CertificateValues, "name"> {
  const t = useT();
  const [today] = useState(() => new Date().toISOString());
  const host = useExternalValue(
    () => () => undefined,
    () => location.host,
    "",
  );
  return {
    event: event ?? t("certDesign.sampleEvent"),
    org,
    award: t("certDesign.sampleAward"),
    date: eventDates(startsAt, endsAt) || eventDates(today, null),
    code: SAMPLE_CODE,
    link: `${host}${verificationPath(SAMPLE_CODE)}`,
  };
}
