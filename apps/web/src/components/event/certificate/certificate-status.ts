import type { CertificateDesigns } from "@bogey/db/queries/certificates";
import { CERTIFICATE_KINDS, type CertificateKind } from "@bogey/utils/certificate";

export type DesignState = "own" | "org" | "standard";

/** Kinds the event gives, in order: every kind unless the event picked some. */
export function givenKinds(kinds: Tuple<CertificateKind> | undefined): CertificateKind[] {
  return CERTIFICATE_KINDS.filter((kind) => !kinds || kinds.includes(kind));
}

export function designState(designs: CertificateDesigns, kind: CertificateKind): DesignState {
  if (designs.own.some((design) => design.kind === kind)) return "own";
  if (designs.org.some((design) => design.kind === kind)) return "org";
  return "standard";
}

/** Given kinds still on the standard design: the setup an event hasn't done yet. */
export function unsetKinds(
  designs: CertificateDesigns,
  kinds: Tuple<CertificateKind> | undefined,
): CertificateKind[] {
  return givenKinds(kinds).filter((kind) => designState(designs, kind) === "standard");
}
