import { useEffect, useRef } from "react";
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
  const ref = useRef<HTMLDivElement>(null);
  const message = typeof error === "string" ? error : error?.message;
  // a new error that lands off screen is brought into view; one already visible doesn't move the page
  useEffect(() => {
    const alert = ref.current;
    if (!alert) return;
    const { top, bottom } = alert.getBoundingClientRect();
    if (top >= 0 && bottom <= window.innerHeight) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    alert.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  }, [message]);
  if (!error) return null;
  return (
    <Alert ref={ref} variant="destructive" className={className}>
      <IconAlertCircle />
      <AlertTitle>{title ?? t("error.invalid")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
