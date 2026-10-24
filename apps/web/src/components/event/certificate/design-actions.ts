import { useQueryClient } from "@tanstack/react-query";
import {
  certificateDesignsQueryOptions,
  copyCertificateDesignFn,
  saveCertificateDesignFn,
  type DesignScope,
} from "@bogey/db/queries/certificates";
import { unwrap } from "@bogey/db/errors";
import {
  certificateFolder,
  defaultCertificateLayout,
  withBackgroundPicture,
  type CertificateKind,
  type CertificateLayout,
  type CertificateOrientation,
} from "@bogey/utils/certificate";
import { uploadImage } from "#/components/event/submission/image-input.tsx";
import { useT } from "#/lib/translate.tsx";
import type { PictureSize } from "./background-import.tsx";

/** Saving designs outside the editor: a slide as a kind's background, or keeping the standard one. */
export function useDesignActions(scope: DesignScope) {
  const t = useT();
  const queryClient = useQueryClient();
  const save = async (
    kind: CertificateKind,
    draft: { layout: CertificateLayout; orientation: CertificateOrientation },
  ) => {
    unwrap(await saveCertificateDesignFn({ data: { ...scope, kind, ...draft } }));
    await queryClient.invalidateQueries({ queryKey: ["certificates"] });
  };

  // an event building on the organization's design takes its own copy first, pictures included
  const current = async (kind: CertificateKind) => {
    const options = certificateDesignsQueryOptions(scope);
    let designs = await queryClient.fetchQuery(options);
    let own = designs.own.find((design) => design.kind === kind);
    if (!own && scope.eventId && designs.org.some((design) => design.kind === kind)) {
      unwrap(await copyCertificateDesignFn({ data: { eventId: scope.eventId, kind } }));
      designs = await queryClient.fetchQuery({ ...options, staleTime: 0 });
      own = designs.own.find((design) => design.kind === kind);
    }
    return own
      ? { layout: own.layout, orientation: own.orientation }
      : { layout: defaultCertificateLayout(kind), orientation: "landscape" as const };
  };

  return {
    setBackground: async (kind: CertificateKind, file: File, size: PictureSize) => {
      const base = await current(kind);
      const stored = await uploadImage(certificateFolder({ ...scope, kind }), file, t);
      await save(kind, withBackgroundPicture(base, { url: stored.url, path: stored.path }, size));
    },
    keepStandard: (kind: CertificateKind) =>
      save(kind, { layout: defaultCertificateLayout(kind), orientation: "landscape" }),
  };
}
