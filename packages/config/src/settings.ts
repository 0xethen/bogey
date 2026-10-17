import { z } from "zod";
import { layoutProblem } from "@bogey/utils/email-layout";
import { SIGN_IN_PROVIDER_KEYS } from "./sign-in.ts";

export { DEFAULT_EMAIL_TEMPLATES, type EmailTemplateKey } from "./email.ts";

export type SettingScope = "instance" | "org" | "event";

export interface SettingOption<V> {
  value: V;
  label: string;
  description?: string;
}

export interface SettingField<V> {
  label: string;
  description?: string;
  options?: Tuple<SettingOption<NonNullable<V>>>;
  placeholder?: string;
}

export type SettingFields<T> = { [K in keyof T]?: SettingField<T[K]> };

export interface SettingsNamespace<S extends z.ZodObject, D extends Partial<z.infer<S>>> {
  label: string;
  scopes: Tuple<SettingScope>;
  defaults: D;
  schema: S;
  fields?: SettingFields<z.infer<S>>;
  operator?: Tuple<keyof z.infer<S> & string>;
}

function namespace<S extends z.ZodObject, const D extends Partial<z.infer<S>>>(
  definition: SettingsNamespace<S, D>,
): SettingsNamespace<S, D> {
  return definition;
}

export const EMAIL_TEMPLATE_KEY =
  /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-z][a-z0-9_-]*)*(@[a-z]{2,3}(-[A-Za-z0-9]+)*)?$/;

export const emailTemplate = z.object({
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(5000),
});

export const networkAddress = z.union(
  [z.cidrv4(), z.cidrv6(), z.ipv4(), z.ipv6()],
  "Use an address or range like 168.9.212.0/23",
);

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, "Use a hex color like #1f6feb");

export const SESSION_KIND_TONES = [
  "gray",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;
export type SessionKindTone = (typeof SESSION_KIND_TONES)[number];

export const SESSION_KIND_ICONS = [
  "calendar",
  "presentation",
  "tools",
  "meal",
  "coffee",
  "confetti",
  "door",
  "gavel",
  "clock",
  "microphone",
  "code",
  "users",
  "trophy",
  "bulb",
  "flag",
  "music",
  "moon",
  "gamepad",
  "heart",
  "star",
] as const;
export type SessionKindIcon = (typeof SESSION_KIND_ICONS)[number];

export const sessionKindSchema = z.object({
  key: z
    .string()
    .max(60)
    .regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)?$/, "Lowercase letters, digits and dashes"),
  label: z.string().trim().min(1, "Give it a name").max(40, "Keep it under 40 characters"),
  tone: z.enum(SESSION_KIND_TONES),
  icon: z.enum(SESSION_KIND_ICONS),
});
export type SessionKind = z.infer<typeof sessionKindSchema>;

export const HOME_BUILT_IN_BLOCKS = [
  "next-steps",
  "agenda",
  "announcements",
  "facts",
  "prizes",
  "pages",
  "badge",
] as const;
export type HomeBuiltInBlock = (typeof HOME_BUILT_IN_BLOCKS)[number];

export const HOME_CUSTOM_BLOCKS = [
  "text",
  "callout",
  "faq",
  "image",
  "sponsors",
  "links",
  "countdown",
  "divider",
] as const;

export const CALLOUT_TONES = ["info", "success", "warning"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

const blockId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const blockTitle = z.string().trim().max(80, "Keep it under 80 characters").optional();
const webAddress = z.url({
  protocol: /^https?$/,
  error: "Use a full web address, like https://...",
});
export const homeImageSchema = z.object({
  url: webAddress,
  alt: z.string().trim().max(200, "Keep it under 200 characters"),
});
export type HomeImage = z.infer<typeof homeImageSchema>;

export const homeBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: blockId, type: z.enum(HOME_BUILT_IN_BLOCKS), title: blockTitle }),
  z.object({
    id: blockId,
    type: z.literal("about"),
    title: blockTitle,
    images: z.array(homeImageSchema).max(12, "Up to 12 images").optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("plugin"),
    title: blockTitle,
    plugin: z.string().max(32),
    panel: z.string().max(41).optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("text"),
    title: blockTitle,
    body: z.string().max(20_000, "Keep it under 20,000 characters"),
  }),
  z.object({
    id: blockId,
    type: z.literal("callout"),
    title: blockTitle,
    tone: z.enum(CALLOUT_TONES),
    body: z.string().max(2_000, "Keep it under 2,000 characters"),
  }),
  z.object({
    id: blockId,
    type: z.literal("faq"),
    title: blockTitle,
    questions: z
      .array(
        z.object({
          question: z.string().trim().min(1, "Write the question").max(200),
          answer: z.string().max(4_000, "Keep it under 4,000 characters"),
        }),
      )
      .max(20, "Up to 20 questions"),
  }),
  z.object({
    id: blockId,
    type: z.literal("image"),
    title: blockTitle,
    image: homeImageSchema,
    caption: z.string().trim().max(300, "Keep it under 300 characters").optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("sponsors"),
    title: blockTitle,
    sponsors: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Give the sponsor a name").max(80),
          logo: webAddress,
          url: webAddress.optional(),
        }),
      )
      .max(40, "Up to 40 sponsors"),
  }),
  z.object({
    id: blockId,
    type: z.literal("links"),
    title: blockTitle,
    links: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Give the link a label").max(60),
          url: webAddress,
        }),
      )
      .max(12, "Up to 12 links"),
  }),
  z.object({
    id: blockId,
    type: z.literal("countdown"),
    title: blockTitle,
    to: z.enum(["start", "end"]),
  }),
  z.object({ id: blockId, type: z.literal("divider") }),
]);
export type HomeBlock = z.infer<typeof homeBlockSchema>;

const withoutRetiredBlocks = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.filter(
        (block) =>
          !(
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            (block.type === "plugins" || block.type === "briefing")
          ),
      )
    : value;

export const homeLayoutSchema = z.object({
  main: z.preprocess(withoutRetiredBlocks, z.array(homeBlockSchema).max(30)),
  aside: z.preprocess(withoutRetiredBlocks, z.array(homeBlockSchema).max(30)),
});
export type HomeLayout = z.infer<typeof homeLayoutSchema>;

export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  main: [
    { id: "next-steps", type: "next-steps" },
    { id: "agenda", type: "agenda" },
  ],
  aside: [
    { id: "announcements", type: "announcements" },
    { id: "facts", type: "facts" },
    { id: "prizes", type: "prizes" },
    { id: "about", type: "about" },
  ],
};

export const settingsRegistry = {
  branding: namespace({
    label: "Branding",
    scopes: ["instance", "org", "event"],
    defaults: {},
    schema: z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe("Name shown in the header and emails"),
      shortName: z
        .string()
        .trim()
        .min(1)
        .max(24)
        .optional()
        .describe("Shorter name for tight spaces"),
      accent: hex.optional().describe("Accent color"),
    }),
    fields: {
      name: { label: "Name" },
      shortName: {
        label: "Short name",
        description: "Used where space is tight, like breadcrumbs.",
      },
    },
  }),
  registration: namespace({
    label: "Registration",
    scopes: ["instance", "org", "event"],
    defaults: { signup: "invite", mode: "review", capacity: 0, autoPromote: true },
    schema: z.object({
      signup: z.enum(["open", "invite", "closed"]).optional(),
      capacity: z
        .number()
        .int()
        .min(0)
        .max(100_000)
        .optional()
        .describe(
          "How many participants an event takes; later registrations join the waitlist. 0 has no limit",
        ),
      autoPromote: z
        .boolean()
        .optional()
        .describe("Move the next person on the waitlist in when a place opens"),
      mode: z
        .enum(["open", "review", "invite"])
        .optional()
        .describe(
          "How event registrations are handled: approved at once, reviewed, or invite links only",
        ),
    }),
    fields: {
      capacity: {
        label: "Participant limit",
        description:
          "Once this many participants are approved, new registrations join the waitlist. 0 has no limit.",
        placeholder: "0",
      },
      autoPromote: {
        label: "Move people up the waitlist",
        description:
          "When someone withdraws or is declined, the person waiting longest is approved.",
      },
      signup: {
        label: "Who can create an account",
        options: [
          { value: "open", label: "Anyone" },
          { value: "invite", label: "People invited or imported to an event" },
          { value: "closed", label: "No one new" },
        ],
      },
      mode: {
        label: "Who can join an event",
        description: "Applies while registration is open. Invite links work in every mode.",
        options: [
          {
            value: "open",
            label: "Anyone can join",
            description: "Registrations are approved at once",
          },
          {
            value: "review",
            label: "Organizers approve",
            description: "Each registration waits for review",
          },
          {
            value: "invite",
            label: "Invite only",
            description: "Only invite links and invited people",
          },
        ],
      },
    },
  }),
  email: namespace({
    label: "Email",
    scopes: ["instance", "org", "event"],
    defaults: {},
    schema: z.object({
      senderName: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .optional()
        .describe("Sender name on sign-in emails"),
      templates: z
        .record(z.string().regex(EMAIL_TEMPLATE_KEY).max(80), emailTemplate)
        .optional()
        .describe("Subject and Markdown body of emails Bogey sends"),
      layout: z
        .string()
        .max(50_000)
        .refine((layout) => layoutProblem(layout) === null, "The layout needs {{content}}")
        .optional()
        .describe("The HTML every email is rendered into; only the instance's counts"),
    }),
  }),
  tenancy: namespace({
    label: "Tenancy",
    scopes: ["instance"],
    defaults: {},
    operator: ["appUrl"],
    schema: z.object({
      defaultOrg: z.uuid().optional().describe("Org used when a host matches no domain"),
      appUrl: webAddress
        .optional()
        .describe(
          "Where the database reaches this app to send queued email, e.g. https://hacks.example.com",
        ),
    }),
    fields: {
      appUrl: {
        label: "App address",
        description:
          "The address the database calls to send Bogey's own email (registrations, invitations, results). Without it, queued email waits.",
        placeholder: "https://hacks.example.com",
      },
    },
  }),
  accounts: namespace({
    label: "Accounts",
    scopes: ["instance"],
    defaults: {
      deletionRequests: true,
      requireAdminMfa: true,
      portfolios: false,
      deviceSignOut: false,
    },
    operator: ["requireAdminMfa", "deviceSignOut"],
    schema: z.object({
      portfolios: z
        .boolean()
        .optional()
        .describe("People can have a public page at /@handle with their projects and awards"),
      deletionRequests: z
        .boolean()
        .optional()
        .describe("Let people ask for their account to be deleted from Account settings"),
      requireAdminMfa: z
        .boolean()
        .optional()
        .describe("Instance admins need an authenticator app before they can use Instance pages"),
      deviceSignOut: z
        .boolean()
        .optional()
        .describe("People can sign out one of their other devices, or all of them, from Account"),
    }),
    fields: {
      portfolios: {
        label: "Public pages",
        description:
          "People can set a handle on Account for a page at /@handle with their projects, awards and the events they came to.",
      },
      deletionRequests: {
        label: "Deletion requests",
        description:
          "People can ask for their account to be deleted from Account settings. Requests wait for an admin under Deletions.",
      },
      deviceSignOut: {
        label: "Sign out other devices",
        description:
          "People can sign out one of their other devices, or all of them, from Account > Security. Set security.deviceSignOut in bogey.config.ts.",
      },
      requireAdminMfa: {
        label: "Two-factor for instance admins",
        description:
          "Instance admins must verify an authenticator app code each session before being granted access to the database. Turn off from the CLI with bogey mfa off!",
      },
    },
  }),
  signin: namespace({
    label: "Sign-in methods",
    scopes: ["instance", "org"],
    defaults: { providers: [] },
    schema: z.object({
      providers: z
        .array(z.enum(SIGN_IN_PROVIDER_KEYS))
        .optional()
        .describe(
          "Sign-in providers offered besides email. An organization's list narrows the instance's",
        ),
    }),
  }),
  audit: namespace({
    label: "Audit log",
    scopes: ["instance", "org"],
    defaults: { retentionDays: 60 },
    schema: z.object({
      retentionDays: z.int().min(30).max(3650).optional().describe("Days to keep audit entries"),
    }),
    fields: {
      retentionDays: {
        label: "Keep audit entries for (days)",
        description: "Older entries are deleted each night (minimum 30 days to prevent tampering).",
      },
    },
  }),
  access: namespace({
    label: "Network access",
    scopes: ["org", "event"],
    defaults: { allowedNetworks: [], onlyUsers: [], onlyTeams: [], onlyDivisions: [] },
    schema: z.object({
      allowedNetworks: z
        .array(networkAddress)
        .max(200)
        .optional()
        .describe(
          "Participants can only take part in the event from these networks; empty allows any",
        ),
      onlyUsers: z
        .array(z.uuid())
        .max(500)
        .optional()
        .describe("Limit only these people to the networks; with no teams or divisions, everyone"),
      onlyTeams: z
        .array(z.uuid())
        .max(500)
        .optional()
        .describe("Limit only the members of these teams to the networks"),
      onlyDivisions: z
        .array(z.uuid())
        .max(100)
        .optional()
        .describe("Limit only the members of these divisions to the networks"),
    }),
  }),
  network: namespace({
    label: "Client IPs",
    scopes: ["instance"],
    defaults: { clientIpHeader: "x-forwarded-for", trustedHops: 1, trustedProxies: [] },
    operator: ["clientIpHeader", "trustedHops", "trustedProxies"],
    schema: z.object({
      clientIpHeader: z
        .enum(["x-forwarded-for", "cf-connecting-ip", "x-real-ip"])
        .optional()
        .describe("Where the database reads a visitor's IP"),
      trustedHops: z
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Proxies in front of Supabase that append to X-Forwarded-For"),
      trustedProxies: z
        .array(networkAddress)
        .max(50)
        .optional()
        .describe("The app server's addresses, whose forwarded visitor IP is trusted"),
    }),
    fields: {
      clientIpHeader: {
        label: "Visitor IP comes from",
        options: [
          {
            value: "x-forwarded-for",
            label: "X-Forwarded-For",
            description: "Self-hosted Supabase behind your own proxies",
          },
          {
            value: "cf-connecting-ip",
            label: "CF-Connecting-IP",
            description: "Behind Cloudflare",
          },
          {
            value: "x-real-ip",
            label: "X-Real-IP",
            description: "Only if your proxy overwrites it",
          },
        ],
      },
      trustedHops: { label: "Proxies in front of Supabase" },
    },
  }),
  seo: namespace({
    label: "Search engines",
    scopes: ["instance", "org"],
    defaults: { indexing: true },
    schema: z.object({
      indexing: z.boolean().optional().describe("Let search engines list public pages"),
      description: z
        .string()
        .trim()
        .max(200)
        .optional()
        .describe("Description for search results and link previews"),
    }),
    fields: {
      indexing: {
        label: "Show in search engines",
        description:
          "Public pages like sign-in, join links and project galleries. Signed-in pages are never listed.",
      },
      description: {
        label: "Description",
        description: "Shown under the name in search results and link previews.",
        placeholder: "Hackathons and competitions, run on Bogey.",
      },
    },
  }),
  limits: namespace({
    label: "Limits",
    scopes: ["instance"],
    defaults: {},
    schema: z.object({
      eventsPerOrg: z
        .int()
        .min(1)
        .max(100_000)
        .optional()
        .describe("Most events one organization can have"),
      adminsPerOrg: z
        .int()
        .min(1)
        .max(100_000)
        .optional()
        .describe("Most owners and admins one organization can have"),
      participantsPerEvent: z
        .int()
        .min(1)
        .max(1_000_000)
        .optional()
        .describe("Most participants one event can have"),
      emailsPerDay: z
        .int()
        .min(1)
        .max(10_000_000)
        .optional()
        .describe("Most emails Bogey sends for one organization in a day"),
      storageMbPerOrg: z
        .int()
        .min(1)
        .max(100_000_000)
        .optional()
        .describe("Most megabytes of uploads one organization can keep"),
      maxUploadMb: z
        .int()
        .min(1)
        .max(10_000)
        .optional()
        .describe("Largest single file, in megabytes, anyone in one organization can upload"),
      customDomainsPerOrg: z
        .int()
        .min(1)
        .max(1_000)
        .optional()
        .describe("Most hostnames one organization can have"),
      pendingInvitesPerOrg: z
        .int()
        .min(1)
        .max(100_000)
        .optional()
        .describe("Most open invite links one organization can have"),
    }),
    fields: {
      eventsPerOrg: { label: "Events per organization", placeholder: "No limit" },
      adminsPerOrg: { label: "Owners and admins per organization", placeholder: "No limit" },
      participantsPerEvent: { label: "Participants per event", placeholder: "No limit" },
      emailsPerDay: { label: "Emails per organization per day", placeholder: "No limit" },
      storageMbPerOrg: { label: "Storage per organization (MB)", placeholder: "No limit" },
      maxUploadMb: { label: "Largest upload (MB)", placeholder: "No limit" },
      customDomainsPerOrg: { label: "Hostnames per organization", placeholder: "No limit" },
      pendingInvitesPerOrg: {
        label: "Open invite links per organization",
        placeholder: "No limit",
      },
    },
  }),
  submissions: namespace({
    label: "Submissions",
    scopes: ["instance", "org", "event"],
    defaults: { autoSubmit: false, deletion: "allow", reminderHours: 24, publicToggle: false },
    schema: z.object({
      autoSubmit: z.boolean().optional().describe("Submit complete drafts when submissions close"),
      maxTracks: z
        .number()
        .int()
        .min(1)
        .max(40)
        .optional()
        .describe("Most prizes a team can enter its project in; unset means any number"),
      reminderHours: z
        .number()
        .int()
        .min(0)
        .max(336)
        .optional()
        .describe(
          "Remind teams that only have a draft this many hours before submissions close; 0 sends none",
        ),
      publicToggle: z
        .boolean()
        .optional()
        .describe("Whether teams can choose to hide their submission from the public gallery"),
      deletion: z
        .enum(["none", "request", "allow"])
        .optional()
        .describe("Whether teams can delete their submissions, or ask organizers to"),
    }),
    fields: {
      reminderHours: {
        label: "Remind teams with a draft (hours before)",
        description: "Teams that only have an unsubmitted draft get one reminder. 0 sends none.",
        placeholder: "24",
      },
      maxTracks: {
        label: "Most prizes a team can enter",
        description:
          "Teams choose prizes on their submission. Organizers can always place entries.",
        placeholder: "Any number",
      },
      deletion: {
        label: "Who can delete a submission",
        description: "Organizers can always delete from Submissions.",
        options: [
          {
            value: "allow",
            label: "Teams can delete their own",
          },
          {
            value: "request",
            label: "Teams can ask organizers",
          },
          {
            value: "none",
            label: "Organizers only",
          },
        ],
      },
      publicToggle: {
        label: "Teams choose gallery visibility",
        description:
          "Off keeps every submission as it is: teams see the gallery switch but can't change it.",
      },
      autoSubmit: {
        label: "Submit complete drafts at close",
        description:
          "Drafts with every required item filled in are submitted when the form closes.",
      },
    },
  }),
  schedule: namespace({
    label: "Schedule",
    scopes: ["instance", "org", "event"],
    defaults: { display: "list", hiddenWindows: [], showEventTimezone: false },
    schema: z.object({
      showEventTimezone: z
        .boolean()
        .optional()
        .describe("Show times in the event's timezone, named, instead of each viewer's own"),
      display: z
        .enum(["hidden", "list", "timeline"])
        .optional()
        .describe("How the event home and agenda show windows to participants"),
      hiddenWindows: z
        .array(z.string().regex(/^[a-z][a-z0-9.-]*$/))
        .max(50)
        .optional()
        .describe("Windows participants never see listed"),
      countdownLabel: z
        .string()
        .max(40, "Keep it under 40 characters")
        .optional()
        .describe("The words before the time left in the header, on tablets and computers"),
    }),
    fields: {
      countdownLabel: {
        label: "Countdown label",
        placeholder: "Submissions close in",
        description:
          'Shown before the time left in the header while submissions are open, on tablets and computers. Phones show only the time. Empty uses "Submissions close in".',
      },
      showEventTimezone: {
        label: "Times in the event's timezone",
        description:
          'For in-person events: everyone sees times where the event is, like "8:00 PM EDT". Off, each person sees their own time.',
      },
      display: {
        label: "Windows participants see",
        options: [
          {
            value: "list",
            label: "What's open and next",
            description: "On the event home, and their dates on the agenda",
          },
          {
            value: "timeline",
            label: "Full timeline",
            description: "Every window on a time axis, and their dates on the agenda",
          },
          {
            value: "hidden",
            label: "Don't show",
            description: "Not on the event home or the agenda",
          },
        ],
      },
    },
  }),
  agenda: namespace({
    label: "Agenda",
    scopes: ["instance", "org", "event"],
    defaults: { kinds: [], reminderMinutes: 30 },
    schema: z.object({
      kinds: z
        .array(sessionKindSchema)
        .max(40)
        .optional()
        .describe("Session types, like Talk and Workshop, each with a color and icon"),
      reminderMinutes: z
        .number()
        .int()
        .min(0)
        .max(1440)
        .optional()
        .describe(
          "Remind people this many minutes before a session they signed up for; 0 sends none",
        ),
    }),
    fields: {
      reminderMinutes: {
        label: "Remind people (minutes before)",
        description: "Sent for sessions people signed up for. 0 sends none.",
        placeholder: "30",
      },
    },
  }),
  home: namespace({
    label: "Event home",
    scopes: ["org", "event"],
    defaults: { layout: DEFAULT_HOME_LAYOUT },
    schema: z.object({
      layout: homeLayoutSchema.optional().describe("The blocks on the event home, in two columns"),
    }),
  }),
  identity: namespace({
    label: "Identity setup",
    scopes: ["instance", "org", "event"],
    defaults: { enabled: false },
    schema: z.object({
      enabled: z
        .boolean()
        .optional()
        .describe(
          "Walk participants through confirming their name and setting up a team the first time they open the event",
        ),
    }),
    fields: {
      enabled: {
        label: "Identity setup",
        description:
          "Welcome new participants with Initial Setup. The first time a participant opens the event, they confirm their name (it starts as the first part of their email address) and set up a team before anything else.",
      },
    },
  }),
  chat: namespace({
    label: "Messages",
    scopes: ["instance", "org", "event"],
    defaults: { enabled: true, staff: true, participants: true, judges: false, copyTeam: true },
    schema: z.object({
      enabled: z.boolean().optional().describe("Messages on for the event"),
      staff: z.boolean().optional().describe("Organizers and judges can message each other"),
      participants: z.boolean().optional().describe("Participants can message organizers"),
      judges: z.boolean().optional().describe("Participants and judges can message each other"),
      copyTeam: z
        .boolean()
        .optional()
        .describe("A participant's conversations include their whole team"),
    }),
    fields: {
      enabled: {
        label: "Messages",
        description: "Turns messaging on for the event. Choose who can talk to whom below.",
      },
      staff: {
        label: "Organizers and judges",
        description: "Organizers and judges can message each other.",
      },
      participants: {
        label: "Participants and organizers",
        description: "Participants can message organizers.",
      },
      judges: {
        label: "Participants and judges",
        description:
          "Participants can message judges, and judges can start a conversation with a team (unless judging is blind). Organizers see these conversations.",
      },
      copyTeam: {
        label: "Include the whole team",
        description: "Teammates see and can reply to each other's conversations.",
      },
    },
  }),
  certificates: namespace({
    label: "Certificates",
    scopes: ["org", "event"],
    defaults: { enabled: false },
    schema: z.object({
      enabled: z
        .boolean()
        .optional()
        .describe(
          "People can claim certificates for this event: taking part, awards, judging and helping",
        ),
    }),
    fields: {
      enabled: {
        label: "Certificates",
        description:
          "Lets participants, judges and staff claim a certificate from the event's Certificates page. Organizers can also issue them all at once.",
      },
    },
  }),
  announcements: namespace({
    label: "Announcements",
    scopes: ["instance", "org", "event"],
    defaults: { toasts: true, urgentStays: true, postAs: "author", judges: false },
    schema: z.object({
      toasts: z
        .boolean()
        .optional()
        .describe("Pop up new announcements for people who have the event open"),
      urgentStays: z
        .boolean()
        .optional()
        .describe("Urgent pop-ups stay on screen until they're dismissed"),
      postAs: z
        .enum(["author", "organizers"])
        .optional()
        .describe("Whose name new announcements carry unless the poster changes it"),
      judges: z.boolean().optional().describe("Judges can post announcements too"),
    }),
    fields: {
      toasts: {
        label: "Show notifications",
        description:
          "People with the event open see a new announcement pop up in the corner, wherever they are in the event.",
      },
      urgentStays: {
        label: "Urgents persist",
        description: "Urgent announcements stay on screen until dismissed, instead of fading.",
      },
      postAs: {
        label: "Posted as",
        description: "The default in the composer. Organizers always see who posted.",
        options: [
          { value: "author", label: "The organizer who posts it" },
          { value: "organizers", label: "The organizers, without a name" },
        ],
      },
      judges: {
        label: "Judges can post",
        description:
          "Judges can post announcements from Messages, always under their own name. Only organizers can delete them.",
      },
    },
  }),
  teams: namespace({
    label: "Teams",
    scopes: ["instance", "org", "event"],
    defaults: {
      disband: "captain",
      board: true,
      switching: true,
      askOrganizer: true,
      creation: "participants",
      leaveLimit: 0,
    },
    schema: z.object({
      disband: z
        .enum(["none", "captain", "members"])
        .optional()
        .describe("Who on a team can disband it while teams are open"),
      switching: z
        .boolean()
        .optional()
        .describe("Participants can leave their team to join or start another"),
      leaveLimit: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe("How many times one participant can leave a team; 0 means no limit"),
      creation: z.enum(["participants", "organizers"]).optional().describe("Who can start a team"),
      askOrganizer: z
        .boolean()
        .optional()
        .describe("Participants who can't switch teams are pointed to message the organizers"),
      board: z
        .boolean()
        .optional()
        .describe("Participants find teams and teammates on the Team page"),
    }),
    fields: {
      switching: {
        label: "Let people switch teams",
        description:
          "Participants can leave their team and join or start another while teams are open. Turn this off to stop people from making endless teams; organizers can still move anyone in Manage > Teams.",
      },
      leaveLimit: {
        label: "Times someone can leave a team",
        description:
          "Stops people from leaving and starting team after team. Disbanding counts too. 0 means no limit; organizers can still move anyone.",
        placeholder: "0",
      },
      creation: {
        label: "Who can start a team",
        options: [
          { value: "participants", label: "Participants" },
          {
            value: "organizers",
            label: "Organizers only",
            description: "Participants join the teams you set up, with their codes",
          },
        ],
      },
      askOrganizer: {
        label: "Point to Messages when switching is off",
        description:
          "Someone on the wrong team is offered a link to message the organizers, as long as Messages lets participants write to them. Otherwise they're just told to ask an organizer.",
      },
      board: {
        label: "Team board",
        description:
          "People without a team say what they're good at, teams say what they need, and they ask or invite each other on the Team page. Organizers can match everyone left over in Manage > Teams either way.",
      },
      disband: {
        label: "Who can disband a team",
        description:
          "Disbanding removes everyone from the team and deletes it, while teams are open. Organizers can always remove teams.",
        options: [
          { value: "captain", label: "Its captain" },
          { value: "members", label: "Anyone on it" },
          { value: "none", label: "Organizers only" },
        ],
      },
    },
  }),
  divisions: namespace({
    label: "Divisions",
    scopes: ["instance", "org", "event"],
    defaults: { askOnJoin: true },
    schema: z.object({
      askOnJoin: z
        .boolean()
        .optional()
        .describe("Participants without a division pick one the first time they open the event"),
    }),
    fields: {
      askOnJoin: {
        label: "Ask when they join",
        description:
          "Participants without a division pick one the first time they open the event. Turn off when divisions come from your roster, or you'll assign them.",
      },
    },
  }),
  venue: namespace({
    label: "Format and venue",
    scopes: ["org", "event"],
    defaults: {},
    schema: z.object({
      format: z.enum(["in-person", "online", "hybrid"]).optional(),
      mapUrl: webAddress.optional().describe("A map or directions link for the venue"),
      onlineUrl: webAddress
        .optional()
        .describe("Where people meet online, like a Discord server or a call link"),
      onlineLabel: z.string().trim().max(40, "Keep it under 40 characters").optional(),
    }),
    fields: {
      format: {
        label: "Format",
        options: [
          { value: "in-person", label: "In person", description: "Everyone is at a venue" },
          { value: "online", label: "Online", description: "Everyone takes part remotely" },
          { value: "hybrid", label: "Hybrid", description: "At a venue, and remotely too" },
        ],
      },
      mapUrl: {
        label: "Directions link",
        description: "Shown beside the location (in Details) on the event home.",
        placeholder: "https://maps.app.goo.gl/...",
      },
      onlineUrl: {
        label: "Online link",
        description: "Shown to members only, never on public pages.",
        placeholder: "https://discord.gg/...",
      },
      onlineLabel: { label: "Online link name", placeholder: "Discord" },
    },
  }),
  privacy: namespace({
    label: "Before approval",
    scopes: ["instance", "org", "event"],
    defaults: { about: "members", agenda: "members", tracks: "public" },
    schema: z.object({
      about: z
        .enum(["public", "members"])
        .optional()
        .describe("Whether people who aren't approved yet can read About"),
      agenda: z
        .enum(["public", "members"])
        .optional()
        .describe("Whether people who aren't approved yet can see the agenda"),
      tracks: z
        .enum(["public", "members"])
        .optional()
        .describe("Whether people who aren't approved yet can see tracks and prizes"),
    }),
    fields: {
      about: {
        label: "About",
        description:
          "The event's About text. For text everyone sees, add a Text block to the homepage instead.",
        options: [
          { value: "members", label: "Members only", description: "Once they're approved" },
          { value: "public", label: "Everyone who can see the event" },
        ],
      },
      agenda: {
        label: "Agenda",
        description: "Sessions, times, rooms and hosts.",
        options: [
          { value: "members", label: "Members only", description: "Once they're approved" },
          { value: "public", label: "Everyone who can see the event" },
        ],
      },
      tracks: {
        label: "Tracks and prizes",
        options: [
          { value: "public", label: "Everyone who can see the event" },
          { value: "members", label: "Members only", description: "Once they're approved" },
        ],
      },
    },
  }),
  about: namespace({
    label: "About",
    scopes: ["event"],
    defaults: {},
    schema: z.object({
      body: z
        .string()
        .max(20_000, "Keep it under 20,000 characters")
        .optional()
        .describe("About the event, on its home; members only unless privacy.about shares it"),
    }),
  }),
  checkin: namespace({
    label: "Check-in",
    scopes: ["instance", "org", "event"],
    defaults: {
      confirmName: true,
      allowWalkIns: false,
      badgeEmailHours: 24,
      requiredToCompete: false,
    },
    schema: z.object({
      confirmName: z
        .boolean()
        .optional()
        .describe("Show each person's name at the desk so staff can check it against ID"),
      allowWalkIns: z
        .boolean()
        .optional()
        .describe("Let staff register and check in people who aren't on the roster"),
      badgeEmailHours: z
        .number()
        .int()
        .min(0)
        .max(336)
        .optional()
        .describe(
          "Email each person their check-in code this many hours before the event starts; 0 sends none",
        ),
      selfCheckIn: z
        .boolean()
        .optional()
        .describe("Let people check themselves in with the venue code staff show on a screen"),
      requiredToCompete: z
        .boolean()
        .optional()
        .describe("Participants can't change teams, submit or vote until they've checked in"),
    }),
    fields: {
      confirmName: { label: "Confirm names at the desk" },
      allowWalkIns: {
        label: "Take walk-ins",
        description: "Staff can add someone by email at the desk.",
      },
      badgeEmailHours: {
        label: "Email the check-in code (hours before)",
        description: "0 doesn't email it.",
        placeholder: "24",
      },
      selfCheckIn: {
        label: "Self check-in",
        description:
          "People enter the venue code, which changes every ten minutes and is shown on the check-in screen, while the Check-in window is open.",
      },
      requiredToCompete: {
        label: "Check in before competing",
        description:
          "Best for in-person events. Participants who haven't checked in can't change teams, submit or vote.",
      },
    },
  }),
  voting: namespace({
    label: "Popular vote",
    scopes: ["instance", "org", "event"],
    defaults: {
      enabled: false,
      who: "participants",
      votesPerPerson: 1,
      ownTeam: false,
      showCounts: false,
    },
    schema: z.object({
      enabled: z.boolean().optional().describe("Let people vote for their favorite projects"),
      who: z
        .enum(["participants", "members", "signedIn"])
        .optional()
        .describe("Who can vote: participants, everyone in the event, or anyone signed in"),
      votesPerPerson: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many projects one person can vote for"),
      ownTeam: z.boolean().optional().describe("Whether teams can vote for their own project"),
      showCounts: z
        .boolean()
        .optional()
        .describe(
          "Show vote counts while voting is open; otherwise only once results are published",
        ),
    }),
    fields: {
      enabled: {
        label: "Popular vote",
        description:
          "Opens with the Popular vote window. Votes become a popular-vote award proposal.",
      },
      who: {
        label: "Who can vote",
        options: [
          { value: "participants", label: "Participants" },
          {
            value: "members",
            label: "Everyone in the event",
            description: "Judges, staff and participants",
          },
          {
            value: "signedIn",
            label: "Anyone signed in",
            description: "Needs the public gallery",
          },
        ],
      },
      votesPerPerson: { label: "Votes per person" },
      ownTeam: { label: "Teams can vote for themselves" },
      showCounts: { label: "Show counts while voting" },
    },
  }),
  judging: namespace({
    label: "Judging",
    scopes: ["instance", "org", "event"],
    defaults: {
      blind: false,
      showRankings: "organizers",
      normalize: "none",
      minJudges: 2,
      shareWithTeams: "feedback",
      judgeRubric: true,
      teamRubric: false,
      teamRubricShows: "name",
      deliberation: "assigned",
      flagGap: 0,
      holdFlagged: true,
    },
    schema: z.object({
      blind: z.boolean().optional().describe("Hide team names from judges"),
      normalize: z
        .enum(["none", "minmax", "zscore"])
        .optional()
        .describe("How judges' scores are put on a common scale before they are combined"),
      minJudges: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Fewest judges an entry should have before results are published"),
      shareWithTeams: z
        .enum(["none", "feedback", "scores"])
        .optional()
        .describe("What teams see from judges once results are published"),
      showRankings: z
        .enum(["organizers", "everyone"])
        .optional()
        .describe("Who sees the full ranking when results are published; awards are always public"),
      judgeRubric: z.boolean().optional().describe("Judges can pick or change a project's rubric"),
      teamRubric: z
        .boolean()
        .optional()
        .describe("Teams pick their own rubric on their submission"),
      teamRubricShows: z
        .enum(["name", "criteria"])
        .optional()
        .describe("What teams see of the rubrics they pick from"),
      deliberation: z
        .enum(["off", "assigned", "all"])
        .optional()
        .describe("Who discusses a flagged project"),
      flagGap: z
        .number()
        .int()
        .min(0)
        .max(100)
        .optional()
        .describe("Flag a project when its judges' totals are further apart than this (0 is off)"),
      holdFlagged: z
        .boolean()
        .optional()
        .describe("Results can't be published while a project is flagged"),
    }),
    fields: {
      blind: { label: "Blind judging" },
      normalize: {
        label: "Even out harsh and generous judges",
        description:
          "Scores are compared within each judge before they are averaged, so no one judge decides the order. The preview shows both rankings.",
        options: [
          { value: "none", label: "No", description: "Use scores as given" },
          {
            value: "minmax",
            label: "By each judge's range",
            description: "Their lowest to their highest",
          },
          {
            value: "zscore",
            label: "By standard deviations",
            description: "Distance from their average",
          },
        ],
      },
      minJudges: {
        label: "Fewest judges per entry",
        description: "The results preview warns about entries with fewer before you publish.",
      },
      shareWithTeams: {
        label: "What teams see from judges",
        description: "After results are published, on their submission page.",
        options: [
          { value: "none", label: "Nothing" },
          { value: "feedback", label: "Notes judges chose to share" },
          {
            value: "scores",
            label: "Notes and average scores",
            description: "Per criterion, without who gave them",
          },
        ],
      },
      showRankings: {
        label: "Who sees the ranking",
        description: "Awards are public either way. Set this before you publish.",
        options: [
          { value: "organizers", label: "Organizers only" },
          { value: "everyone", label: "Everyone" },
        ],
      },
      judgeRubric: {
        label: "Judges pick the rubric",
        description:
          "A judge can pick or change a project's rubric on its score sheet. One pick per project, shared by all its judges.",
      },
      teamRubric: {
        label: "Teams pick their rubric",
        description: "Teams choose a rubric on their submission while they can still edit it.",
      },
      teamRubricShows: {
        label: "What teams see",
        options: [
          { value: "name", label: "Rubric names" },
          { value: "criteria", label: "Names and their criteria" },
        ],
      },
      deliberation: {
        label: "Who deliberates",
        description:
          "Judges can flag a project to discuss it. While it's flagged, the judges deliberating see each other's scores and notes on it, then resolve it.",
        options: [
          { value: "off", label: "Nobody", description: "No flags" },
          {
            value: "assigned",
            label: "Its judges",
            description: "Judges assigned to it or who scored it",
          },
          { value: "all", label: "Every judge" },
        ],
      },
      flagGap: {
        label: "Flag on disagreement",
        description:
          "Points out of 100 judges' totals for one project may differ by before it's flagged on its own. 0 turns it off.",
      },
      holdFlagged: {
        label: "Hold results while flagged",
        description: "Publishing waits until every flagged project is resolved.",
      },
    },
  }),
  plugins: namespace({
    label: "Plugins",
    scopes: ["org", "event"],
    defaults: { enabled: [] },
    schema: z.object({
      available: z
        .array(z.string())
        .optional()
        .describe("Plugins this org's events may use (all when unset)"),
      enabled: z.array(z.string()).optional().describe("Plugins on for this event"),
    }),
  }),
} as const;

export type CoreNamespace = keyof typeof settingsRegistry;
export type SettingsValue<N extends CoreNamespace> = z.infer<
  (typeof settingsRegistry)[N]["schema"]
>;
export type ResolvedValue<N extends CoreNamespace> = SettingsValue<N> &
  Required<Pick<SettingsValue<N>, keyof (typeof settingsRegistry)[N]["defaults"]>>;

export function isCoreNamespace(value: string): value is CoreNamespace {
  return value in settingsRegistry;
}

const SCOPE_ORDER: Tuple<SettingScope> = ["instance", "org", "event"];

export function scopesBelow(namespace: CoreNamespace, scope: SettingScope): SettingScope[] {
  const below = SCOPE_ORDER.slice(SCOPE_ORDER.indexOf(scope) + 1);
  const allowed: Tuple<SettingScope> = settingsRegistry[namespace].scopes;
  return below.filter((level) => allowed.includes(level));
}

export function operatorKeys(namespace: CoreNamespace): Tuple<string> {
  const definition: { operator?: Tuple<string> } = settingsRegistry[namespace];
  return definition.operator ?? [];
}

export function isOperatorKey(namespace: CoreNamespace, scope: SettingScope, key: string): boolean {
  return scope === "instance" && operatorKeys(namespace).includes(key);
}

export function isSettingKey(namespace: CoreNamespace, key: string): boolean {
  return key in settingsRegistry[namespace].schema.shape;
}

export function parseSettings<N extends CoreNamespace>(
  namespace: N,
  scope: SettingScope,
  value: unknown,
): SettingsValue<N> {
  const definition = settingsRegistry[namespace];
  if (!definition.scopes.includes(scope)) {
    throw new Error(`${definition.label} can't be set at the ${scope} level.`);
  }
  const result = definition.schema.strict().safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      issue ? `${issue.path.join(".") || definition.label}: ${issue.message}` : "Invalid settings",
    );
  }
  return result.data as SettingsValue<N>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function storedSettings<N extends CoreNamespace>(
  namespace: N,
  value: unknown,
): Partial<SettingsValue<N>> {
  const shape: Record<string, z.ZodType> = settingsRegistry[namespace].schema.shape;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(isRecord(value) ? value : {})) {
    const parsed = shape[key]?.safeParse(raw);
    if (parsed?.success && parsed.data !== undefined) out[key] = parsed.data;
  }
  return out as Partial<SettingsValue<N>>;
}

export function resolveSettings<N extends CoreNamespace>(
  namespace: N,
  value: unknown,
): ResolvedValue<N> {
  return {
    ...settingsRegistry[namespace].defaults,
    ...storedSettings(namespace, value),
  } as ResolvedValue<N>;
}

export type SettingsChanges<N extends CoreNamespace> = {
  [K in keyof SettingsValue<N>]?: SettingsValue<N>[K] | null;
};

export function settingDefaults(): Record<CoreNamespace, Record<string, unknown>> {
  const out: Partial<Record<CoreNamespace, Record<string, unknown>>> = {};
  for (const namespace of Object.keys(settingsRegistry)) {
    if (isCoreNamespace(namespace)) out[namespace] = { ...settingsRegistry[namespace].defaults };
  }
  return out as Record<CoreNamespace, Record<string, unknown>>;
}

export function settingDescription<N extends CoreNamespace>(
  namespace: N,
  key: keyof SettingsValue<N> & string,
): string | undefined {
  const shape: Record<string, z.ZodType> = settingsRegistry[namespace].schema.shape;
  return shape[key]?.description;
}

export type SettingControl =
  | { kind: "select"; label: string; description?: string; options: Tuple<SettingOption<string>> }
  | { kind: "switch"; label: string; description?: string }
  | {
      kind: "number";
      label: string;
      description?: string;
      placeholder?: string;
      min?: number;
      max?: number;
      integer: boolean;
    }
  | { kind: "text"; label: string; description?: string; placeholder?: string };

export function settingControl<N extends CoreNamespace>(
  namespace: N,
  key: keyof SettingsValue<N> & string,
): SettingControl | null {
  const definition = settingsRegistry[namespace];
  const fields: Record<string, SettingField<unknown> | undefined> = definition.fields ?? {};
  const field = fields[key];
  if (!field) return null;
  const description = field.description ?? settingDescription(namespace, key);
  if (field.options) {
    const options = field.options.map((option) => ({ ...option, value: String(option.value) }));
    return { kind: "select", label: field.label, description, options };
  }
  const shape: Record<string, z.ZodType> = definition.schema.shape;
  const schema = shape[key];
  const inner = schema instanceof z.ZodOptional ? schema.unwrap() : schema;
  if (inner instanceof z.ZodNumber) {
    return {
      kind: "number",
      label: field.label,
      description,
      placeholder: field.placeholder,
      min: Number.isFinite(inner.minValue) ? (inner.minValue ?? undefined) : undefined,
      max: Number.isFinite(inner.maxValue) ? (inner.maxValue ?? undefined) : undefined,
      integer: inner.isInt,
    };
  }
  if (inner instanceof z.ZodString) {
    return { kind: "text", label: field.label, description, placeholder: field.placeholder };
  }
  if (inner instanceof z.ZodBoolean) return { kind: "switch", label: field.label, description };
  return null;
}
