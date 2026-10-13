import type { SelectOption } from "@bogey/ui/components/opt-select";

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timezoneOptions(detected = detectedTimezone()): Tuple<SelectOption<string>> {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf("timeZone") as string[];
  } catch {
    zones = ["UTC"];
  }
  return [...new Set([detected, ...zones])].map((zone) => ({
    value: zone,
    label: zone.replace(/_/g, " "),
    description: zone === detected ? "Detected from this device" : undefined,
  }));
}
