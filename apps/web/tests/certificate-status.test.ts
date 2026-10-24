import { expect, test } from "vite-plus/test";
import type { CertificateDesign } from "@bogey/db/queries/certificates";
import { defaultCertificateLayout, type CertificateKind } from "@bogey/utils/certificate";
import {
  designState,
  givenKinds,
  unsetKinds,
} from "../src/components/event/certificate/certificate-status.ts";

function design(kind: CertificateKind, eventId: string | null): CertificateDesign {
  return {
    kind,
    eventId,
    orientation: "landscape",
    layout: defaultCertificateLayout(kind),
    updatedAt: "2026-10-24T00:00:00Z",
  };
}

test("every kind is given until the event picks some, in the usual order", () => {
  expect(givenKinds(undefined)).toEqual(["participation", "award", "judge", "volunteer"]);
  expect(givenKinds(["volunteer", "award"])).toEqual(["award", "volunteer"]);
});

test("a kind is set up once the event or its organization has a design for it", () => {
  const designs = { own: [design("award", "ev")], org: [design("judge", null)] };
  expect(designState(designs, "award")).toBe("own");
  expect(designState(designs, "judge")).toBe("org");
  expect(designState(designs, "participation")).toBe("standard");
  expect(unsetKinds(designs, undefined)).toEqual(["participation", "volunteer"]);
  expect(unsetKinds(designs, ["award", "judge"])).toEqual([]);
});
