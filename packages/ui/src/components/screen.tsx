import type { ReactNode } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { toSlug } from "@bogey/utils/keys";
import { cn } from "@bogey/ui/lib/utils";
import { Skeleton } from "./skeleton.tsx";

type Width = "default" | "narrow" | "wide" | "superwide" | "embedded";

const WIDTH: Record<Width, string> = {
  default: "max-w-4xl",
  narrow: "max-w-2xl",
  wide: "max-w-6xl",
  superwide: "max-w-8xl",
  embedded: "",
};

const PADDING: Record<Width, string> = {
  default: ["px-4 sm:px-6", "py-5 sm:py-6 lg:py-8"].join(" "),
  narrow: ["px-4 sm:px-6", "py-5 sm:py-6 lg:py-8"].join(" "),
  wide: ["px-4 sm:px-6", "py-5 sm:py-6 lg:py-8"].join(" "),
  superwide: ["px-4 sm:px-6", "py-5 sm:py-6 lg:py-8"].join(" "),
  // settings layouts pad the sides themselves
  embedded: "py-5 sm:py-6 lg:py-8",
};

function ScreenRoot({
  title,
  description,
  actions,
  leading,
  width = "default",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Left of the title, e.g. an icon button back to the parent screen. */
  leading?: ReactNode;
  width?: Width;
  children: ReactNode;
}) {
  return (
    <main className={cn("mx-auto flex w-full flex-col gap-10", WIDTH[width], PADDING[width])}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading && <div className="shrink-0">{leading}</div>}
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="font-heading text-3xl leading-tight font-semibold tracking-tight text-balance">
              {title}
            </h1>
            {description && <p className="text-sm text-muted-fg">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

function ScreenSection({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id ?? toSlug(title)}
      className={cn(
        "jump-target flex scroll-mt-(--layout-offset) flex-col gap-4",
        // settings sit as far apart as they do directly on a screen
        "[&>[data-setting]+[data-setting]]:mt-6",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-fg">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

function ScreenAuth({
  mark,
  title,
  description,
  children,
  footer,
  wide,
}: {
  mark?: ReactNode;
  wide?: boolean;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-safe-dvh flex-col items-center justify-center p-6">
      <div className={cn("flex w-full flex-col gap-6", wide ? "max-w-lg" : "max-w-sm")}>
        <header className="flex flex-col items-center gap-2 text-center">
          {mark}
          <h1 className="font-heading text-xl">{title}</h1>
          {description && <p className="text-sm text-balance text-muted-fg">{description}</p>}
        </header>
        {children}
        {footer && (
          <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            {footer}
          </footer>
        )}
      </div>
    </main>
  );
}

function ScreenFallback({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto my-16 flex w-full max-w-lg flex-col items-center gap-6 px-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-fg [&_svg]:size-5">
        {icon}
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-lg font-medium tracking-tight">{title}</h1>
        <p className="text-sm text-balance text-muted-fg">{description}</p>
      </div>
      {children}
    </main>
  );
}

function ScreenActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-2">{children}</div>;
}

function SkeletonRows({ count, className }: { count: number; className?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={cn("h-14 w-full", className)} />
      ))}
    </div>
  );
}

function SkeletonFields({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36 rounded-md" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </div>
  );
}

function ScreenSkeleton({
  width = "default",
  layout = "list",
}: {
  width?: Width;
  layout?: "list" | "settings" | "columns" | "table";
}) {
  const t = useUiText();
  return (
    <main
      aria-busy="true"
      aria-label={t("ui.loading")}
      className={cn("mx-auto flex w-full flex-col gap-10 py-8", WIDTH[width])}
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full rounded-md" />
      </div>
      {layout === "list" && <SkeletonRows count={4} />}
      {layout === "settings" && <SkeletonFields count={4} />}
      {layout === "table" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
          <SkeletonRows count={6} className="h-10 rounded-lg" />
        </div>
      )}
      {layout === "columns" && (
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <SkeletonRows count={4} />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      )}
    </main>
  );
}

export const Screen = Object.assign(ScreenRoot, {
  Section: ScreenSection,
  Auth: ScreenAuth,
  Fallback: ScreenFallback,
  Actions: ScreenActions,
  Skeleton: ScreenSkeleton,
});
