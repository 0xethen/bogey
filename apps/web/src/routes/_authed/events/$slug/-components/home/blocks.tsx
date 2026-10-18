import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { eventPrizesQueryOptions } from "@bogey/db/queries/prizes";
import { myRegistrationQueryOptions } from "@bogey/db/queries/registration";
import { PrizeCard, usePrizeImage } from "#/components/event/judging/prize-card.tsx";
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBell,
  IconCalendarEvent,
  IconChecks,
  IconClockHour4,
  IconExternalLink,
  IconFileDescription,
  IconInfoCircle,
  IconInfoSquare,
  IconLayoutList,
  IconLink,
  IconLock,
  IconMinus,
  IconPhoto,
  IconRoute,
  IconHeartHandshake,
  IconId,
  IconMessageQuestion,
  IconSpeakerphone,
  IconTextCaption,
  IconTrophy,
  type Icon,
} from "@tabler/icons-react";
import {
  HOME_BUILT_IN_BLOCKS,
  type CalloutTone,
  type HomeBlock,
  type HomeImage,
  type ResolvedValue,
  type SessionKind,
} from "@bogey/config/settings";
import type { Session } from "@bogey/db/auth";
import type { EventAccess } from "@bogey/db/permissions";
import type { Announcement } from "@bogey/db/queries/announcements";
import type { Event } from "@bogey/db/queries/events";
import type { EventPage } from "@bogey/db/queries/pages";
import type { Agenda } from "@bogey/db/queries/sessions";
import { windowByKey, type EventWindow } from "@bogey/db/queries/windows";
import type { PluginManifest } from "@bogey/plugins";
import { formatDateRange, type FormatOptions } from "@bogey/utils/time";
import { Button } from "@bogey/ui/components/button";
import { DialogTrigger } from "@bogey/ui/components/dialog";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { Facts, type Fact } from "@bogey/ui/components/facts";
import { Markdown } from "@bogey/ui/components/markdown";
import { Screen } from "@bogey/ui/components/screen";
import { Separator } from "@bogey/ui/components/separator";
import { Timeline } from "#/components/event/agenda/timeline.tsx";
import { useNow } from "@bogey/ui/hooks/now";
import { LINK, Linked, SettingLink } from "#/components/settings/setting-link.tsx";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { cn } from "@bogey/ui/lib/utils";
import { AgendaSummary } from "#/components/event/agenda/agenda.tsx";
import { AnnouncementMessage, ANNOUNCEMENTS } from "#/components/event/messaging/announcements.tsx";
import { newAnnouncement } from "#/components/event/messaging/announcement-composer.tsx";
import { NextSteps } from "./next-steps.tsx";
import { BadgeCard } from "./badge-card.tsx";
import { PluginHomePanel, panelFor } from "./plugin-panels.tsx";
import { ScheduleList } from "./schedule-list.tsx";
import { agendaMilestones, timelineItems } from "#/lib/windows.ts";
import { useT, type PlainKey, type T } from "#/lib/translate.tsx";

export interface HomeData {
  event: Event;
  access: EventAccess | null;
  session: Session;
  plugins: Tuple<PluginManifest>;
  windows: Tuple<EventWindow>;
  pages: Tuple<EventPage>;
  announcements: Tuple<Announcement>;
  agenda: Agenda;
  kinds: Tuple<SessionKind>;
  schedule: ResolvedValue<"schedule">;
  venue: ResolvedValue<"venue">;
  about: string;
  competes: boolean;
  manages: boolean;
}

export type BlockType = Exclude<HomeBlock["type"], "plugin">;

export const BLOCK_GROUPS = [
  { key: "event", label: "blockGroup.event" },
  { key: "words", label: "blockGroup.words" },
  { key: "pictures", label: "blockGroup.pictures", hint: "blockGroup.picturesHint" },
  { key: "actions", label: "blockGroup.actions" },
  { key: "layout", label: "blockGroup.layout" },
] as const satisfies readonly { key: string; label: PlainKey; hint?: PlainKey }[];

export type BlockGroup = (typeof BLOCK_GROUPS)[number]["key"];

export const BLOCK_INFO: Record<
  BlockType,
  { label: PlainKey; title: PlainKey | null; description: PlainKey; icon: Icon; group: BlockGroup }
> = {
  "next-steps": {
    label: "block.next-steps",
    title: "block.next-steps.title",
    description: "block.next-steps.help",
    icon: IconRoute,
    group: "event",
  },
  agenda: {
    label: "block.agenda",
    title: "block.agenda.title",
    description: "block.agenda.help",
    icon: IconCalendarEvent,
    group: "event",
  },
  announcements: {
    label: "block.announcements",
    title: "block.announcements.title",
    description: "block.announcements.help",
    icon: IconSpeakerphone,
    group: "event",
  },
  facts: {
    label: "block.facts",
    title: "block.facts.title",
    description: "block.facts.help",
    icon: IconInfoSquare,
    group: "event",
  },
  prizes: {
    label: "block.prizes",
    title: "block.prizes.title",
    description: "block.prizes.help",
    icon: IconTrophy,
    group: "event",
  },
  about: {
    label: "block.about",
    title: "block.about.title",
    description: "block.about.help",
    icon: IconFileDescription,
    group: "event",
  },
  badge: {
    label: "block.badge",
    title: "badge.title",
    description: "block.badge.help",
    icon: IconId,
    group: "event",
  },
  pages: {
    label: "block.pages",
    title: "block.pages.title",
    description: "block.pages.help",
    icon: IconLayoutList,
    group: "event",
  },
  text: {
    label: "block.text",
    title: null,
    description: "block.text.help",
    icon: IconTextCaption,
    group: "words",
  },
  callout: {
    label: "block.callout",
    title: null,
    description: "block.callout.help",
    icon: IconBell,
    group: "words",
  },
  faq: {
    label: "block.faq",
    title: "block.faq.title",
    description: "block.faq.help",
    icon: IconMessageQuestion,
    group: "words",
  },
  image: {
    label: "block.image",
    title: null,
    description: "block.image.help",
    icon: IconPhoto,
    group: "pictures",
  },
  sponsors: {
    label: "block.sponsors",
    title: "block.sponsors.title",
    description: "block.sponsors.help",
    icon: IconHeartHandshake,
    group: "pictures",
  },
  links: {
    label: "block.links",
    title: "block.links.title",
    description: "block.links.help",
    icon: IconLink,
    group: "actions",
  },
  countdown: {
    label: "block.countdown",
    title: null,
    description: "block.countdown.help",
    icon: IconClockHour4,
    group: "actions",
  },
  divider: {
    label: "block.divider",
    title: null,
    description: "block.divider.help",
    icon: IconMinus,
    group: "layout",
  },
};

export const ONCE_PER_PAGE: ReadonlySet<BlockType> = new Set([...HOME_BUILT_IN_BLOCKS, "about"]);

export function customHeading(block: HomeBlock): string {
  return block.type === "divider" ? "" : (block.title?.trim() ?? "");
}

export function blockLabel(block: HomeBlock, plugins: Tuple<PluginManifest>, t: T): string {
  if (block.type === "plugin") {
    const plugin = plugins.find((candidate) => candidate.key === block.plugin);
    return (plugin && panelFor(plugin, block.panel)?.label) ?? plugin?.name ?? block.plugin;
  }
  return t(BLOCK_INFO[block.type].label);
}

function defaultTitle(block: HomeBlock, t: T): string {
  if (block.type === "plugin") return "";
  const key = BLOCK_INFO[block.type].title;
  return key ? t(key) : "";
}

const CALLOUT_STYLE: Record<CalloutTone, { icon: Icon; box: string; mark: string }> = {
  default: { icon: IconSpeakerphone, box: "border-border bg-accent", mark: "text-accent-fg" },
  info: { icon: IconInfoCircle, box: "border-primary/30 bg-primary/5", mark: "text-primary-text" },
  success: {
    icon: IconChecks,
    box: "border-emerald-500/40 bg-emerald-500/10",
    mark: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    icon: IconAlertTriangle,
    box: "border-warning/50 bg-warning/10",
    mark: "text-warning",
  },
};

function Picture({ image, className }: { image: HomeImage; className?: string }) {
  return (
    <img
      src={image.url}
      alt={image.alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn("w-full rounded-2xl border border-border object-cover", className)}
    />
  );
}

function Countdown({ to }: { to: string }) {
  const t = useT();
  const now = useNow(1000);
  if (now === null) return <div className="h-20" />;
  const left = Math.max(0, new Date(to).getTime() - now);
  const parts = [
    { label: t("countdown.days"), value: Math.floor(left / 86_400_000) },
    { label: t("countdown.hours"), value: Math.floor(left / 3_600_000) % 24 },
    { label: t("countdown.minutes"), value: Math.floor(left / 60_000) % 60 },
    { label: t("countdown.seconds"), value: Math.floor(left / 1000) % 60 },
  ];
  return (
    <div role="timer" aria-live="off" className="grid grid-cols-4 gap-2">
      {parts.map((part) => (
        <div
          key={part.label}
          className="flex flex-col items-center rounded-2xl border border-border bg-muted/40 py-3"
        >
          <span className="font-heading text-2xl font-semibold tabular-nums">
            {String(part.value).padStart(2, "0")}
          </span>
          <span className="text-xs text-muted-fg">{part.label}</span>
        </div>
      ))}
    </div>
  );
}

const KIND_LABEL = {
  hackathon: "facts.hackathon",
  contest: "facts.contest",
  custom: "facts.event",
} as const satisfies Record<Event["kind"], PlainKey>;

const FORMAT_LABEL = {
  "in-person": "facts.inPerson",
  online: "facts.online",
  hybrid: "facts.hybrid",
} as const;

function eventFacts(
  event: Event,
  time: FormatOptions,
  venue: ResolvedValue<"venue">,
  member: boolean,
  t: T,
): Fact[] {
  const team =
    event.team_size_max <= 1
      ? t("facts.solo")
      : event.team_size_min === event.team_size_max
        ? t("facts.people", { count: event.team_size_max })
        : t("facts.range", { min: event.team_size_min, max: event.team_size_max });
  return [
    { label: t("facts.kind"), value: t(KIND_LABEL[event.kind]) },
    {
      label: t("facts.when"),
      value: formatDateRange(event.starts_at, event.ends_at, time) || t("facts.tba"),
    },
    ...(venue.format ? [{ label: t("facts.format"), value: t(FORMAT_LABEL[venue.format]) }] : []),
    ...(event.location && venue.format !== "online"
      ? [
          {
            label: t("facts.where"),
            value: venue.mapUrl ? (
              <a href={venue.mapUrl} target="_blank" rel="noreferrer">
                {event.location}
              </a>
            ) : (
              event.location
            ),
          },
        ]
      : []),
    ...(member && venue.onlineUrl && venue.format !== "in-person"
      ? [
          {
            label: t("facts.onlineLabel"),
            value: (
              <a href={venue.onlineUrl} target="_blank" rel="noreferrer">
                {venue.onlineLabel || new URL(venue.onlineUrl).hostname}
              </a>
            ),
          },
        ]
      : []),
    { label: t("facts.teams"), value: team },
  ];
}

function Placeholder({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {title && <h2 className="font-heading text-lg font-semibold">{title}</h2>}
      <p className="text-sm text-muted-fg">{children}</p>
    </div>
  );
}

function AboutPending({ eventId, title }: { eventId: string; title: string }) {
  const t = useT();
  const { data } = useQuery(myRegistrationQueryOptions(eventId));
  const status = data?.registration?.status;
  if (status !== "pending" && status !== "waitlisted") return null;
  return (
    <Screen.Section title={title}>
      <p className="flex items-center gap-2 text-sm text-muted-fg">
        <IconLock className="size-4 shrink-0" />
        {t("home.aboutPending")}
      </p>
    </Screen.Section>
  );
}

function PrizesBlock({
  eventId,
  slug,
  title,
  customizing,
}: {
  eventId: string;
  slug: string;
  title: string;
  customizing: boolean;
}) {
  const t = useT();
  const { data: prizes = [] } = useQuery(eventPrizesQueryOptions(eventId));
  const image = usePrizeImage(eventId);
  if (prizes.length === 0) {
    return customizing ? (
      <Placeholder title={title}>
        <Linked
          text={t("home.prizesEmpty", { prizes: LINK })}
          links={[
            <SettingLink key="prizes" to={`/events/${slug}/manage/pages#prizes`}>
              {t("path.managePrizes")}
            </SettingLink>,
          ]}
        />
      </Placeholder>
    ) : null;
  }
  return (
    <Screen.Section
      title={title}
      actions={
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/events/$slug/prizes" params={{ slug }} />}
        >
          {t("home.allPrizes")}
        </Button>
      }
    >
      <ul className="flex flex-col gap-4">
        {prizes.slice(0, 4).map((prize) => (
          <li key={prize.id}>
            <PrizeCard prize={prize} image={image} />
          </li>
        ))}
      </ul>
    </Screen.Section>
  );
}

export function HomeBlockView({
  block,
  data,
  customizing = false,
}: {
  block: HomeBlock;
  data: HomeData;
  customizing?: boolean;
}) {
  const t = useT();
  const time = useTimeFormat();
  const { event } = data;
  const title = customHeading(block) || defaultTitle(block, t);

  switch (block.type) {
    case "next-steps":
      if (!data.competes) {
        return customizing ? (
          <Placeholder title={title}>{t("home.nextStepsEmpty")}</Placeholder>
        ) : null;
      }
      return <NextSteps event={event} access={data.access} windows={data.windows} title={title} />;

    case "agenda": {
      const visible = data.windows.filter(
        (window) => !data.schedule.hiddenWindows.includes(window.key),
      );
      const display = data.schedule.display;
      const milestones = display === "list" ? agendaMilestones(data.windows, data.schedule) : [];
      const empty =
        data.agenda.slots.length === 0 &&
        milestones.length === 0 &&
        (display === "hidden" || visible.length === 0);
      return (
        <Screen.Section
          title={title}
          actions={
            !empty && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/events/$slug/agenda" params={{ slug: event.slug }} />}
              >
                {t("home.fullAgenda")}
              </Button>
            )
          }
        >
          {empty ? (
            <p className="text-sm text-muted-fg">{t("home.agendaEmpty")}</p>
          ) : (
            <>
              {display === "timeline" && visible.length > 0 && (
                <Timeline items={timelineItems(visible)} />
              )}
              {display === "list" && <ScheduleList windows={visible} upcoming={false} />}
              {(data.agenda.slots.length > 0 || milestones.length > 0) && (
                <AgendaSummary agenda={data.agenda} milestones={milestones} />
              )}
            </>
          )}
        </Screen.Section>
      );
    }

    case "announcements": {
      const latest = data.announcements[0];
      const unread = data.announcements.filter((announcement) => !announcement.read).length;
      if (!latest && !data.manages) return null;
      return (
        <Screen.Section
          title={customHeading(block) || (latest ? title : t("announcements.title"))}
          actions={
            <div className="flex items-center gap-2 w-full sm:w-auto">
              {latest && (
                <Button
                  className="flex-1 sm:flex-none"
                  size="sm"
                  variant="outline"
                  render={
                    <Link
                      to="/events/$slug/messages"
                      params={{ slug: event.slug }}
                      search={{ c: ANNOUNCEMENTS }}
                    />
                  }
                  nativeButton={false}
                >
                  {t("eventTab.messages")}
                  {unread > 0 && ` (${unread})`}
                </Button>
              )}
              {data.manages && (
                <DialogTrigger
                  handle={newAnnouncement}
                  render={<Button className="flex-1 sm:flex-none" size="sm" />}
                >
                  {t("home.newAnnouncement")}
                </DialogTrigger>
              )}
            </div>
          }
        >
          {latest ? (
            <AnnouncementMessage announcement={latest} />
          ) : (
            <p className="text-sm text-muted-fg">{t("announcements.emptyManage")}</p>
          )}
        </Screen.Section>
      );
    }

    case "facts":
      return (
        <Screen.Section title={title}>
          <Facts
            facts={eventFacts(event, time, data.venue, !!data.access?.role || data.manages, t)}
          />
        </Screen.Section>
      );

    case "about": {
      const images = block.images ?? [];
      if (!data.about && images.length === 0) {
        if (customizing) {
          return (
            <Placeholder title={title}>
              <Linked
                text={t("home.aboutEmpty", { details: LINK })}
                links={[
                  <SettingLink
                    key="details"
                    to={`/events/${event.slug}/manage/details`}
                    hash="details.about"
                  >
                    {t("path.manageDetails")}
                  </SettingLink>,
                ]}
              />
            </Placeholder>
          );
        }
        return data.access?.role ? null : <AboutPending eventId={event.id} title={title} />;
      }
      return (
        <Screen.Section title={title}>
          {data.about && <Markdown>{data.about}</Markdown>}
          {images.length > 0 && (
            <div className={cn("grid gap-3", images.length > 1 && "sm:grid-cols-2")}>
              {images.map((image, index) => (
                <Picture
                  key={`${image.url}-${index}`}
                  image={image}
                  className={images.length > 1 ? "aspect-4/3" : "max-h-96"}
                />
              ))}
            </div>
          )}
        </Screen.Section>
      );
    }

    case "badge":
      if (!windowByKey(data.windows, "checkin") || !data.access?.role) {
        return customizing ? (
          <Placeholder title={title}>
            <Linked
              text={t("home.badgeOff", { agenda: LINK })}
              links={[
                <SettingLink key="agenda" to={`/events/${event.slug}/manage/agenda`} hash="windows">
                  {t("path.manageAgenda")}
                </SettingLink>,
              ]}
            />
          </Placeholder>
        ) : null;
      }
      return <BadgeCard eventId={event.id} endsAt={event.ends_at} />;

    case "prizes":
      return (
        <PrizesBlock eventId={event.id} slug={event.slug} title={title} customizing={customizing} />
      );

    case "pages":
      if (data.pages.length === 0) {
        return customizing ? <Placeholder title={title}>{t("home.pagesEmpty")}</Placeholder> : null;
      }
      return (
        <Screen.Section title={title}>
          <DisclosureList>
            {data.pages.map((page) => (
              <Link
                key={page.id}
                to="/events/$slug/pages/$page"
                params={{ slug: event.slug, page: page.slug }}
                className="flex items-center justify-between py-3 text-sm font-medium no-underline hocus:text-primary-text"
              >
                {page.title}
                <IconArrowUpRight className="size-4 text-muted-fg" />
              </Link>
            ))}
          </DisclosureList>
        </Screen.Section>
      );

    case "plugin": {
      const plugin = data.plugins.find((candidate) => candidate.key === block.plugin);
      const panel = plugin ? panelFor(plugin, block.panel) : undefined;
      if (!plugin || !panel) {
        return customizing ? (
          <Placeholder title={title || block.plugin}>{t("home.pluginOff")}</Placeholder>
        ) : null;
      }
      return (
        <div className="flex flex-col gap-4">
          {title && <h2 className="font-heading text-lg font-semibold">{title}</h2>}
          <PluginHomePanel
            manifest={plugin}
            panel={panel.key}
            eventId={event.id}
            session={data.session}
          />
        </div>
      );
    }

    case "text":
      if (!block.body.trim() && !title) {
        return customizing ? <Placeholder>{t("home.textEmpty")}</Placeholder> : null;
      }
      return title ? (
        <Screen.Section title={title}>
          <Markdown>{block.body}</Markdown>
        </Screen.Section>
      ) : (
        <Markdown>{block.body}</Markdown>
      );

    case "links":
      if (block.links.length === 0) {
        return customizing ? <Placeholder title={title}>{t("home.linksEmpty")}</Placeholder> : null;
      }
      return (
        <Screen.Section title={title}>
          <div className="flex flex-wrap gap-2">
            {block.links.map((link, index) => (
              <Button
                key={`${link.url}-${index}`}
                variant="outline"
                nativeButton={false}
                render={<a href={link.url} target="_blank" rel="noreferrer noopener" />}
              >
                {link.label}
                <IconExternalLink />
              </Button>
            ))}
          </div>
        </Screen.Section>
      );

    case "callout": {
      if (!block.body.trim() && !title) {
        return customizing ? <Placeholder>{t("home.calloutEmpty")}</Placeholder> : null;
      }
      const style = CALLOUT_STYLE[block.tone];
      const Mark = style.icon;
      return (
        <div className={cn("flex gap-3 rounded-2xl border px-4 py-3", style.box)}>
          <Mark className={cn("mt-0.5 size-5 shrink-0", style.mark)} aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {title && <h2 className="font-heading font-semibold">{title}</h2>}
            <Markdown>{block.body}</Markdown>
          </div>
        </div>
      );
    }

    case "faq":
      if (block.questions.length === 0) {
        return customizing ? <Placeholder title={title}>{t("home.faqEmpty")}</Placeholder> : null;
      }
      return (
        <Screen.Section title={title}>
          <DisclosureList>
            {block.questions.map((item, index) => (
              <DisclosureRow key={`${item.question}-${index}`} title={item.question}>
                <Markdown>{item.answer}</Markdown>
              </DisclosureRow>
            ))}
          </DisclosureList>
        </Screen.Section>
      );

    case "image": {
      if (!block.image.url) {
        return customizing ? <Placeholder title={title}>{t("home.imageEmpty")}</Placeholder> : null;
      }
      const figure = (
        <figure className="flex flex-col gap-2">
          <Picture image={block.image} className="max-h-112" />
          {block.caption && (
            <figcaption className="text-sm text-muted-fg">{block.caption}</figcaption>
          )}
        </figure>
      );
      return title ? <Screen.Section title={title}>{figure}</Screen.Section> : figure;
    }

    case "sponsors":
      if (block.sponsors.length === 0) {
        return customizing ? (
          <Placeholder title={title}>{t("home.sponsorsEmpty")}</Placeholder>
        ) : null;
      }
      return (
        <Screen.Section title={title}>
          <div className="@container">
            <ul className="grid grid-cols-2 gap-2 @md:grid-cols-3 @2xl:grid-cols-4">
              {block.sponsors.map((sponsor, index) => {
                const logo = (
                  <img
                    src={sponsor.logo}
                    alt={sponsor.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="max-h-12 w-full object-contain"
                  />
                );
                const tile =
                  "flex h-20 items-center justify-center rounded-2xl border border-border bg-white p-4 transition-[border-color,box-shadow]";
                return (
                  <li key={`${sponsor.name}-${index}`}>
                    {sponsor.url ? (
                      <a
                        href={sponsor.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={sponsor.name}
                        className={cn(tile, "hocus:border-primary/40 hocus:shadow-md")}
                      >
                        {logo}
                      </a>
                    ) : (
                      <div title={sponsor.name} className={tile}>
                        {logo}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Screen.Section>
      );

    case "countdown": {
      const at = block.to === "start" ? event.starts_at : event.ends_at;
      if (!at) {
        return customizing ? (
          <Placeholder title={title || t("block.countdown")}>
            <Linked
              text={
                block.to === "start"
                  ? t("home.countdownStart", { details: LINK })
                  : t("home.countdownEnd", { details: LINK })
              }
              links={[
                <SettingLink
                  key="details"
                  to={`/events/${event.slug}/manage/details`}
                  hash={block.to === "start" ? "details.startsAt" : "details.endsAt"}
                >
                  {t("path.manageDetails")}
                </SettingLink>,
              ]}
            />
          </Placeholder>
        ) : null;
      }
      return (
        <Screen.Section
          title={title || (block.to === "start" ? t("home.startsIn") : t("home.endsIn"))}
        >
          <Countdown to={at} />
        </Screen.Section>
      );
    }

    case "divider":
      return <Separator />;
  }
}
