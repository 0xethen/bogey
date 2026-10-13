import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { cn } from "@bogey/ui/lib/utils";

function Meter({ className, children, ...props }: MeterPrimitive.Root.Props) {
  return (
    <MeterPrimitive.Root
      data-slot="meter"
      className={cn("flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5", className)}
      {...props}
    >
      {children}
      <MeterTrack>
        <MeterIndicator />
      </MeterTrack>
    </MeterPrimitive.Root>
  );
}

function MeterTrack({ className, ...props }: MeterPrimitive.Track.Props) {
  return (
    <MeterPrimitive.Track
      data-slot="meter-track"
      className={cn("relative h-2 w-full overflow-hidden rounded-pill bg-muted", className)}
      {...props}
    />
  );
}

function MeterIndicator({ className, ...props }: MeterPrimitive.Indicator.Props) {
  return (
    <MeterPrimitive.Indicator
      data-slot="meter-indicator"
      className={cn("h-full rounded-pill bg-primary transition-[width]", className)}
      {...props}
    />
  );
}

function MeterLabel({ className, ...props }: MeterPrimitive.Label.Props) {
  return (
    <MeterPrimitive.Label
      data-slot="meter-label"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}

function MeterValue({ className, ...props }: MeterPrimitive.Value.Props) {
  return (
    <MeterPrimitive.Value
      data-slot="meter-value"
      className={cn("text-sm text-muted-fg tabular-nums", className)}
      {...props}
    />
  );
}

export { Meter, MeterTrack, MeterIndicator, MeterLabel, MeterValue };
