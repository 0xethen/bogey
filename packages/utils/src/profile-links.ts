import { sayEnglish, type Say } from "./messages.ts";

export const PROFILE_LINK_KINDS = [
  "website",
  "github",
  "devpost",
  "linkedin",
  "instagram",
  "youtube",
  "x",
] as const;

export type ProfileLinkKind = (typeof PROFILE_LINK_KINDS)[number];

export interface ProfileLink {
  kind: ProfileLinkKind;
  url: string;
}

export const MAX_PROFILE_LINKS = 8;

const HOSTS: Record<Exclude<ProfileLinkKind, "website">, Tuple<string>> = {
  github: ["github.com"],
  devpost: ["devpost.com"],
  linkedin: ["linkedin.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  x: ["x.com", "twitter.com"],
};

export function isProfileLinkKind(value: unknown): value is ProfileLinkKind {
  return PROFILE_LINK_KINDS.some((kind) => kind === value);
}

export function kindForUrl(url: string): ProfileLinkKind | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const kind of PROFILE_LINK_KINDS) {
    if (kind === "website") continue;
    if (HOSTS[kind].some((known) => host === known || host.endsWith(`.${known}`))) return kind;
  }
  return null;
}

export function profileLinkProblem(url: string, say: Say = sayEnglish): string | null {
  const address = url.trim();
  if (!address) return say("profileLinks.empty", "Enter an address");
  try {
    const parsed = new URL(address);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("scheme");
  } catch {
    return say("profileLinks.notAddress", '"{url}" isn\'t a web address starting with https://', {
      url: address,
    });
  }
  return address.length > 300
    ? say("profileLinks.addressTooLong", "Keep addresses under 300 characters")
    : null;
}

export function profileLinksProblem(
  links: readonly ProfileLink[],
  say: Say = sayEnglish,
): string | null {
  if (links.length > MAX_PROFILE_LINKS) {
    return say("profileLinks.tooMany", "Add up to {max} links", { max: MAX_PROFILE_LINKS });
  }
  for (const link of links) {
    const problem = profileLinkProblem(link.url, say);
    if (problem) return problem;
  }
  return null;
}

export function linksFromJson(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ProfileLink[] => {
    if (typeof entry !== "object" || entry === null || !("url" in entry)) return [];
    const { url } = entry;
    if (typeof url !== "string") return [];
    const kind = "kind" in entry ? entry.kind : undefined;
    return [{ kind: isProfileLinkKind(kind) ? kind : (kindForUrl(url) ?? "website"), url }];
  });
}
