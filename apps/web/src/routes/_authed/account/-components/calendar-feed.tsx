import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCalendarTokenFn,
  hasCalendarTokenQueryOptions,
  revokeCalendarTokenFn,
} from "@bogey/db/queries/calendar";
import { unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Input } from "@bogey/ui/components/input";
import { toast } from "@bogey/ui/components/toast";
import { useT } from "#/lib/translate.tsx";

export function CalendarFeed() {
  const t = useT();
  const queryClient = useQueryClient();
  const has = useQuery(hasCalendarTokenQueryOptions());
  const [address, setAddress] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: hasCalendarTokenQueryOptions().queryKey });
  const create = useMutation({
    mutationFn: async () => unwrap(await createCalendarTokenFn()),
    onSuccess: async (token) => {
      setAddress(`${location.origin}/api/v1/calendar/${token}.ics`);
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: async () => unwrap(await revokeCalendarTokenFn()),
    onSuccess: async () => {
      setAddress(null);
      await refresh();
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-fg">{t("calendar.help")}</p>
      <ErrorAlert error={has.error instanceof Error ? has.error : (create.error ?? revoke.error)} />
      {address && (
        <div className="flex flex-col gap-2">
          <p className="text-sm">{t("calendar.address")}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              readOnly
              value={address}
              aria-label={t("calendar.addressLabel")}
              className="min-w-64 flex-1 font-mono text-xs"
            />
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(address);
                toast.add({ title: t("common.copied") });
              }}
            >
              {t("common.copy")}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {has.data ? (
          <>
            <Button
              variant="outline"
              confirm={{
                title: t("calendar.newTitle"),
                description: t("calendar.newBody"),
                label: t("calendar.newLabel"),
                variant: "default",
              }}
              onClick={() => create.mutate()}
            >
              {t("calendar.newButton")}
            </Button>
            <Button
              variant="ghost"
              confirm={{
                title: t("calendar.offTitle"),
                description: t("calendar.offBody"),
                label: t("calendar.offLabel"),
              }}
              onClick={() => revoke.mutate()}
            >
              {t("calendar.offButton")}
            </Button>
          </>
        ) : (
          <Button disabled={create.isPending} onClick={() => create.mutate()}>
            {t("calendar.make")}
          </Button>
        )}
      </div>
    </div>
  );
}
