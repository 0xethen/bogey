import type { SessionKind, SettingsChanges } from "@bogey/config/settings";
import { updateSettings, type OwnScope } from "@bogey/db/queries/settings";
import type { PlainKey } from "#/lib/translate.tsx";

export interface FormatPreset {
  value: "in-person" | "online" | "hybrid";
  label: PlainKey;
  description: PlainKey;
  summary: Tuple<PlainKey>;
  settings: {
    venue: SettingsChanges<"venue">;
    schedule: SettingsChanges<"schedule">;
    chat: SettingsChanges<"chat">;
    identity: SettingsChanges<"identity">;
    agenda: SettingsChanges<"agenda">;
    submissions: SettingsChanges<"submissions">;
    checkin: SettingsChanges<"checkin">;
  };
}

const kind = (
  key: string,
  label: string,
  tone: SessionKind["tone"],
  icon: SessionKind["icon"],
): SessionKind => ({ key, label, tone, icon });

const CHECK_IN = kind("check-in", "Check-in", "teal", "door");
const MEAL = kind("meal", "Meal", "amber", "meal");
const WORKSHOP = kind("workshop", "Workshop", "violet", "tools");
const TALK = kind("talk", "Talk", "blue", "presentation");
const CEREMONY = kind("ceremony", "Ceremony", "pink", "confetti");
const JUDGING = kind("judging", "Judging", "orange", "gavel");
const DEADLINE = kind("deadline", "Deadline", "red", "clock");
const LIVESTREAM = kind("livestream", "Livestream", "red", "microphone");
const OFFICE_HOURS = kind("office-hours", "Office hours", "green", "users");

export const FORMAT_PRESETS: Tuple<FormatPreset> = [
  {
    value: "in-person",
    label: "preset.inPerson",
    description: "preset.inPersonHelp",
    summary: [
      "preset.inPerson.s1",
      "preset.inPerson.s2",
      "preset.inPerson.s3",
      "preset.inPerson.s4",
      "preset.inPerson.s5",
    ],
    settings: {
      venue: { format: "in-person" },
      schedule: { showEventTimezone: true },
      chat: { enabled: true, participants: true, judges: false },
      identity: { enabled: true },
      agenda: { kinds: [CHECK_IN, MEAL, WORKSHOP, TALK, CEREMONY, JUDGING, DEADLINE] },
      submissions: { autoSubmit: false },
      checkin: { requiredToCompete: true },
    },
  },
  {
    value: "online",
    label: "preset.online",
    description: "preset.onlineHelp",
    summary: [
      "preset.online.s1",
      "preset.online.s2",
      "preset.online.s3",
      "preset.online.s4",
      "preset.online.s5",
    ],
    settings: {
      venue: { format: "online" },
      schedule: { showEventTimezone: false },
      chat: { enabled: true, participants: true, judges: true },
      identity: { enabled: true },
      agenda: { kinds: [LIVESTREAM, WORKSHOP, OFFICE_HOURS, TALK, CEREMONY, DEADLINE] },
      submissions: { autoSubmit: true },
      checkin: { requiredToCompete: false },
    },
  },
  {
    value: "hybrid",
    label: "preset.hybrid",
    description: "preset.hybridHelp",
    summary: [
      "preset.hybrid.s1",
      "preset.hybrid.s2",
      "preset.hybrid.s3",
      "preset.hybrid.s4",
      "preset.hybrid.s5",
    ],
    settings: {
      venue: { format: "hybrid" },
      schedule: { showEventTimezone: true },
      chat: { enabled: true, participants: true, judges: true },
      identity: { enabled: true },
      agenda: {
        kinds: [
          CHECK_IN,
          MEAL,
          LIVESTREAM,
          WORKSHOP,
          OFFICE_HOURS,
          TALK,
          CEREMONY,
          JUDGING,
          DEADLINE,
        ],
      },
      submissions: { autoSubmit: true },
      checkin: { requiredToCompete: false },
    },
  },
];

export async function applyFormatPreset(scope: OwnScope, preset: FormatPreset): Promise<boolean> {
  const { settings } = preset;
  const results = await Promise.all([
    updateSettings(scope, "venue", settings.venue),
    updateSettings(scope, "schedule", settings.schedule),
    updateSettings(scope, "chat", settings.chat),
    updateSettings(scope, "identity", settings.identity),
    updateSettings(scope, "agenda", settings.agenda),
    updateSettings(scope, "submissions", settings.submissions),
    updateSettings(scope, "checkin", settings.checkin),
  ]);
  return results.every((result) => result.ok);
}
