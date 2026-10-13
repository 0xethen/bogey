import type { QueryClient } from "@tanstack/react-query";
import { resolveSettings, type ResolvedValue } from "@bogey/config/settings";
import { orgQueryOptions } from "@bogey/db/tenant";
import { settingsQueryOptions } from "@bogey/db/queries/settings";

export type Seo = ResolvedValue<"seo">;

export async function loadSeo(query: QueryClient): Promise<Seo> {
  try {
    const org = await query.ensureQueryData(orgQueryOptions());
    const settings = await query.ensureQueryData(
      settingsQueryOptions(org ? { orgId: org.id } : {}, ["seo"]),
    );
    return settings.seo;
  } catch {
    return resolveSettings("seo", undefined);
  }
}

type Meta = { name: string; content: string } | { property: string; content: string };

export function seoMeta({
  seo,
  signedIn,
  title,
  siteName,
}: {
  seo: Seo;
  signedIn: boolean;
  title: string;
  siteName: string;
}): Meta[] {
  if (signedIn) return [{ name: "robots", content: "noindex, nofollow" }];
  const meta: Meta[] = [
    { name: "robots", content: seo.indexing ? "index, follow" : "noindex, nofollow" },
    { property: "og:title", content: title },
    { property: "og:site_name", content: siteName },
    { property: "og:type", content: "website" },
  ];
  if (seo.description) {
    meta.push(
      { name: "description", content: seo.description },
      { property: "og:description", content: seo.description },
    );
  }
  return meta;
}
