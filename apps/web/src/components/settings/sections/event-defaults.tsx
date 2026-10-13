import type { OwnScope } from "@bogey/db/queries/settings";
import type { CoreNamespace } from "@bogey/config/settings";
import { Screen } from "@bogey/ui/components/screen";
import { SettingFields } from "../fields/setting-fields.tsx";
import {
  searchSection,
  searchSettings,
  type SettingsSearchEntry,
} from "../layout/search-entries.ts";
import { useT, type T } from "#/lib/translate.tsx";

export const EVENT_DEFAULT_NAMESPACES: Tuple<CoreNamespace> = [
  "registration",
  "identity",
  "submissions",
  "judging",
  "chat",
  "schedule",
];

export const eventDefaultsSearch = (t: T): Tuple<SettingsSearchEntry> => [
  searchSection(t("eventDefaults.registration"), { id: "registration" }),
  ...searchSettings("registration", ["mode"], t),
  ...searchSettings("identity", ["enabled"], t),
  searchSection(t("eventDefaults.submissions"), { id: "submissions" }),
  ...searchSettings("submissions", ["deletion", "autoSubmit"], t),
  searchSection(t("eventDefaults.judging"), { id: "judging" }),
  ...searchSettings("judging", ["blind"], t),
  searchSection(t("eventDefaults.messages"), { id: "messages" }),
  ...searchSettings("chat", ["enabled", "staff", "participants", "judges", "copyTeam"], t),
  searchSection(t("eventDefaults.agenda"), { id: "agenda" }),
  ...searchSettings("schedule", ["display"], t),
];

export function EventDefaults({ scope }: { scope: OwnScope }) {
  const t = useT();
  return (
    <>
      <Screen.Section id="registration" title={t("eventDefaults.registration")}>
        <SettingFields scope={scope} namespace="registration" keys={["mode"]} />
        <SettingFields scope={scope} namespace="identity" keys={["enabled"]} />
      </Screen.Section>
      <Screen.Section id="submissions" title={t("eventDefaults.submissions")}>
        <SettingFields scope={scope} namespace="submissions" keys={["deletion", "autoSubmit"]} />
      </Screen.Section>
      <Screen.Section id="judging" title={t("eventDefaults.judging")}>
        <SettingFields scope={scope} namespace="judging" keys={["blind"]} />
      </Screen.Section>
      <Screen.Section id="messages" title={t("eventDefaults.messages")}>
        <SettingFields
          scope={scope}
          namespace="chat"
          keys={["enabled", "staff", "participants", "judges", "copyTeam"]}
        />
      </Screen.Section>
      <Screen.Section id="agenda" title={t("eventDefaults.agenda")}>
        <SettingFields scope={scope} namespace="schedule" keys={["display"]} />
      </Screen.Section>
    </>
  );
}
