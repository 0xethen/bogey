import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconCloudOff } from "@tabler/icons-react";
import { judgeQueueQueryOptions } from "@bogey/db/queries/judging";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { toast } from "@bogey/ui/components/toast";
import { flushPending, usePendingCount } from "#/lib/pending-scores.ts";
import { useT } from "#/lib/translate.tsx";

export function PendingBanner({ eventId }: { eventId: string }) {
  const t = useT();
  const count = usePendingCount();
  const queryClient = useQueryClient();

  useEffect(() => {
    const send = async () => {
      const result = await flushPending();
      if (result.sent > 0) {
        await queryClient.invalidateQueries({ queryKey: judgeQueueQueryOptions(eventId).queryKey });
      }
      for (const message of result.refused) {
        toast.add({ title: t("judging.pendingRefused"), description: message, type: "error" });
      }
    };
    void send();
    const onVisible = () => {
      if (document.visibilityState === "visible") void send();
    };
    window.addEventListener("online", send);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void send(), 20_000);
    return () => {
      window.removeEventListener("online", send);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [eventId, queryClient, t]);

  if (count === 0) return null;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4">
      <Alert>
        <IconCloudOff />
        <AlertTitle>{t("judging.pendingTitle", { count })}</AlertTitle>
        <AlertDescription>
          {t("judging.pendingBody")}{" "}
          <Button size="xs" variant="outline" onClick={() => void flushPending()}>
            {t("judging.sendNow")}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
