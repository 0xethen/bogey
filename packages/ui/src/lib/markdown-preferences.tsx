import { createContext, useContext, type ReactNode } from "react";

export type SpoilerMode = "click" | "hold" | "visible";

export interface MarkdownPreferences {
  spoilers: SpoilerMode;
  codeLineNumbers: boolean;
}

export const DEFAULT_MARKDOWN_PREFERENCES: MarkdownPreferences = {
  spoilers: "click",
  codeLineNumbers: true,
};

const MarkdownPreferencesContext = createContext(DEFAULT_MARKDOWN_PREFERENCES);

export function MarkdownPreferencesProvider({
  value,
  children,
}: {
  value: MarkdownPreferences;
  children: ReactNode;
}) {
  return <MarkdownPreferencesContext value={value}>{children}</MarkdownPreferencesContext>;
}

export function useMarkdownPreferences(): MarkdownPreferences {
  return useContext(MarkdownPreferencesContext);
}
