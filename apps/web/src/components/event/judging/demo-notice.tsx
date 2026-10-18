import { useQuery } from "@tanstack/react-query";
import { IconPresentation } from "@tabler/icons-react";
import { myDemoSlotsQueryOptions } from "@bogey/db/queries/demos";
import { formatTime } from "@bogey/utils/time";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { useViewerTimeFormat } from "#/lib/time.ts";
import { useT } from "#/lib/translate.tsx";

/** When and where the viewer's team presents its demo, once organizers have scheduled it. */
export function DemoNotice({ event }: { event: { id: string; timezone: string } }) {
  const t = useT();
  const time = useViewerTimeFormat();
  const { data: slots = [] } = useQuery(myDemoSlotsQueryOptions(event.id));
  return slots.map((slot) => {
    const where = slot.location ? `${slot.panelName}, ${slot.location}` : slot.panelName;
    return (
      <Alert key={`${slot.submissionId}:${slot.roundName}`}>
        <IconPresentation />
        <AlertTitle>
          {slot.startsAt
            ? t("demoNotice.at", {
                time: formatTime(slot.startsAt, { ...time, timeZone: event.timezone }),
                where,
              })
            : t("demoNotice.order", { n: slot.position + 1, where })}
        </AlertTitle>
        <AlertDescription>
          {slot.ahead === null
            ? t("demoNotice.help")
            : slot.ahead === 0
              ? t("demoNotice.now")
              : t("demoNotice.ahead", { count: slot.ahead })}
        </AlertDescription>
      </Alert>
    );
  });
}
