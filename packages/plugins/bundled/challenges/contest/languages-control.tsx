import { useQuery } from "@tanstack/react-query";
import type { PluginSettingControlProps } from "@bogey/plugins/runtime";
import { MultiSelect } from "@bogey/ui/components/search-select";
import { languagesQueryOptions } from "../db.ts";

// the languages setting stays a comma-separated list of keys; empty allows every enabled one
export function LanguagesControl({ id, value, onChange }: PluginSettingControlProps) {
  const languages = useQuery(languagesQueryOptions());
  const keys = String(value)
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return (
    <MultiSelect
      id={id}
      options={(languages.data ?? []).map((language) => ({
        value: language.key,
        label: `${language.name} ${language.version}`.trim(),
      }))}
      value={keys}
      onValueChange={(next) => onChange(next.join(", "))}
      placeholder="Every enabled language"
      empty={languages.isPending ? "Loading..." : "No language matches."}
    />
  );
}
