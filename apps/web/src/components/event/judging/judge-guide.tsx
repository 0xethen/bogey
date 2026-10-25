import { queryOptions, useQuery } from "@tanstack/react-query";
import { browserClient } from "@bogey/db/browser";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { cn } from "@bogey/ui/lib/utils";
import { IconExternalLink } from "@tabler/icons-react";
import { useT } from "#/lib/translate.tsx";

export const GUIDE_BUCKET = "submissions";
export const GUIDE_MAX_MB = 20;

export interface JudgeGuide {
  path: string;
  name: string;
}

// a judging guide lives at <event>/judging-guide/..., which judges and organizers can read
export const guideFolder = (eventId: string) => `${eventId}/judging-guide`;

export const guideUrlQueryOptions = (path: string) =>
  queryOptions({
    queryKey: ["judge-guide-url", path] as const,
    queryFn: async () => {
      const { data, error } = await browserClient()
        .storage.from(GUIDE_BUCKET)
        .createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
    staleTime: 50 * 60_000,
  });

/** The organizers' guide PDF, shown in the browser's own viewer. */
export function GuideViewer({ guide, className }: { guide: JudgeGuide; className?: string }) {
  const t = useT();
  const url = useQuery(guideUrlQueryOptions(guide.path));
  if (url.isError) {
    return <p className="text-sm text-destructive">{t("judgeGuide.loadFailed")}</p>;
  }
  if (!url.data)
    return <Skeleton className={cn("h-full min-h-96 w-full rounded-2xl", className)} />;
  return (
    <div className={cn("flex h-full min-h-96 flex-col gap-2", className)}>
      <iframe
        src={url.data}
        title={guide.name}
        className="min-h-0 w-full flex-1 rounded-2xl bg-muted/40"
      />
      <a
        href={url.data}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1.5 self-start text-xs text-muted-fg hover:text-fg"
      >
        {t("judgeGuide.openTab", { name: guide.name })}
        <IconExternalLink className="size-3.5" />
      </a>
    </div>
  );
}
