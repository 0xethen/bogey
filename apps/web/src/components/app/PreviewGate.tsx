import type { ReactNode } from "react";
import { IconEyeOff } from "@tabler/icons-react";
import { setViewAs, useViewAs } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { useT, type PlainKey } from "#/lib/translate.tsx";

const LABEL = {
  participant: "preview.participant",
  staff: "preview.staff",
  judge: "preview.judge",
} as const satisfies Record<string, PlainKey>;

export function PreviewGate({
  allowed = false,
  children,
}: {
  allowed?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const previewing = useViewAs();
  if (!previewing || allowed) return children;
  return (
    <Screen.Fallback
      icon={<IconEyeOff />}
      title={t("preview.title")}
      description={t("preview.body", { role: t(LABEL[previewing]) })}
    >
      <Screen.Actions>
        <Button onClick={() => setViewAs(null)}>{t("nav.stopPreviewing")}</Button>
      </Screen.Actions>
    </Screen.Fallback>
  );
}
