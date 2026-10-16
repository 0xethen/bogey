import {
  IconBulb,
  IconCalendarEvent,
  IconClockHour4,
  IconCode,
  IconCoffee,
  IconConfetti,
  IconDeviceGamepad2,
  IconDoorEnter,
  IconFlag,
  IconGavel,
  IconHeart,
  IconMicrophone2,
  IconMoon,
  IconMusic,
  IconPresentation,
  IconStar,
  IconTool,
  IconToolsKitchen2,
  IconTrophy,
  IconUsers,
  type Icon,
} from "@tabler/icons-react";
import type { SessionKind, SessionKindIcon, SessionKindTone } from "@bogey/config/settings";
import { Badge } from "@bogey/ui/components/badge";
import { cn } from "@bogey/ui/lib/utils";
import type { PlainKey } from "#/lib/translate.tsx";

export const KIND_ICONS: Record<SessionKindIcon, Icon> = {
  calendar: IconCalendarEvent,
  presentation: IconPresentation,
  tools: IconTool,
  meal: IconToolsKitchen2,
  coffee: IconCoffee,
  confetti: IconConfetti,
  door: IconDoorEnter,
  gavel: IconGavel,
  clock: IconClockHour4,
  microphone: IconMicrophone2,
  code: IconCode,
  users: IconUsers,
  trophy: IconTrophy,
  bulb: IconBulb,
  flag: IconFlag,
  music: IconMusic,
  moon: IconMoon,
  gamepad: IconDeviceGamepad2,
  heart: IconHeart,
  star: IconStar,
};

export const KIND_TONES: Record<
  SessionKindTone,
  { label: PlainKey; badge: string; swatch: string }
> = {
  gray: { label: "tone.gray", badge: "bg-muted text-muted-fg", swatch: "bg-muted-fg" },
  red: {
    label: "tone.red",
    badge: "bg-red-500/12 text-red-700 dark:text-red-300",
    swatch: "bg-red-500",
  },
  orange: {
    label: "tone.orange",
    badge: "bg-orange-500/12 text-orange-700 dark:text-orange-300",
    swatch: "bg-orange-500",
  },
  amber: {
    label: "tone.amber",
    badge: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
    swatch: "bg-amber-500",
  },
  green: {
    label: "tone.green",
    badge: "bg-green-500/12 text-green-700 dark:text-green-300",
    swatch: "bg-green-500",
  },
  teal: {
    label: "tone.teal",
    badge: "bg-teal-500/12 text-teal-700 dark:text-teal-300",
    swatch: "bg-teal-500",
  },
  blue: {
    label: "tone.blue",
    badge: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
    swatch: "bg-blue-500",
  },
  violet: {
    label: "tone.violet",
    badge: "bg-violet-500/12 text-violet-700 dark:text-violet-300",
    swatch: "bg-violet-500",
  },
  pink: {
    label: "tone.pink",
    badge: "bg-pink-500/12 text-pink-700 dark:text-pink-300",
    swatch: "bg-pink-500",
  },
};

export function kindLabel(kind: string): string {
  const last = kind.split(".").pop() ?? kind;
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, " ");
}

export const UNTYPED = "session";

export function resolveKind(kinds: Tuple<SessionKind>, key: string): SessionKind {
  return (
    kinds.find((kind) => kind.key === key) ?? {
      key,
      label: kindLabel(key),
      tone: "gray",
      icon: "calendar",
    }
  );
}

/** Only defined types show a badge; one-off kinds and untyped sessions show none. */
export function shownKind(kinds: Tuple<SessionKind>, key: string): SessionKind | null {
  return kinds.find((kind) => kind.key === key) ?? null;
}

export function KindBadge({ kind, className }: { kind: SessionKind; className?: string }) {
  const Icon = KIND_ICONS[kind.icon];
  return (
    <Badge className={cn(KIND_TONES[kind.tone].badge, className)}>
      <Icon aria-hidden />
      {kind.label}
    </Badge>
  );
}
