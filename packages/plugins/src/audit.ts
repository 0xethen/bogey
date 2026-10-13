import { browserClient } from "@bogey/db/browser";
import { ok, toFailure, type DbResult } from "@bogey/db/errors";
import type { Json } from "@bogey/db/types";
import type { PluginManifest } from "./types.ts";

export type ActionsOf<M extends PluginManifest> =
  M["actions"] extends Tuple<infer A> ? A & string : never;

export function createPluginAudit<const M extends PluginManifest>(manifest: M) {
  return {
    async log(
      eventId: string,
      action: ActionsOf<M>,
      meta: { [key: string]: Json } = {},
    ): Promise<DbResult<null>> {
      const { error } = await browserClient().rpc("log_event", {
        p_event: eventId,
        p_action: `${manifest.key}.${action}`,
        p_meta: meta,
      });
      if (error) return toFailure(error, "writing to the audit log");
      return ok(null);
    },
  };
}
