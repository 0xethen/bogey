import { encode } from "uqr";
import { IconMaximize } from "@tabler/icons-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@bogey/ui/components/dialog";
import { cn } from "@bogey/ui/lib/utils";

export function QrCode({
  value,
  size = 160,
  label,
  className,
}: {
  value: string;
  size?: number;
  label: string;
  className?: string;
}) {
  const matrix = encode(value, { ecc: "M", border: 1 }).data;
  const n = matrix.length;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn("bg-white", className)}
    >
      <rect width={n} height={n} fill="white" />
      {matrix.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="black" /> : null,
        ),
      )}
    </svg>
  );
}

// a QR code that opens full screen, for showing it to a room from a laptop; `caption` (the code
// it carries, usually) shows under it there
export function ExpandableQrCode({
  value,
  size,
  label,
  expandLabel,
  caption,
  className,
}: {
  value: string;
  size?: number;
  label: string;
  expandLabel: string;
  caption?: string;
  className?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={expandLabel}
        title={expandLabel}
        className="group relative shrink-0 cursor-zoom-in rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <QrCode value={value} size={size} label={label} className={className} />
        <span className="absolute inset-0 flex items-center justify-center rounded bg-background/80 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
          <IconMaximize className="size-6" />
        </span>
      </DialogTrigger>
      <DialogContent className="justify-items-center gap-4 p-8 sm:max-w-[min(90vw,80vh)]">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <QrCode value={value} label={label} className="size-auto w-full rounded-xl p-2" />
        {caption && (
          <p className="font-mono text-4xl font-semibold tracking-[0.3em] tabular-nums">
            {caption}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
