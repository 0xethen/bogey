import { IconMapPin } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { useT } from "#/lib/translate.tsx";

export function TableNotice({ tables }: { tables: Tuple<string | null | undefined> }) {
  const t = useT();
  const labels = [...new Set(tables.filter((label): label is string => !!label))];
  if (labels.length === 0) return null;
  return (
    <Alert>
      <IconMapPin />
      <AlertTitle>{t("judging.yourTable", { tables: labels.join(", ") })}</AlertTitle>
      <AlertDescription>{t("judging.tableHelp")}</AlertDescription>
    </Alert>
  );
}
