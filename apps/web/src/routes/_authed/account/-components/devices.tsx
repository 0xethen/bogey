import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDeviceDesktop, IconDeviceMobile } from "@tabler/icons-react";
import {
  myDevicesQueryOptions,
  signOutDeviceFn,
  signOutDevicesFn,
  type SignedInDevice,
} from "@bogey/db/queries/devices";
import { unwrap } from "@bogey/db/errors";
import { describeUserAgent } from "@bogey/utils/user-agent";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@bogey/ui/components/item";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Skeleton } from "@bogey/ui/components/skeleton";
import { useT, type T } from "#/lib/translate.tsx";

function deviceName(device: SignedInDevice, t: T): string {
  const { browser, os } = describeUserAgent(device.userAgent);
  if (browser && os) return t("devices.browserOn", { browser, os });
  return browser ?? os ?? t("devices.unknown");
}

export function DevicesSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const devices = useQuery(myDevicesQueryOptions());
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: myDevicesQueryOptions().queryKey });
  const one = useMutation({
    mutationFn: async (id: string) => unwrap(await signOutDeviceFn({ data: id })),
    onSettled: refresh,
  });
  const others = useMutation({
    mutationFn: async () => unwrap(await signOutDevicesFn({ data: "others" })),
    onSettled: refresh,
  });
  const everywhere = useMutation({
    mutationFn: async () => unwrap(await signOutDevicesFn({ data: "global" })),
    // this device is signed out too, so start over at sign-in
    onSuccess: () => window.location.assign("/auth/login"),
  });
  const list = devices.data?.devices ?? [];
  const signOutOthers = devices.data?.signOutOthers ?? false;
  const busy = one.isPending || others.isPending || everywhere.isPending;

  return (
    <Screen.Section
      id="devices"
      title={t("devices.title")}
      description={t(signOutOthers ? "devices.intro" : "devices.introEverywhere")}
      actions={
        <>
          {signOutOthers && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || list.filter((device) => !device.current).length === 0}
              confirm={{
                title: t("devices.othersTitle"),
                description: t("devices.othersBody"),
                label: t("devices.othersConfirm"),
              }}
              onClick={() => others.mutate()}
            >
              {t("devices.others")}
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            confirm={{
              title: t("devices.everywhereTitle"),
              description: t("devices.everywhereBody"),
              label: t("devices.everywhereConfirm"),
            }}
            onClick={() => everywhere.mutate()}
          >
            {t("devices.everywhere")}
          </Button>
        </>
      }
    >
      <ErrorAlert
        error={
          (devices.error instanceof Error ? devices.error : null) ??
          one.error ??
          others.error ??
          everywhere.error
        }
        title={t("devices.failed")}
      />
      {devices.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((device) => {
            const Icon = describeUserAgent(device.userAgent).mobile
              ? IconDeviceMobile
              : IconDeviceDesktop;
            return (
              <li key={device.id}>
                <Item variant="outline">
                  <ItemMedia>
                    <Icon className="size-5 text-muted-fg" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {deviceName(device, t)}
                      {device.current && <Badge variant="secondary">{t("devices.this")}</Badge>}
                    </ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {device.ip && `${device.ip} · `}
                      {t("devices.active")} <RelativeTime value={device.lastActive} />
                      {" · "}
                      {t("devices.signedIn")} <RelativeTime value={device.createdAt} />
                    </ItemDescription>
                  </ItemContent>
                  {signOutOthers && !device.current && (
                    <ItemActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => one.mutate(device.id)}
                      >
                        {t("devices.signOut")}
                      </Button>
                    </ItemActions>
                  )}
                </Item>
              </li>
            );
          })}
        </ul>
      )}
    </Screen.Section>
  );
}
