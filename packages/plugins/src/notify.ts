import { browserClient } from "@bogey/db/browser";
import { ok, toFailure, type DbResult } from "@bogey/db/errors";
import type { PluginManifest } from "./types.ts";

export type NotifyKindsOf<M extends PluginManifest> =
  M["notifications"] extends Tuple<infer N>
    ? N extends { kind: infer K extends string }
      ? K
      : never
    : never;

export interface PluginNotification {
  eventId: string;
  users: Tuple<string>;
  title: string;
  body?: string;
  link?: string;
  permission: string;
  email?: boolean;
}

export function createPluginNotify<const M extends PluginManifest>(manifest: M) {
  return {
    async send(
      kind: NotifyKindsOf<M>,
      notification: PluginNotification,
    ): Promise<DbResult<number>> {
      const { data, error } = await browserClient().rpc("notify_event", {
        p_event: notification.eventId,
        p_key: manifest.key,
        p_kind: kind,
        p_users: [...notification.users],
        p_title: notification.title,
        p_body: notification.body ?? "",
        p_link: notification.link ?? "",
        p_permission: notification.permission,
        ...(notification.email === undefined ? {} : { p_email: notification.email }),
      });
      if (error) return toFailure(error, "sending the notification");
      return ok(data);
    },
  };
}
