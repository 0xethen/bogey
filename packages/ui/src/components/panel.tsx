import type { ReactNode } from "react";
import { IconLock } from "@tabler/icons-react";
import { cn } from "@bogey/ui/lib/utils";
import { Alert, AlertDescription } from "@bogey/ui/components/alert";

export function PanelSurface({
  size = "default",
  className,
  children,
}: {
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-slot="panel"
      data-size={size}
      className={cn(
        "flex flex-col rounded-3xl border border-border bg-card",
        "[--panel-spacing:--spacing(5)] data-[size=sm]:[--panel-spacing:--spacing(4)]",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Panel({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: "default" | "sm";
  className?: string;
  children: ReactNode;
}) {
  return (
    <PanelSurface size={size} className={cn("gap-4 p-(--panel-spacing)", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon && <div>{icon}</div>}
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-base leading-none">{title}</h2>
            {description && <p className="text-sm text-muted-fg">{description}</p>}
          </div>
        </div>
        {action}
      </header>
      {children}
    </PanelSurface>
  );
}

export function LockedNotice({ children }: { children: ReactNode }) {
  return (
    <Alert>
      <IconLock />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
