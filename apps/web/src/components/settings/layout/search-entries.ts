import type { z } from "zod";
import { settingControl, type CoreNamespace, type SettingsValue } from "@bogey/config/settings";
import { schemaFields } from "@bogey/ui/lib/form-meta";
import { toSlug } from "@bogey/utils/keys";
import { sayOr, type T } from "#/lib/translate.tsx";

export interface SettingsSearchEntry {
  label: string;
  description?: string;
  hash?: string;
  keywords?: Tuple<string>;
}

export function searchSection(
  title: string,
  options: { description?: string; keywords?: Tuple<string>; id?: string } = {},
): SettingsSearchEntry {
  return {
    label: title,
    description: options.description,
    hash: options.id ?? toSlug(title),
    keywords: options.keywords,
  };
}

export function searchSettings<N extends CoreNamespace>(
  namespace: N,
  keys: Tuple<keyof SettingsValue<N> & string>,
  t?: T,
): SettingsSearchEntry[] {
  return keys.flatMap((key) => {
    const control = settingControl(namespace, key);
    if (!control) return [];
    return [
      {
        label: t ? sayOr(t, `setting.${namespace}.${key}`, control.label) : control.label,
        description:
          t && control.description
            ? sayOr(t, `setting.${namespace}.${key}.help`, control.description)
            : control.description,
        hash: `${namespace}.${key}`,
        keywords: [key],
      },
    ];
  });
}

export function searchFields(
  schema: z.core.$ZodType,
  sectionTitle?: string,
  sectionId?: string,
): SettingsSearchEntry[] {
  return schemaFields(schema).map((field) => ({
    label: field.label,
    description: field.description,
    hash: sectionTitle ? (sectionId ?? toSlug(sectionTitle)) : undefined,
    keywords: sectionTitle ? [sectionTitle] : [],
  }));
}
