import { en } from "@bogey/config/messages";
import { useTranslator } from "./locale.tsx";

export function useUiText() {
  return useTranslator(en);
}

export type UiText = ReturnType<typeof useUiText>;
