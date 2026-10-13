import type { Award } from "@bogey/db/queries/awards";
import type { Prize } from "@bogey/db/queries/prizes";
import { Markdown } from "@bogey/ui/components/markdown";
import { cn } from "@bogey/ui/lib/utils";
import { useT } from "#/lib/translate.tsx";

export type PrizeView = Pick<
  Prize,
  "name" | "description" | "prize" | "sponsorName" | "sponsorLogoUrl" | "maxWinners"
>;

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

export function PrizeCard({ prize }: { prize: PrizeView }) {
  const t = useT();
  return (
    <div className="flex gap-3">
      <SponsorLogo url={prize.sponsorLogoUrl} name={prize.sponsorName} />
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
        {prize.description && <Markdown>{prize.description}</Markdown>}
        {prize.prize && (
          <div className="text-sm">
            <span className="font-medium">{t("prizes.prizeLabel")} </span>
            <Markdown>{prize.prize}</Markdown>
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
        highlight && "border-primary bg-primary/5",
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
        {award.note && <Markdown>{award.note}</Markdown>}
        {award.prize && <Markdown>{award.prize}</Markdown>}
      </div>
    </div>
  );
}
