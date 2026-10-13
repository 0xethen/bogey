import type { ReactNode } from "react";
import { IconAlertTriangle, IconInfoCircle, IconUrgent } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import type { PlainKey } from "#/lib/translate.tsx";
import { useT } from "#/lib/translate.tsx";

export type NoticeTone = "info" | "warning" | "urgent";

const ICON = { info: IconInfoCircle, warning: IconAlertTriangle, urgent: IconUrgent } as const;
const LABEL = {
  info: "notice.info",
  warning: "notice.warning",
  urgent: "notice.urgent",
} as const satisfies Record<NoticeTone, PlainKey>;

export function Notice({
  tone = "info",
  title,
  meta,
  unread,
  actions,
  children,
  className,
}: {
  tone?: NoticeTone;
  title: ReactNode;
  meta?: ReactNode;
  unread?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const t = useT();
  const Icon = ICON[tone];
  return (
    <article
      className={cn(
        "relative grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-3 pr-1 pl-4",
        tone === "info" && "border-border",
        tone === "warning" && "rounded-lg border-warning bg-warning/10",
        tone === "urgent" && "rounded-lg border-destructive bg-destructive/10",
        className,
      )}
    >
      <span className="relative flex h-6 w-4 items-center justify-center">
        <Icon
          aria-label={t(LABEL[tone])}
          className={cn(
            "size-4",
            tone === "info" && "text-muted-fg",
            tone === "warning" && "text-warning",
            tone === "urgent" && "text-destructive",
          )}
        />
        {unread && (
          <span className="absolute right-[-3px] bottom-0.5 size-2 rounded-pill bg-primary ring-2 ring-background">
            <span className="sr-only">{t("notice.new")}</span>
          </span>
        )}
      </span>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="leading-6 font-medium">{title}</h3>
          {meta && <p className="text-sm text-muted-fg">{meta}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children && <div className="col-start-2 mt-1 min-w-0 text-sm">{children}</div>}
    </article>
  );
}

export function NoticeList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>;
}
