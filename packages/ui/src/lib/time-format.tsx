import { createContext, use, type ReactNode } from "react";
import type { FormatOptions } from "@bogey/utils/time";

const TimeFormatContext = createContext<FormatOptions>({ timeZone: "UTC" });

export function TimeFormatProvider({
  value,
  children,
}: {
  value: FormatOptions;
  children: ReactNode;
}) {
  return <TimeFormatContext value={value}>{children}</TimeFormatContext>;
}

export function useTimeFormat(): FormatOptions {
  return use(TimeFormatContext);
}
