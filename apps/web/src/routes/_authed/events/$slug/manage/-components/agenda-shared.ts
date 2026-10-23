import { settingsQueryOptions } from "@bogey/db/queries/settings";
import type { Agenda } from "@bogey/db/queries/sessions";

export const agendaSettings = (eventId: string) =>
  settingsQueryOptions({ eventId }, ["agenda", "schedule"]);

export function levelsOf(agenda: Agenda, kind: string): string[] {
  return agenda.categories
    .filter((category) => category.kind === kind)
    .map((category) => category.label);
}
