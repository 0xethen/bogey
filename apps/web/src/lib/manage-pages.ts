import { MANAGE_SETTINGS_PAGES, type ManageSettingsPage } from "@bogey/plugins";
import type { T } from "#/lib/translate.tsx";

export function managePageLabel(t: T, page: string): string | undefined {
  const labels: Record<ManageSettingsPage, string> = {
    details: t("details.title"),
    agenda: t("eventTab.agenda"),
    security: t("security.title"),
    registration: t("manageNav.registration"),
    people: t("adminTab.people"),
    teams: t("facts.teams"),
    divisions: t("manageNav.divisions"),
    submissions: t("window.submissions"),
    prizes: t("prizes.title"),
    certificates: t("certificates.title"),
    judging: t("judging.title"),
    announcements: t("announcements.title"),
    email: t("email.title"),
    messages: t("eventTab.messages"),
  };
  const known = MANAGE_SETTINGS_PAGES.find((each) => each === page);
  return known ? labels[known] : undefined;
}
