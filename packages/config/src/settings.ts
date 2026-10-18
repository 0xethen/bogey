import { z } from "zod";
import { layoutProblem } from "@bogey/utils/email-layout";
import { en, type MessageKey } from "./messages.ts";
import { SIGN_IN_PROVIDER_KEYS } from "./sign-in.ts";

export { DEFAULT_EMAIL_TEMPLATES, type EmailTemplateKey } from "./email.ts";

const say = (key: MessageKey): string => en[key];

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
  /** For a list setting: what it can hold, picked several at a time. */
  choices?: Tuple<SettingOption<string>>;
  /** Choices that are always in the list and can't be taken out. */
  always?: Tuple<string>;
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
  /** Where bogey.config.ts holds the operator keys ("security"), or "" for its top level. */
  operatorIn?: string;
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

export const assignmentRuleSchema = z.object({
  tag: z.uuid("Pick a tag"),
  count: z.number().int().min(1).max(10),
  strict: z.boolean(),
  division: z.uuid().nullable().optional(),
});
export type AssignmentRule = z.infer<typeof assignmentRuleSchema>;

export const judgingAssignmentSchema = z.object({
  perProject: z.number().int().min(1).max(20),
  rules: z.array(assignmentRuleSchema).max(10),
  exclude: z.array(z.uuid()).max(20),
});
export type JudgingAssignment = z.infer<typeof judgingAssignmentSchema>;

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

export const eventTabSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9./-]*$/)
    .max(120),
  hidden: z.boolean().optional(),
  label: z.string().trim().max(40, "Keep it under 40 characters").optional(),
  // a window to show the tab only while it's open; "" keeps a tab a plugin ties to one always shown
  window: z
    .string()
    .regex(/^([a-z][a-z0-9.-]*)?$/)
    .max(80)
    .optional(),
});
export type EventTabSetting = z.infer<typeof eventTabSchema>;

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
      name: { label: say("setting.branding.name") },
      shortName: {
        label: say("setting.branding.shortName"),
        description: say("setting.branding.shortName.help"),
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
        label: say("setting.registration.capacity"),
        description: say("setting.registration.capacity.help"),
        placeholder: "0",
      },
      autoPromote: {
        label: say("setting.registration.autoPromote"),
        description: say("setting.registration.autoPromote.help"),
      },
      signup: {
        label: say("setting.registration.signup"),
        options: [
          { value: "open", label: say("setting.registration.signup.open") },
          { value: "invite", label: say("setting.registration.signup.invite") },
          { value: "closed", label: say("setting.registration.signup.closed") },
        ],
      },
      mode: {
        label: say("setting.registration.mode"),
        description: say("setting.registration.mode.help"),
        options: [
          {
            value: "open",
            label: say("setting.registration.mode.open"),
            description: "Registrations are approved at once",
          },
          {
            value: "review",
            label: say("setting.registration.mode.review"),
            description: "Each registration waits for review",
          },
          {
            value: "invite",
            label: say("setting.registration.mode.invite"),
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
    operatorIn: "",
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
        label: say("setting.tenancy.appUrl"),
        description: say("setting.tenancy.appUrl.help"),
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
      maxPasskeys: 5,
    },
    operator: ["requireAdminMfa", "deviceSignOut", "maxPasskeys"],
    operatorIn: "security",
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
      maxPasskeys: z
        .int()
        .min(0)
        .max(9)
        .optional()
        .describe("How many passkeys one person can add; 0 turns passkeys off"),
    }),
    fields: {
      portfolios: {
        label: say("setting.accounts.portfolios"),
        description: say("setting.accounts.portfolios.help"),
      },
      deletionRequests: {
        label: say("setting.accounts.deletionRequests"),
        description: say("setting.accounts.deletionRequests.help"),
      },
      deviceSignOut: {
        label: say("setting.accounts.deviceSignOut"),
        description: say("setting.accounts.deviceSignOut.help"),
      },
      maxPasskeys: {
        label: say("setting.accounts.maxPasskeys"),
        description: say("setting.accounts.maxPasskeys.help"),
        placeholder: "5",
      },
      requireAdminMfa: {
        label: say("setting.accounts.requireAdminMfa"),
        description: say("setting.accounts.requireAdminMfa.help"),
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
        label: say("setting.audit.retentionDays"),
        description: say("setting.audit.retentionDays.help"),
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
    operatorIn: "network",
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
        label: say("setting.network.clientIpHeader"),
        options: [
          {
            value: "x-forwarded-for",
            label: say("setting.network.clientIpHeader.x-forwarded-for"),
            description: "Self-hosted Supabase behind your own proxies",
          },
          {
            value: "cf-connecting-ip",
            label: say("setting.network.clientIpHeader.cf-connecting-ip"),
            description: "Behind Cloudflare",
          },
          {
            value: "x-real-ip",
            label: say("setting.network.clientIpHeader.x-real-ip"),
            description: "Only if your proxy overwrites it",
          },
        ],
      },
      trustedHops: { label: say("setting.network.trustedHops") },
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
        label: say("setting.seo.indexing"),
        description: say("setting.seo.indexing.help"),
      },
      description: {
        label: say("setting.seo.description"),
        description: say("setting.seo.description.help"),
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
      eventsPerOrg: { label: say("setting.limits.eventsPerOrg"), placeholder: "No limit" },
      adminsPerOrg: { label: say("setting.limits.adminsPerOrg"), placeholder: "No limit" },
      participantsPerEvent: {
        label: say("setting.limits.participantsPerEvent"),
        placeholder: "No limit",
      },
      emailsPerDay: { label: say("setting.limits.emailsPerDay"), placeholder: "No limit" },
      storageMbPerOrg: { label: say("setting.limits.storageMbPerOrg"), placeholder: "No limit" },
      maxUploadMb: { label: say("setting.limits.maxUploadMb"), placeholder: "No limit" },
      customDomainsPerOrg: {
        label: say("setting.limits.customDomainsPerOrg"),
        placeholder: "No limit",
      },
      pendingInvitesPerOrg: {
        label: say("setting.limits.pendingInvitesPerOrg"),
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
      submittedTitle: z
        .string()
        .trim()
        .max(80, "Keep it under 80 characters")
        .optional()
        .describe("The heading teams see once their project is submitted"),
      submittedBody: z
        .string()
        .trim()
        .max(300, "Keep it under 300 characters")
        .optional()
        .describe("The line under it; {when} becomes when they submitted"),
      prizePrompt: z
        .string()
        .trim()
        .max(300, "Keep it under 300 characters")
        .optional()
        .describe("What teams read above the prizes they can enter"),
      prizeImage: z
        .enum(["icon", "banner"])
        .optional()
        .describe("Whether a prize's image is a small icon beside it or a banner across it"),
    }),
    fields: {
      submittedTitle: {
        label: say("setting.submissions.submittedTitle"),
        placeholder: say("sub.submittedTitle"),
      },
      submittedBody: {
        label: say("setting.submissions.submittedBody"),
        description: say("setting.submissions.submittedBody.help"),
        placeholder: "Submitted {when}. Changes you save still count.",
      },
      prizePrompt: {
        label: say("setting.submissions.prizePrompt"),
        description: say("setting.submissions.prizePrompt.help"),
        placeholder: say("prizes.choose"),
      },
      prizeImage: {
        label: say("setting.submissions.prizeImage"),
        description: say("setting.submissions.prizeImage.help"),
        options: [
          { value: "icon", label: say("setting.submissions.prizeImage.icon") },
          { value: "banner", label: say("setting.submissions.prizeImage.banner") },
        ],
      },
      reminderHours: {
        label: say("setting.submissions.reminderHours"),
        description: say("setting.submissions.reminderHours.help"),
        placeholder: "24",
      },
      maxTracks: {
        label: say("setting.submissions.maxTracks"),
        description: say("setting.submissions.maxTracks.help"),
        placeholder: "Any number",
      },
      deletion: {
        label: say("setting.submissions.deletion"),
        description: say("setting.submissions.deletion.help"),
        options: [
          {
            value: "allow",
            label: say("setting.submissions.deletion.allow"),
          },
          {
            value: "request",
            label: say("setting.submissions.deletion.request"),
          },
          {
            value: "none",
            label: say("setting.submissions.deletion.none"),
          },
        ],
      },
      publicToggle: {
        label: say("setting.submissions.publicToggle"),
        description: say("setting.submissions.publicToggle.help"),
      },
      autoSubmit: {
        label: say("setting.submissions.autoSubmit"),
        description: say("setting.submissions.autoSubmit.help"),
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
        label: say("setting.schedule.countdownLabel"),
        placeholder: "Ends in",
        description: say("setting.schedule.countdownLabel.help"),
      },
      showEventTimezone: {
        label: say("setting.schedule.showEventTimezone"),
        description: say("setting.schedule.showEventTimezone.help"),
      },
      display: {
        label: say("setting.schedule.display"),
        options: [
          {
            value: "list",
            label: say("setting.schedule.display.list"),
            description: "On the event home, and their dates on the agenda",
          },
          {
            value: "timeline",
            label: say("setting.schedule.display.timeline"),
            description: "Every window on a time axis, and their dates on the agenda",
          },
          {
            value: "hidden",
            label: say("setting.schedule.display.hidden"),
            description: "Not on the event home or the agenda",
          },
        ],
      },
    },
  }),
  agenda: namespace({
    label: "Agenda",
    scopes: ["instance", "org", "event"],
    defaults: { kinds: [], reminderMinutes: 5, tabMenu: true },
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
          "Remind people this many minutes before a session they signed up for or a window opens (a window can set its own); 0 sends none",
        ),
      tabMenu: z
        .boolean()
        .optional()
        .describe("List the sessions that have a page of their own under the Agenda tab"),
    }),
    fields: {
      tabMenu: {
        label: say("setting.agenda.tabMenu"),
        description: say("setting.agenda.tabMenu.help"),
      },
      reminderMinutes: {
        label: say("setting.agenda.reminderMinutes"),
        description: say("setting.agenda.reminderMinutes.help"),
        placeholder: "5",
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
  tabs: namespace({
    label: "Event tabs",
    scopes: ["org", "event"],
    defaults: { items: [] },
    schema: z.object({
      items: z
        .array(eventTabSchema)
        .max(60)
        .optional()
        .describe(
          "The event's tabs in order, each shown or hidden, renamed or kept to while a window is open; tabs not listed keep their place",
        ),
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
        label: say("setting.identity.enabled"),
        description: say("setting.identity.enabled.help"),
      },
    },
  }),
  chat: namespace({
    label: "Messages",
    scopes: ["instance", "org", "event"],
    defaults: { enabled: true, staff: true, participants: false, judges: false, copyTeam: true },
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
        label: say("setting.chat.enabled"),
        description: say("setting.chat.enabled.help"),
      },
      staff: {
        label: say("setting.chat.staff"),
        description: say("setting.chat.staff.help"),
      },
      participants: {
        label: say("setting.chat.participants"),
        description: say("setting.chat.participants.help"),
      },
      judges: {
        label: say("setting.chat.judges"),
        description: say("setting.chat.judges.help"),
      },
      copyTeam: {
        label: say("setting.chat.copyTeam"),
        description: say("setting.chat.copyTeam.help"),
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
        label: say("setting.certificates.enabled"),
        description: say("setting.certificates.enabled.help"),
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
        label: say("setting.announcements.toasts"),
        description: say("setting.announcements.toasts.help"),
      },
      urgentStays: {
        label: say("setting.announcements.urgentStays"),
        description: say("setting.announcements.urgentStays.help"),
      },
      postAs: {
        label: say("setting.announcements.postAs"),
        description: say("setting.announcements.postAs.help"),
        options: [
          { value: "author", label: say("setting.announcements.postAs.author") },
          { value: "organizers", label: say("setting.announcements.postAs.organizers") },
        ],
      },
      judges: {
        label: say("setting.announcements.judges"),
        description: say("setting.announcements.judges.help"),
      },
    },
  }),
  teams: namespace({
    label: "Teams",
    scopes: ["instance", "org", "event"],
    defaults: {
      disband: "captain",
      board: false,
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
        label: say("setting.teams.switching"),
        description: say("setting.teams.switching.help"),
      },
      leaveLimit: {
        label: say("setting.teams.leaveLimit"),
        description: say("setting.teams.leaveLimit.help"),
        placeholder: "0",
      },
      creation: {
        label: say("setting.teams.creation"),
        options: [
          { value: "participants", label: say("setting.teams.creation.participants") },
          {
            value: "organizers",
            label: say("setting.teams.creation.organizers"),
            description: "Participants join the teams you set up, with their codes",
          },
        ],
      },
      askOrganizer: {
        label: say("setting.teams.askOrganizer"),
        description: say("setting.teams.askOrganizer.help"),
      },
      board: {
        label: say("setting.teams.board"),
        description: say("setting.teams.board.help"),
      },
      disband: {
        label: say("setting.teams.disband"),
        description: say("setting.teams.disband.help"),
        options: [
          { value: "captain", label: say("setting.teams.disband.captain") },
          { value: "members", label: say("setting.teams.disband.members") },
          { value: "none", label: say("setting.teams.disband.none") },
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
        label: say("setting.divisions.askOnJoin"),
        description: say("setting.divisions.askOnJoin.help"),
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
        label: say("setting.venue.format"),
        options: [
          {
            value: "in-person",
            label: say("setting.venue.format.in-person"),
            description: "Everyone is at a venue",
          },
          {
            value: "online",
            label: say("setting.venue.format.online"),
            description: "Everyone takes part remotely",
          },
          {
            value: "hybrid",
            label: say("setting.venue.format.hybrid"),
            description: "At a venue, and remotely too",
          },
        ],
      },
      mapUrl: {
        label: say("setting.venue.mapUrl"),
        description: say("setting.venue.mapUrl.help"),
        placeholder: "https://maps.app.goo.gl/...",
      },
      onlineUrl: {
        label: say("setting.venue.onlineUrl"),
        description: say("setting.venue.onlineUrl.help"),
        placeholder: "https://discord.gg/...",
      },
      onlineLabel: { label: say("setting.venue.onlineLabel"), placeholder: "Discord" },
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
        label: say("setting.privacy.about"),
        description: say("setting.privacy.about.help"),
        options: [
          {
            value: "members",
            label: say("setting.privacy.about.members"),
            description: "Once they're approved",
          },
          { value: "public", label: say("setting.privacy.about.public") },
        ],
      },
      agenda: {
        label: say("setting.privacy.agenda"),
        description: say("setting.privacy.agenda.help"),
        options: [
          {
            value: "members",
            label: say("setting.privacy.agenda.members"),
            description: "Once they're approved",
          },
          { value: "public", label: say("setting.privacy.agenda.public") },
        ],
      },
      tracks: {
        label: say("setting.privacy.tracks"),
        options: [
          { value: "public", label: say("setting.privacy.tracks.public") },
          {
            value: "members",
            label: say("setting.privacy.tracks.members"),
            description: "Once they're approved",
          },
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
      takers: ["organizer", "staff"],
    },
    schema: z.object({
      takers: z
        .array(z.enum(["organizer", "staff", "judge"]))
        .max(3)
        .optional()
        .describe(
          "Roles that work the check-in desk and take attendance in sessions; organizers always can",
        ),
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
      confirmName: { label: say("setting.checkin.confirmName") },
      allowWalkIns: {
        label: say("setting.checkin.allowWalkIns"),
        description: say("setting.checkin.allowWalkIns.help"),
      },
      badgeEmailHours: {
        label: say("setting.checkin.badgeEmailHours"),
        description: say("setting.checkin.badgeEmailHours.help"),
        placeholder: "24",
      },
      selfCheckIn: {
        label: say("setting.checkin.selfCheckIn"),
        description: say("setting.checkin.selfCheckIn.help"),
      },
      requiredToCompete: {
        label: say("setting.checkin.requiredToCompete"),
        description: say("setting.checkin.requiredToCompete.help"),
      },
      takers: {
        label: say("setting.checkin.takers"),
        description: say("setting.checkin.takers.help"),
        choices: [
          { value: "organizer", label: say("setting.checkin.takers.organizer") },
          { value: "staff", label: say("setting.checkin.takers.staff") },
          { value: "judge", label: say("setting.checkin.takers.judge") },
        ],
        always: ["organizer"],
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
        label: say("setting.voting.enabled"),
        description: say("setting.voting.enabled.help"),
      },
      who: {
        label: say("setting.voting.who"),
        options: [
          { value: "participants", label: say("setting.voting.who.participants") },
          {
            value: "members",
            label: say("setting.voting.who.members"),
            description: "Judges, staff and participants",
          },
          {
            value: "signedIn",
            label: say("setting.voting.who.signedIn"),
            description: "Needs the public gallery",
          },
        ],
      },
      votesPerPerson: { label: say("setting.voting.votesPerPerson") },
      ownTeam: { label: say("setting.voting.ownTeam") },
      showCounts: { label: say("setting.voting.showCounts") },
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
      judgeExport: "off",
      assignment: { perProject: 1, rules: [], exclude: [] },
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
      judgeExport: z
        .enum(["off", "projects", "results"])
        .optional()
        .describe("What judges can download in the projects spreadsheet"),
      assignment: judgingAssignmentSchema
        .optional()
        .describe(
          "How Assign judges picks: judges per project, rules asking for judges with a tag, and tags kept out",
        ),
    }),
    fields: {
      blind: { label: say("setting.judging.blind") },
      normalize: {
        label: say("setting.judging.normalize"),
        description: say("setting.judging.normalize.help"),
        options: [
          {
            value: "none",
            label: say("setting.judging.normalize.none"),
            description: "Use scores as given",
          },
          {
            value: "minmax",
            label: say("setting.judging.normalize.minmax"),
            description: "Their lowest to their highest",
          },
          {
            value: "zscore",
            label: say("setting.judging.normalize.zscore"),
            description: "Distance from their average",
          },
        ],
      },
      minJudges: {
        label: say("setting.judging.minJudges"),
        description: say("setting.judging.minJudges.help"),
      },
      shareWithTeams: {
        label: say("setting.judging.shareWithTeams"),
        description: say("setting.judging.shareWithTeams.help"),
        options: [
          { value: "none", label: say("setting.judging.shareWithTeams.none") },
          { value: "feedback", label: say("setting.judging.shareWithTeams.feedback") },
          {
            value: "scores",
            label: say("setting.judging.shareWithTeams.scores"),
            description: "Per criterion, without who gave them",
          },
        ],
      },
      showRankings: {
        label: say("setting.judging.showRankings"),
        description: say("setting.judging.showRankings.help"),
        options: [
          { value: "organizers", label: say("setting.judging.showRankings.organizers") },
          { value: "everyone", label: say("setting.judging.showRankings.everyone") },
        ],
      },
      judgeRubric: {
        label: say("setting.judging.judgeRubric"),
        description: say("setting.judging.judgeRubric.help"),
      },
      teamRubric: {
        label: say("setting.judging.teamRubric"),
        description: say("setting.judging.teamRubric.help"),
      },
      teamRubricShows: {
        label: say("setting.judging.teamRubricShows"),
        options: [
          { value: "name", label: say("setting.judging.teamRubricShows.name") },
          { value: "criteria", label: say("setting.judging.teamRubricShows.criteria") },
        ],
      },
      deliberation: {
        label: say("setting.judging.deliberation"),
        description: say("setting.judging.deliberation.help"),
        options: [
          { value: "off", label: say("setting.judging.deliberation.off"), description: "No flags" },
          {
            value: "assigned",
            label: say("setting.judging.deliberation.assigned"),
            description: "Judges assigned to it or who scored it",
          },
          { value: "all", label: say("setting.judging.deliberation.all") },
        ],
      },
      flagGap: {
        label: say("setting.judging.flagGap"),
        description: say("setting.judging.flagGap.help"),
      },
      holdFlagged: {
        label: say("setting.judging.holdFlagged"),
        description: say("setting.judging.holdFlagged.help"),
      },
      judgeExport: {
        label: say("setting.judging.judgeExport"),
        description: say("setting.judging.judgeExport.help"),
        options: [
          { value: "off", label: say("setting.judging.judgeExport.off") },
          {
            value: "projects",
            label: say("setting.judging.judgeExport.projects"),
            description: "Without members or judging results",
          },
          {
            value: "results",
            label: say("setting.judging.judgeExport.results"),
            description: "Ranks, scores and averages per criterion",
          },
        ],
      },
    },
  }),
  tags: namespace({
    label: "Tags",
    scopes: ["instance", "org"],
    defaults: { eventTags: true },
    schema: z.object({
      eventTags: z
        .boolean()
        .optional()
        .describe("Organizers can make tags for their own event, on top of the org's"),
    }),
    fields: {
      eventTags: {
        label: say("setting.tags.eventTags"),
        description: say("setting.tags.eventTags.help"),
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

/** Where bogey.config.ts sets an operator key (`security.deviceSignOut`), or null when it doesn't. */
export function operatorConfigPath(namespace: CoreNamespace, key: string): string | null {
  const definition: { operatorIn?: string } = settingsRegistry[namespace];
  if (!operatorKeys(namespace).includes(key) || definition.operatorIn === undefined) return null;
  return definition.operatorIn ? `${definition.operatorIn}.${key}` : key;
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
      kind: "multiselect";
      label: string;
      description?: string;
      options: Tuple<SettingOption<string>>;
      always: Tuple<string>;
    }
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
  if (field.choices) {
    return {
      kind: "multiselect",
      label: field.label,
      description,
      options: field.choices,
      always: field.always ?? [],
    };
  }
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
