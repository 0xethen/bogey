import { useState, type ComponentType, type SVGProps } from "react";
import { Link } from "@tanstack/react-router";
import {
  IconCalendarEvent,
  IconCertificate,
  IconGavel,
  IconHome,
  IconInbox,
  IconInfoCircle,
  IconLayoutGrid,
  IconListCheck,
  IconMail,
  IconMessages,
  IconPresentation,
  IconClipboardList,
  IconSpeakerphone,
  IconTrophy,
  IconUserCheck,
  IconUsers,
} from "@tabler/icons-react";
import { Badge } from "@bogey/ui/components/badge";
import { LinkRow } from "@bogey/ui/components/row";
import { Screen } from "@bogey/ui/components/screen";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import { useNow } from "@bogey/ui/hooks/now";
import { useLocale } from "@bogey/ui/lib/locale";
import { formatRelative } from "@bogey/utils/time";
import { useT, type PlainKey } from "#/lib/translate.tsx";

export type Phase = "before" | "during" | "after";

type ManagePath =
  | "details"
  | "registration"
  | "people"
  | "people/review"
  | "agenda"
  | "agenda/attendance"
  | "homepage"
  | "announcements"
  | "messages"
  | "email"
  | "submissions"
  | "submissions/gallery"
  | "certificates"
  | "judging"
  | "judging/criteria"
  | "judging/demos"
  | "judging/results";

interface Stop {
  to: ManagePath;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: PlainKey;
  meta: PlainKey;
  count?: number;
  /** Shows the count as something waiting on you rather than a tally. */
  urgent?: boolean;
}

export interface PhaseCounts {
  pending: number;
  openQuestions: number;
  submitted: number;
  certificatesToSetUp: number;
}

const PHASES: Tuple<{ key: Phase; label: PlainKey }> = [
  { key: "before", label: "phases.before" },
  { key: "during", label: "phases.during" },
  { key: "after", label: "phases.after" },
];

function stops(phase: Phase, counts: PhaseCounts): Stop[] {
  switch (phase) {
    case "before":
      return [
        { to: "details", icon: IconInfoCircle, title: "details.title", meta: "phases.details" },
        {
          to: "registration",
          icon: IconClipboardList,
          title: "manageNav.registration",
          meta: "phases.registration",
        },
        {
          to: "people/review",
          icon: IconUserCheck,
          title: "phases.reviewTitle",
          meta: "phases.review",
          count: counts.pending,
          urgent: true,
        },
        { to: "agenda", icon: IconCalendarEvent, title: "eventTab.agenda", meta: "phases.agenda" },
        { to: "homepage", icon: IconHome, title: "homepageSetup.title", meta: "phases.homepage" },
        {
          to: "judging/criteria",
          icon: IconListCheck,
          title: "phases.criteriaTitle",
          meta: "phases.criteria",
        },
      ];
    case "during":
      return [
        {
          to: "agenda/attendance",
          icon: IconUserCheck,
          title: "manageAgenda.attendance",
          meta: "phases.attendance",
        },
        {
          to: "announcements",
          icon: IconSpeakerphone,
          title: "announcements.title",
          meta: "phases.announcements",
        },
        {
          to: "messages",
          icon: IconMessages,
          title: "eventTab.messages",
          meta: "phases.messages",
          count: counts.openQuestions,
          urgent: true,
        },
        {
          to: "submissions",
          icon: IconInbox,
          title: "window.submissions",
          meta: "phases.submissions",
          count: counts.submitted,
        },
        { to: "judging", icon: IconGavel, title: "judging.title", meta: "phases.judging" },
        {
          to: "judging/demos",
          icon: IconPresentation,
          title: "manageNav.demos",
          meta: "phases.demos",
        },
      ];
    case "after":
      return [
        {
          to: "judging/results",
          icon: IconTrophy,
          title: "manageNav.results",
          meta: "phases.results",
        },
        {
          to: "certificates",
          icon: IconCertificate,
          title: "certificates.title",
          meta: "phases.certificates",
          count: counts.certificatesToSetUp,
          urgent: true,
        },
        {
          to: "submissions/gallery",
          icon: IconLayoutGrid,
          title: "manageSubs.gallery",
          meta: "phases.gallery",
        },
        {
          to: "announcements",
          icon: IconSpeakerphone,
          title: "announcements.title",
          meta: "phases.winners",
        },
        { to: "email", icon: IconMail, title: "email.title", meta: "phases.email" },
        { to: "people", icon: IconUsers, title: "adminTab.people", meta: "phases.people" },
      ];
  }
}

export function phaseAt(
  event: { starts_at: string | null; ends_at: string | null },
  now: Date = new Date(),
): Phase {
  if (event.ends_at && now >= new Date(event.ends_at)) return "after";
  if (event.starts_at && now >= new Date(event.starts_at)) return "during";
  return "before";
}

/** Before / during / after tabs, each linking to the manage pages that matter then. */
export function PhaseNavigator({
  id,
  event,
  counts,
  loadedAt,
}: {
  id: string;
  event: { slug: string; starts_at: string | null; ends_at: string | null };
  counts: PhaseCounts;
  /** When the page loaded; stands in for the clock until it ticks, so hydration matches. */
  loadedAt: number;
}) {
  const t = useT();
  const locale = useLocale();
  const now = new Date(useNow() ?? loadedAt);
  const current = phaseAt(event, now);
  // follows the event's phase until someone picks a tab
  const [picked, setPicked] = useState<Phase | null>(null);
  const phase = picked ?? current;

  const when = (value: string) => formatRelative(value, now, locale);
  const status =
    current === "after" && event.ends_at
      ? t("phases.ended", { when: when(event.ends_at) })
      : current === "during" && event.ends_at
        ? t("phases.ends", { when: when(event.ends_at) })
        : current === "before" && event.starts_at
          ? t("phases.starts", { when: when(event.starts_at) })
          : current === "before"
            ? t("phases.noDates")
            : undefined;

  return (
    <Tabs value={phase} onValueChange={(next: Phase) => setPicked(next)}>
      <Screen.Section
        id={id}
        title={t("phases.title")}
        description={status}
        actions={
          <TabsList>
            {PHASES.map(({ key, label }) => (
              <TabsTrigger key={key} value={key}>
                {t(label)}
                {key === current && (
                  <>
                    <span aria-hidden className="size-1.5 rounded-pill bg-primary" />
                    <span className="sr-only">({t("phases.now")})</span>
                  </>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        }
      >
        {PHASES.map(({ key }) => (
          <TabsContent key={key} value={key}>
            <nav className="grid gap-x-6 sm:grid-cols-2">
              {stops(key, counts).map((stop) => (
                <LinkRow
                  key={stop.to}
                  render={
                    <Link to={`/events/$slug/manage/${stop.to}`} params={{ slug: event.slug }} />
                  }
                  leading={<stop.icon />}
                  title={t(stop.title)}
                  meta={t(stop.meta)}
                  trailing={
                    stop.count ? (
                      stop.urgent ? (
                        <Badge>{stop.count}</Badge>
                      ) : (
                        <span className="text-sm text-muted-fg tabular-nums">{stop.count}</span>
                      )
                    ) : undefined
                  }
                />
              ))}
            </nav>
          </TabsContent>
        ))}
      </Screen.Section>
    </Tabs>
  );
}
