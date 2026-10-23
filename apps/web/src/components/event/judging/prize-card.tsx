import { useQuery } from "@tanstack/react-query";
import type { SettingsValue } from "@bogey/config/settings";
import type { Award } from "@bogey/db/queries/awards";
import type { Prize } from "@bogey/db/queries/prizes";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Markdown } from "@bogey/ui/components/markdown";
import { cn } from "@bogey/ui/lib/utils";
import { useT } from "#/lib/translate.tsx";

export type PrizeView = Pick<
  Prize,
  "name" | "description" | "prize" | "sponsorName" | "sponsorLogoUrl" | "maxWinners"
>;

export type PrizeImage = NonNullable<SettingsValue<"submissions">["prizeImage"]>;

/** How the event shows prize images (submissions.prizeImage): an icon unless it says banner. */
export function usePrizeImage(eventId: string): PrizeImage {
  const settings = useQuery(settingsQueryOptions({ eventId }, ["submissions"]));
  return settings.data?.submissions.prizeImage ?? "icon";
}

function SponsorLogo({ url, name }: { url: string | null; name: string | null }) {
  const t = useT();
  if (!url) return null;
  return (
    <img
      src={url}
      alt={name ? t("results.logoOf", { name }) : ""}
      referrerPolicy="no-referrer"
      className="size-12 shrink-0 rounded-xl border border-border bg-white object-contain"
    />
  );
}

// a prize without an image keeps its frame, dashed, so every prize lines up
function PrizeArt({ prize, image }: { prize: PrizeView; image: PrizeImage }) {
  const t = useT();
  const frame =
    image === "banner" ? "aspect-[3/1] w-full rounded-xl" : "size-12 shrink-0 rounded-xl";
  if (!prize.sponsorLogoUrl) {
    return <div aria-hidden="true" className={cn(frame, "border border-dashed border-border")} />;
  }
  return (
    <img
      src={prize.sponsorLogoUrl}
      alt={prize.sponsorName ? t("results.logoOf", { name: prize.sponsorName }) : ""}
      referrerPolicy="no-referrer"
      className={cn(
        frame,
        "border border-border bg-white",
        image === "banner" ? "object-cover" : "object-contain",
      )}
    />
  );
}

export function PrizeCard({ prize, image = "icon" }: { prize: PrizeView; image?: PrizeImage }) {
  const t = useT();
  return (
    <div className={cn("flex min-w-0 flex-1 gap-3", image === "banner" && "flex-col")}>
      <PrizeArt prize={prize} image={image} />
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="font-heading font-semibold">
          {prize.name || <span className="text-muted-fg">{t("prizes.unnamed")}</span>}
        </h3>
        <p className="text-sm text-muted-fg">
          {[
            prize.sponsorName ? t("prizes.sponsoredBy", { name: prize.sponsorName }) : null,
            prize.maxWinners > 1 ? t("prizes.winners", { count: prize.maxWinners }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {prize.description && <Markdown features="short">{prize.description}</Markdown>}
        {prize.prize && (
          <div className="text-sm">
            <span className="font-medium">{t("prizes.prizeLabel")} </span>
            <Markdown features="plain">{prize.prize}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

export function AwardCard({ award, highlight }: { award: Award; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-2xl border border-border p-4",
        highlight && "border-fg/20 bg-accent",
      )}
    >
      <SponsorLogo url={award.sponsorLogoUrl} name={award.sponsorName} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-muted-fg">
          {award.label}
          {award.sponsorName ? ` · ${award.sponsorName}` : ""}
        </p>
        <h3 className="font-heading text-lg font-semibold">{award.title}</h3>
        <p className="text-sm text-muted-fg">{award.teamName}</p>
        {award.blurb && <p className="text-sm">{award.blurb}</p>}
        {award.note && <Markdown features="short">{award.note}</Markdown>}
        {award.prize && <Markdown features="plain">{award.prize}</Markdown>}
      </div>
    </div>
  );
}
