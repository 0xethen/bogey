import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { browserClient } from "@bogey/db/browser";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  CARD_SIZES,
  galleryQueryOptions,
  setGalleryLookFn,
  type CardSize,
} from "@bogey/db/queries/gallery";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import {
  mySubmissionsQueryOptions,
  type Submission,
  type SubmissionFile,
} from "@bogey/db/queries/submissions";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { cn } from "@bogey/ui/lib/utils";
import { useT, type PlainKey } from "#/lib/translate.tsx";

const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;

const SIZE_LABEL = {
  compact: "gallery.sizeCompact",
  standard: "gallery.sizeStandard",
  large: "gallery.sizeLarge",
} as const satisfies Record<CardSize, PlainKey>;

function cardSize(value: string): CardSize {
  return CARD_SIZES.find((size) => size === value) ?? "standard";
}

/** How a team's project looks in the public gallery: a banner from its images, and a card size, as far as the organizers allow. */
export function GalleryLook({
  eventId,
  slug,
  submission,
  files,
}: {
  eventId: string;
  slug: string;
  submission: Submission;
  files: Tuple<SubmissionFile>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQueryOptions({ eventId }, ["gallery"]));
  const images = files.filter((file) => IMAGE.test(file.file_name));
  const saved = images.find((file) => file.is_banner)?.id ?? null;
  const [banner, setBanner] = useState<string | null>(saved);
  const [size, setSize] = useState<CardSize>(cardSize(submission.card_size));
  const thumbs = useQuery({
    queryKey: ["gallery-look-thumbs", submission.id, images.map((file) => file.id)] as const,
    enabled: images.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data, error } = await browserClient()
        .storage.from("submissions")
        .createSignedUrls(
          images.map((file) => file.storage_path),
          3600,
        );
      if (error) throw error;
      return new Map(
        data.flatMap((entry) =>
          entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
        ),
      );
    },
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        await setGalleryLookFn({
          data: { submissionId: submission.id, bannerId: banner, size },
        }).catch(requestFailure),
      ),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mySubmissionsQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: galleryQueryOptions(slug).queryKey }),
      ]),
  });

  const gallery = settings.data?.gallery;
  const bannersOn = !!gallery?.banners && !!gallery.teamBanners && images.length > 0;
  const sizesOn = !!gallery?.teamSizes;
  if (!bannersOn && !sizesOn) return null;
  const changed = banner !== saved || size !== cardSize(submission.card_size);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-sm font-medium">{t("sub.galleryLook")}</h2>
      {bannersOn && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-fg">{t("sub.galleryBanner")}</span>
          <ul className="grid grid-cols-3 gap-2">
            {[null, ...images].map((file) => {
              const chosen = (file?.id ?? null) === banner;
              const url = file ? thumbs.data?.get(file.storage_path) : undefined;
              return (
                <li key={file?.id ?? "auto"}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    aria-label={file ? file.file_name : t("sub.galleryBannerAuto")}
                    onClick={() => setBanner(file?.id ?? null)}
                    className={cn(
                      "grid aspect-video w-full place-items-center overflow-hidden rounded-lg border bg-muted text-xs text-muted-fg",
                      chosen ? "border-primary ring-2 ring-primary/40" : "border-border",
                    )}
                  >
                    {url ? (
                      <img src={url} alt="" className="size-full object-cover" />
                    ) : (
                      !file && t("sub.galleryBannerAuto")
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {sizesOn && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-fg">{t("sub.galleryCardSize")}</span>
          <OptSelect
            size="sm"
            ariaLabel={t("sub.galleryCardSize")}
            value={size}
            options={CARD_SIZES.map((each) => ({ value: each, label: t(SIZE_LABEL[each]) }))}
            onChange={setSize}
          />
        </div>
      )}
      <ErrorAlert error={save.error} title={t("sub.galleryFailed")} />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!changed || save.isPending}
        onClick={() => save.mutate()}
      >
        {t("sub.gallerySave")}
      </Button>
    </section>
  );
}
