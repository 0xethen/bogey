import { EMAIL_KINDS, type EmailTemplateKey } from "./email.ts";

export const NOTIFICATION_GROUPS = [
  "Registration",
  "Teams",
  "Judging",
  "Submissions",
  "Event",
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export interface NotificationKind {
  label: string;
  description: string;
  group: NotificationGroup;
  channels: { inApp: boolean; email: boolean };
  transactional: boolean;
  emailKind?: EmailTemplateKey;
}

export const NOTIFICATION_KINDS = {
  "registration.received": {
    label: "Registration received",
    description: "Your registration is waiting for an organizer.",
    group: "Registration",
    channels: { inApp: true, email: true },
    transactional: true,
    emailKind: "registration.received",
  },
  "registration.approved": {
    label: "Registration approved",
    description: "You're in.",
    group: "Registration",
    channels: { inApp: true, email: true },
    transactional: true,
    emailKind: "registration.approved",
  },
  "registration.rejected": {
    label: "Registration declined",
    description: "An organizer couldn't accept your registration.",
    group: "Registration",
    channels: { inApp: true, email: true },
    transactional: true,
    emailKind: "registration.rejected",
  },
  "registration.waitlisted": {
    label: "Waitlisted",
    description: "The event is full and you're on the waitlist.",
    group: "Registration",
    channels: { inApp: true, email: true },
    transactional: true,
    emailKind: "registration.waitlisted",
  },
  "team.joined": {
    label: "Someone joined your team",
    description: "A new member joined a team you're on.",
    group: "Teams",
    channels: { inApp: true, email: false },
    transactional: false,
    emailKind: "team.joined",
  },
  "team.left": {
    label: "Someone left your team",
    description: "A member left a team you're on.",
    group: "Teams",
    channels: { inApp: true, email: false },
    transactional: false,
    emailKind: "notification",
  },
  "team.request": {
    label: "Requests to join",
    description: "Someone asks to join a team you captain.",
    group: "Teams",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "notification",
  },
  "team.invited": {
    label: "Team invitations",
    description: "A team invites you to join.",
    group: "Teams",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "notification",
  },
  "team.answered": {
    label: "Answers to requests and invitations",
    description: "A team or person answered your request or invitation.",
    group: "Teams",
    channels: { inApp: true, email: false },
    transactional: false,
    emailKind: "notification",
  },
  "judging.assigned": {
    label: "Projects to judge",
    description: "Projects were assigned to you.",
    group: "Judging",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "judging.assigned",
  },
  "judging.advanced": {
    label: "Advanced to the next round",
    description: "Your project is a finalist.",
    group: "Judging",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "judging.advanced",
  },
  "submission.received": {
    label: "Submission received",
    description: "Your team's project was submitted.",
    group: "Submissions",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "submission.received",
  },
  "submission.deadline": {
    label: "Submission deadline",
    description: "Your team still has only a draft as the deadline nears.",
    group: "Submissions",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "submission.deadline",
  },
  "results.published": {
    label: "Results published",
    description: "The results are out.",
    group: "Submissions",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "results.published",
  },
  announcement: {
    label: "Announcements",
    description: "An organizer posted an announcement.",
    group: "Event",
    channels: { inApp: true, email: false },
    transactional: false,
    emailKind: "announcement",
  },
  "checkin.badge": {
    label: "Check-in code",
    description: "Your code for the check-in desk, before the event.",
    group: "Event",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "checkin.badge",
  },
  "certificate.issued": {
    label: "Certificates",
    description: "A certificate for you is ready.",
    group: "Event",
    channels: { inApp: true, email: true },
    transactional: false,
    emailKind: "notification",
  },
  "session.reminder": {
    label: "Session reminders",
    description: "A session you signed up for is about to start.",
    group: "Event",
    channels: { inApp: true, email: false },
    transactional: false,
    emailKind: "session.reminder",
  },
} as const satisfies Record<string, NotificationKind>;

export type NotificationKindKey = keyof typeof NOTIFICATION_KINDS;

export const NOTIFICATION_KIND_KEYS = Object.keys(NOTIFICATION_KINDS) as Tuple<NotificationKindKey>;

export function isNotificationKind(value: string): value is NotificationKindKey {
  return value in NOTIFICATION_KINDS;
}

export interface ChannelChoice {
  inApp?: boolean;
  email?: boolean;
}

export function notificationKindsForSql(): Record<
  string,
  { inApp: boolean; email: boolean; transactional: boolean; emailKind?: string }
> {
  return Object.fromEntries(
    NOTIFICATION_KIND_KEYS.map((key) => {
      const kind: NotificationKind = NOTIFICATION_KINDS[key];
      return [
        key,
        {
          inApp: kind.channels.inApp,
          email: kind.channels.email,
          transactional: kind.transactional,
          ...(kind.emailKind ? { emailKind: kind.emailKind } : {}),
        },
      ];
    }),
  );
}

export function missingEmailKinds(): string[] {
  return NOTIFICATION_KIND_KEYS.flatMap((key) => {
    const kind: NotificationKind = NOTIFICATION_KINDS[key];
    return kind.emailKind && !(kind.emailKind in EMAIL_KINDS) ? [key] : [];
  });
}
