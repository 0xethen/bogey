import { z } from "zod";
import { createAdminClient } from "./admin.ts";

const claimed = z.array(z.object({ bucket: z.string(), path: z.string() })).catch([]);

/** Removes the stored files the database queued as unused (`private.storage_orphans`). Server only. */
export async function removeStorageOrphans(): Promise<number> {
  const admin = createAdminClient();
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const { data, error } = await admin.rpc("claim_storage_orphans", { p_limit: 500 });
    if (error) {
      console.warn("[bogey/db] claiming unused files:", error.message);
      return removed;
    }
    const files = claimed.parse(data);
    if (files.length === 0) return removed;
    const byBucket = new Map<string, string[]>();
    for (const file of files) {
      byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
    }
    for (const [bucket, paths] of byBucket) {
      const { error: removing } = await admin.storage.from(bucket).remove(paths);
      if (removing) console.warn("[bogey/db] removing unused files:", removing.message);
      else removed += paths.length;
    }
  }
  return removed;
}
