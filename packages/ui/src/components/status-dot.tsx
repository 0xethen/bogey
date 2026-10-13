import { cn } from "@bogey/ui/lib/utils";

export function StatusDot({
  tone,
  label,
  className,
}: {
  tone: "attention" | "done" | "idle";
  label: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-pill",
        tone === "attention" &&
          "bg-warning shadow-[0_0_0_3px_color-mix(in_oklch,var(--warning)_25%,transparent)]",
        tone === "done" && "bg-primary",
        tone === "idle" && "bg-muted-fg/40",
        className,
      )}
    />
  );
}
