import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useHotkey } from "@tanstack/react-hotkeys";
import { IconArrowLeft, IconArrowsMaximize } from "@tabler/icons-react";
import { draftAwardsQueryOptions, type Award } from "@bogey/db/queries/awards";
import { publishedResultsQueryOptions } from "@bogey/db/queries/judging";
import { useCan } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { Markdown } from "@bogey/ui/components/markdown";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/results/present")({
  staticData: { title: msg("results.presentTitle"), command: false },
  component: RouteComponent,
});

function Slide({ award, step }: { award: Award | null; step: number }) {
  const t = useT();
  if (!award) {
    return (
      <p className="text-center font-heading text-5xl font-semibold" key={step}>
        {t("results.winners")}
      </p>
    );
  }
  return (
    <div className="flex max-w-4xl flex-col items-center gap-6 text-center" key={step}>
      {award.sponsorLogoUrl && (
        <img
          src={award.sponsorLogoUrl}
          alt={award.sponsorName ? t("results.logoOf", { name: award.sponsorName }) : ""}
          referrerPolicy="no-referrer"
          className="h-20 max-w-xs object-contain"
        />
      )}
      <p className="text-2xl font-medium text-muted-fg">
        {award.label}
        {award.sponsorName ? ` · ${award.sponsorName}` : ""}
      </p>
      <h1 className="font-heading text-6xl font-semibold">{award.title}</h1>
      <p className="text-3xl">{award.teamName}</p>
      {award.blurb && <p className="text-xl text-muted-fg">{award.blurb}</p>}
      {award.note && <Markdown features="short">{award.note}</Markdown>}
    </div>
  );
}

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const published = useQuery(publishedResultsQueryOptions(event.id));
  const manages = useCan("event.manage");
  const drafts = useQuery({
    ...draftAwardsQueryOptions(event.id),
    enabled: manages && published.isSuccess && !published.data,
  });
  const awards = published.data?.awards ?? (manages ? (drafts.data ?? []) : []);
  const [step, setStep] = useState(-1);
  const next = () => setStep((current) => Math.min(current + 1, awards.length - 1));
  const back = () => setStep((current) => Math.max(current - 1, -1));
  useHotkey("Space", next, {
    meta: {
      name: t("results.nextAward"),
      description: t("results.whilePresenting"),
      group: "Results",
    },
  });
  useHotkey("Enter", next);
  useHotkey("ArrowRight", next);
  useHotkey("ArrowLeft", back);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-fg">
      <div className="flex items-center justify-between gap-2 p-3">
        <Button
          size="sm"
          variant="ghost"
          render={<Link to="/events/$slug/results" params={{ slug: event.slug }} />}
          nativeButton={false}
        >
          <IconArrowLeft />
          {t("results.back")}
        </Button>
        <div className="flex items-center gap-2">
          {!published.data && manages && (
            <span className="text-sm text-muted-fg">{t("results.draft")}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void document.documentElement.requestFullscreen()}
          >
            <IconArrowsMaximize />
            {t("results.fullScreen")}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={next}
        aria-label={t("results.nextAward")}
        className="flex flex-1 items-center justify-center p-8"
      >
        {awards.length === 0 ? (
          <p className="text-xl text-muted-fg">{t("results.noAwards")}</p>
        ) : (
          <Slide award={step < 0 ? null : (awards[step] ?? null)} step={step} />
        )}
      </button>
      <p className="p-3 text-center text-sm text-muted-fg">
        {awards.length > 0 &&
          t("results.progress", { at: Math.max(step + 1, 0), total: awards.length })}
      </p>
    </div>
  );
}
