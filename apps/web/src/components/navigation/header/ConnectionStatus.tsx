import { IconCloudOff, IconWifiOff } from "@tabler/icons-react";
import { useConnection } from "#/lib/connection.ts";
import { useT } from "#/lib/translate.tsx";

export function ConnectionStatus() {
  const status = useConnection();
  const t = useT();
  if (status === "online") return null;
  const offline = status === "offline";
  const label = offline ? t("nav.offline") : t("nav.unreachable");
  return (
    <span
      role="status"
      className="flex shrink-0 items-center gap-1 text-xs text-muted-fg"
      title={label}
    >
      {offline ? <IconWifiOff className="size-4" /> : <IconCloudOff className="size-4" />}
      <span className="hidden md:inline">{label}</span>
    </span>
  );
}
