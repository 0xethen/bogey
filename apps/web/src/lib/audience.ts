import type { SearchSelectOption } from "@bogey/ui/components/search-select";
import type { Audience } from "@bogey/utils/audience";
import type { T } from "#/lib/translate.tsx";

// One multi-select picks both, so each value says which kind it is.
const DIVISION = "division:";
const TAG = "tag:";

interface Named {
  id: string;
  name: string;
}

export function audienceOptions(
  divisions: Tuple<Named>,
  tags: Tuple<Named>,
  t: T,
): SearchSelectOption[] {
  return [
    ...divisions.map((division) => ({
      value: DIVISION + division.id,
      label: division.name,
      group: t("manageNav.divisions"),
    })),
    ...tags.map((tag) => ({ value: TAG + tag.id, label: tag.name, group: t("tags.title") })),
  ];
}

export function audienceValues(audience: Audience): string[] {
  return [
    ...(audience.divisionIds ?? []).map((id) => DIVISION + id),
    ...(audience.tagIds ?? []).map((id) => TAG + id),
  ];
}

/** Back from the picker's values; empty lists are left out, like an audience of everyone. */
export function audienceOf(values: Tuple<string>): Audience {
  const divisionIds = values.flatMap((v) =>
    v.startsWith(DIVISION) ? [v.slice(DIVISION.length)] : [],
  );
  const tagIds = values.flatMap((v) => (v.startsWith(TAG) ? [v.slice(TAG.length)] : []));
  return {
    ...(divisionIds.length ? { divisionIds } : {}),
    ...(tagIds.length ? { tagIds } : {}),
  };
}

/** "For Middle school, Mentor", or nothing for everyone. */
export function audienceLabel(
  audience: Audience,
  divisions: Tuple<Named>,
  tags: Tuple<Named>,
  t: T,
): string | null {
  const names = [
    ...divisions.filter((division) => audience.divisionIds?.includes(division.id)),
    ...tags.filter((tag) => audience.tagIds?.includes(tag.id)),
  ].map((each) => each.name);
  return names.length ? t("audience.for", { names: names.join(", ") }) : null;
}
