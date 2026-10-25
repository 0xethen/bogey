import type { ReactNode } from "react";
import type { T } from "#/lib/translate.tsx";

/** The line under a collapsed question or item: who it's for, and the key it's saved as. */
export function itemFooter(t: T, savedAs: string, audience: string | null): ReactNode {
  if (!savedAs && !audience) return null;
  return (
    <>
      {audience}
      {savedAs && audience && " · "}
      {savedAs && (
        <>
          {t("manageReg.savedAs")} <code>{savedAs}</code>
        </>
      )}
    </>
  );
}
