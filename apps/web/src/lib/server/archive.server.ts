import {
  archiveFilePath,
  archiveTexts,
  downloadFile,
  readArchive,
  type ArchiveData,
  type RestAccess,
} from "@bogey/db/archive";
import { getPublicEnv, serverSupabaseUrl } from "@bogey/db/env";
import { createServerClient } from "@bogey/db/server";
import { getOrgFn } from "@bogey/db/tenant";
import { SLUG } from "@bogey/utils/keys";
import { zipResponse, type ZipEntry } from "#/lib/server/download.server.ts";

function refuse(status: 401 | 403 | 404 | 500, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function* oneChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

export async function archiveResponse(slug: string): Promise<Response> {
  if (!SLUG.test(slug)) return refuse(404, "There's no event at this address.");
  const supabase = createServerClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return refuse(401, "Your credentials are invalid or expired. Please log in again.");
  const org = await getOrgFn();
  if (!org.ok || !org.data) return refuse(404, "There's no event at this address.");
  const { data: event, error } = await supabase
    .from("events")
    .select("id")
    .eq("org_id", org.data.id)
    .eq("slug", slug)
    .maybeSingle();
  if (error) return refuse(500, "Couldn't look up the event.");
  if (!event) return refuse(404, "There's no event at this address.");

  const { supabaseKey } = getPublicEnv();
  const access: RestAccess = { url: serverSupabaseUrl(), apikey: supabaseKey, bearer: token };
  let data: ArchiveData;
  try {
    data = await readArchive(access, event.id);
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : "";
    return /42501|only organization admins/.test(message)
      ? refuse(403, "Only organization admins can download an archive.")
      : refuse(500, "Couldn't read the event.");
  }
  await supabase.rpc("log_export", { p_event: event.id, p_kind: "archive" });

  async function* entries(): AsyncGenerator<ZipEntry> {
    for (const file of archiveTexts(data)) {
      yield { name: file.path, chunks: oneChunk(new TextEncoder().encode(file.text)) };
    }
    for (const file of data.manifest.files) {
      try {
        yield { name: archiveFilePath(file), chunks: oneChunk(await downloadFile(access, file)) };
      } catch {}
    }
  }
  return zipResponse(`${slug}-archive.zip`, entries());
}
