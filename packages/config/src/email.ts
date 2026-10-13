import { templateVariables } from "@bogey/utils/email-template";

export interface EmailVariable {
  name: string;
  label: string;
  example: string;
}

export interface EmailKind {
  label: string;
  description: string;
  variables: Tuple<EmailVariable>;
  requires: Tuple<string>;
  reason: string;
  defaults: { subject: string; body: string };
}

const ORG: EmailVariable = {
  name: "org",
  label: "The organization's name",
  example: "Acme Hack Club",
};
const PLATFORM: EmailVariable = {
  name: "platform",
  label: "The platform's name",
  example: "Bogey",
};
const EMAIL: EmailVariable = {
  name: "email",
  label: "The person's email address",
  example: "ada@example.com",
};
const CODE: EmailVariable = { name: "code", label: "The one-time code", example: "000000" };
const LINK: EmailVariable = {
  name: "link",
  label: "The link that finishes it",
  example: "https://hacks.example.com/auth/confirm?token_hash=...",
};

const EVENT: EmailVariable = {
  name: "event",
  label: "The event's name",
  example: "Spring Hackathon",
};
const EVENT_LINK: EmailVariable = {
  name: "link",
  label: "A link to the event or the page the message is about",
  example: "https://hacks.example.com/events/spring",
};
const TITLE: EmailVariable = { name: "title", label: "The headline", example: "Lunch is ready" };
const BODY: EmailVariable = {
  name: "body",
  label: "The message text",
  example: "Come to the main hall.",
};
const NOTE: EmailVariable = {
  name: "note",
  label: "A message from the organizers, empty when there isn't one",
  example: "Bring a photo ID.",
};
const TEAM: EmailVariable = { name: "team", label: "The team's name", example: "Byte Me" };
const PROJECT: EmailVariable = {
  name: "project",
  label: "The project's title",
  example: "Trailmix",
};
const WHEN: EmailVariable = { name: "when", label: "The date and time", example: "Saturday 10:00" };

const EVENT_MAIL: Tuple<EmailVariable> = [EVENT, EVENT_LINK, ORG, PLATFORM, EMAIL];

export const EMAIL_KINDS = {
  signIn: {
    label: "Sign-in",
    description: "Sent when someone signs in.",
    variables: [CODE, LINK, ORG, PLATFORM, EMAIL],
    requires: ["code", "link"],
    reason: "someone asked to sign in to {{org}} with {{email}}",
    defaults: {
      subject: "Your {{org}} sign-in link",
      body: "# Sign in to {{org}}\n\nUse the button to sign in. It works once on any device.\n\n**[Sign in to {{org}}]({{link}})**\n\nIf the button doesn't work, copy this link into your browser:\n\n{{link}}\n\nOr enter this one-time passcode where you asked to sign in:\n\n`{{code}}`\n\nThe link and the passcode expire soon.",
    },
  },
  signUp: {
    label: "Account confirmation",
    description: "Sent when someone creates an account.",
    variables: [CODE, LINK, ORG, PLATFORM, EMAIL],
    requires: ["code", "link"],
    reason: "{{email}} was used to create an account on {{org}}",
    defaults: {
      subject: "Confirm your email for {{org}}",
      body: "# Welcome to {{org}}\n\nConfirm your email address to finish creating your account.\n\n**[Confirm my email]({{link}})**\n\nIf the button doesn't work, copy this link into your browser:\n\n{{link}}\n\nOr enter this one-time passcode where you signed up:\n\n`{{code}}`\n\nThe link and the passcode expire soon.",
    },
  },
  invite: {
    label: "Invitation",
    description: "Sent when someone is invited to create an account.",
    variables: [CODE, LINK, ORG, PLATFORM, EMAIL],
    requires: ["code", "link"],
    reason: "{{email}} was invited to {{org}}",
    defaults: {
      subject: "You're invited to {{org}}",
      body: "# You're invited to {{org}}\n\nAn account is waiting for you. Accept the invitation to finish setting it up.\n\n**[Accept the invitation]({{link}})**\n\nIf the button doesn't work, copy this link into your browser:\n\n{{link}}\n\nOr enter this one-time passcode where you sign in:\n\n`{{code}}`",
    },
  },
  emailChange: {
    label: "Email change",
    description: "Sent to confirm a new email address.",
    variables: [CODE, LINK, ORG, PLATFORM, EMAIL],
    requires: ["code", "link"],
    reason: "someone asked to change the email address on a {{org}} account to {{email}}",
    defaults: {
      subject: "Confirm your new email for {{org}}",
      body: "# Confirm your new email\n\nConfirm {{email}} as the new address for your {{org}} account.\n\n**[Confirm the new address]({{link}})**\n\nIf the button doesn't work, copy this link into your browser:\n\n{{link}}\n\nOr enter this one-time passcode:\n\n`{{code}}`\n\nIf you didn't ask for this, nothing changes.",
    },
  },
  reauthentication: {
    label: "Confirm it's you",
    description: "Sent before a sensitive change, to check it's really the account's owner.",
    variables: [CODE, ORG, PLATFORM, EMAIL],
    requires: ["code"],
    reason: "a sensitive change is being made to the {{org}} account for {{email}}",
    defaults: {
      subject: "Confirm it's you on {{org}}",
      body: "# Confirm it's you\n\nEnter this one-time passcode to continue:\n\n`{{code}}`\n\nThe passcode works once and expires soon.",
    },
  },
  "registration.received": {
    label: "Registration received",
    description: "Sent when someone registers and an organizer still has to approve them.",
    variables: EVENT_MAIL,
    requires: [],
    reason: "you registered for {{event}}",
    defaults: {
      subject: "You're registered for {{event}}",
      body: "# Registration received\n\nThanks for registering for {{event}}. The organizers will look at it soon, and we'll email you when there's news.\n\n**[Open {{event}}]({{link}})**",
    },
  },
  "registration.approved": {
    label: "Registration approved",
    description: "Sent when a registration is approved.",
    variables: [...EVENT_MAIL, NOTE],
    requires: [],
    reason: "your registration for {{event}} was approved",
    defaults: {
      subject: "You're in: {{event}}",
      body: "# You're in\n\nYour registration for {{event}} was approved. Find your team, the agenda and everything else on the event page.\n\n{{note}}\n\n**[Open {{event}}]({{link}})**",
    },
  },
  "registration.rejected": {
    label: "Registration declined",
    description: "Sent when a registration is declined.",
    variables: [...EVENT_MAIL, NOTE],
    requires: [],
    reason: "your registration for {{event}} was reviewed",
    defaults: {
      subject: "About your registration for {{event}}",
      body: "# About your registration\n\nThe organizers of {{event}} couldn't accept your registration this time. If you think that's a mistake, reply to the organizers.\n\n{{note}}",
    },
  },
  "registration.waitlisted": {
    label: "Waitlisted",
    description: "Sent when an event is full and someone joins the waitlist.",
    variables: [...EVENT_MAIL, NOTE],
    requires: [],
    reason: "you joined the waitlist for {{event}}",
    defaults: {
      subject: "You're on the waitlist for {{event}}",
      body: "# You're on the waitlist\n\n{{event}} is full right now. If a place opens up, you'll be moved in and we'll email you.\n\n{{note}}\n\n**[Open {{event}}]({{link}})**",
    },
  },
  "event.invite": {
    label: "Event invitation",
    description: "Sent when someone is invited to an event.",
    variables: EVENT_MAIL,
    requires: ["link"],
    reason: "{{email}} was invited to {{event}}",
    defaults: {
      subject: "You're invited to {{event}}",
      body: "# You're invited to {{event}}\n\n**[Accept the invitation]({{link}})**\n\nIf the button doesn't work, copy this link into your browser:\n\n{{link}}",
    },
  },
  "team.invite": {
    label: "Team invitation",
    description: "Sent when someone is invited to join a team.",
    variables: [TEAM, ...EVENT_MAIL],
    requires: ["link"],
    reason: "{{email}} was invited to join {{team}} for {{event}}",
    defaults: {
      subject: "Join {{team}} for {{event}}",
      body: "# Join {{team}}\n\nYou're invited to join the team {{team}} for {{event}}.\n\n**[Join the team]({{link}})**",
    },
  },
  "team.joined": {
    label: "Someone joined your team",
    description: "Sent to a team when a new member joins.",
    variables: [TEAM, { name: "member", label: "Who joined", example: "Ada" }, ...EVENT_MAIL],
    requires: [],
    reason: "someone joined your team for {{event}}",
    defaults: {
      subject: "{{member}} joined {{team}}",
      body: "# {{member}} joined {{team}}\n\nYour team for {{event}} has a new member.\n\n**[Open your team]({{link}})**",
    },
  },
  "judging.assigned": {
    label: "Projects to judge",
    description: "Sent to a judge when projects are assigned to them.",
    variables: [{ name: "count", label: "How many projects", example: "6" }, ...EVENT_MAIL],
    requires: ["link"],
    reason: "you're a judge for {{event}}",
    defaults: {
      subject: "{{count}} projects to judge for {{event}}",
      body: "# Projects to judge\n\nYou have {{count}} projects to judge for {{event}}.\n\n**[Open your queue]({{link}})**",
    },
  },
  "judging.advanced": {
    label: "Finalist",
    description: "Sent to a team when its project moves on to the next round.",
    variables: [PROJECT, ...EVENT_MAIL],
    requires: [],
    reason: "your team's project is entered in {{event}}",
    defaults: {
      subject: "You're a finalist at {{event}}",
      body: "# You're a finalist\n\nYour project moves on to the next round of judging at {{event}}.\n\n**[Open your submission]({{link}})**",
    },
  },
  "submission.received": {
    label: "Submission received",
    description: "Sent to a team when its project is submitted.",
    variables: [PROJECT, TEAM, ...EVENT_MAIL],
    requires: [],
    reason: "your team submitted a project to {{event}}",
    defaults: {
      subject: "Submitted: {{project}}",
      body: "# Submitted\n\n{{project}} is submitted to {{event}}. You can change it until the deadline.\n\n**[Open your submission]({{link}})**",
    },
  },
  "submission.deadline": {
    label: "Submission deadline",
    description: "Sent to teams that have only a draft as the deadline nears.",
    variables: [PROJECT, WHEN, ...EVENT_MAIL],
    requires: ["link"],
    reason: "your team has an unsubmitted project for {{event}}",
    defaults: {
      subject: "Submissions for {{event}} close {{when}}",
      body: "# Don't forget to submit\n\nSubmissions for {{event}} close {{when}}, and {{project}} is still a draft.\n\n**[Open your submission]({{link}})**",
    },
  },
  "results.published": {
    label: "Results published",
    description: "Sent to participants when results are published.",
    variables: [
      { name: "award", label: "The award they won, if any", example: "Best use of data" },
      ...EVENT_MAIL,
    ],
    requires: ["link"],
    reason: "results were published for {{event}}",
    defaults: {
      subject: "Results are in for {{event}}",
      body: "# Results are in\n\nThe results for {{event}} are published. {{award}}\n\n**[See the results]({{link}})**",
    },
  },
  announcement: {
    label: "Announcement",
    description: "Sent with an announcement when the organizer chooses to also email it.",
    variables: [TITLE, BODY, ...EVENT_MAIL],
    requires: [],
    reason: "{{event}} posted an announcement",
    defaults: {
      subject: "{{title}}",
      body: "# {{title}}\n\n{{body}}\n\n**[Open {{event}}]({{link}})**",
    },
  },
  "checkin.badge": {
    label: "Check-in badge",
    description: "Sent before the event with a link to the person's check-in code.",
    variables: [WHEN, ...EVENT_MAIL],
    requires: ["link"],
    reason: "you're registered for {{event}}",
    defaults: {
      subject: "Your check-in code for {{event}}",
      body: "# Your check-in code\n\n{{event}} starts {{when}}. Show your code at the desk when you arrive.\n\n**[Open my code]({{link}})**",
    },
  },
  "session.reminder": {
    label: "Session reminder",
    description: "Sent shortly before a session a person signed up for.",
    variables: [
      { name: "session", label: "The session's name", example: "Intro to APIs" },
      WHEN,
      ...EVENT_MAIL,
    ],
    requires: [],
    reason: "you signed up for a session at {{event}}",
    defaults: {
      subject: "Starting soon: {{session}}",
      body: "# {{session}} starts {{when}}\n\nYou signed up for this session at {{event}}.\n\n**[Open the agenda]({{link}})**",
    },
  },
  notification: {
    label: "Plugin notification",
    description: "Sent for notifications from plugins that don't have an email of their own.",
    variables: [TITLE, BODY, ...EVENT_MAIL],
    requires: [],
    reason: "{{event}} sent you a notification",
    defaults: {
      subject: "{{title}}",
      body: "# {{title}}\n\n{{body}}\n\n**[Open {{event}}]({{link}})**",
    },
  },
} as const satisfies Record<string, EmailKind>;

export type EmailTemplateKey = keyof typeof EMAIL_KINDS;

export const EMAIL_KIND_KEYS = Object.keys(EMAIL_KINDS) as Tuple<EmailTemplateKey>;

export const DEFAULT_EMAIL_TEMPLATES = Object.fromEntries(
  EMAIL_KIND_KEYS.map((key) => [key, EMAIL_KINDS[key].defaults]),
) as Record<EmailTemplateKey, { subject: string; body: string }>;

export const AUTH_EMAIL_KEYS = [
  "signIn",
  "signUp",
  "invite",
  "emailChange",
  "reauthentication",
] as const satisfies Tuple<EmailTemplateKey>;

export function emailTemplateProblem(
  kind: Pick<EmailKind, "requires" | "variables">,
  template: { subject: string; body: string },
): string | null {
  const { requires, variables } = kind;
  const used = new Set([
    ...templateVariables(template.subject),
    ...templateVariables(template.body),
  ]);
  const known = new Set(variables.map((variable) => variable.name));
  const unknown = [...used].filter((name) => !known.has(name));
  if (unknown.length) {
    return `${unknown.map((name) => `{{${name}}}`).join(", ")} isn't available here.`;
  }
  if (
    requires.length > 0 &&
    !requires.some((name) => templateVariables(template.body).includes(name))
  ) {
    const names = requires.map((name) => `{{${name}}}`);
    return `Include ${names.join(" or ")} in the message, or nobody can finish.`;
  }
  return null;
}
