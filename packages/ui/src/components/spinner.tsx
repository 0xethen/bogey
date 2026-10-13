import { cn } from "@bogey/ui/lib/utils";
import { useUiText } from "../lib/ui-text.ts";
import { IconLoader } from "@tabler/icons-react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useUiText();
  return (
    <IconLoader
      data-slot="spinner"
      role="status"
      aria-label={t("ui.loading")}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
