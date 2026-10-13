import { IconAlertCircle } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "./alert.tsx";
import { useUiText } from "../lib/ui-text.ts";

export function ErrorAlert({
  error,
  title,
  className,
}: {
  error: { message: string } | string | null | undefined;
  title?: string;
  className?: string;
}) {
  const t = useUiText();
  if (!error) return null;
  return (
    <Alert variant="destructive" className={className}>
      <IconAlertCircle />
      <AlertTitle>{title ?? t("error.invalid")}</AlertTitle>
      <AlertDescription>{typeof error === "string" ? error : error.message}</AlertDescription>
    </Alert>
  );
}
