export const PLUGIN_KEY = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

export const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const SNAKE_KEBAB = /^[a-z][a-z0-9_]*(-[a-z0-9_]+)*$/;

export const NAMESPACED_KEY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** A tag in a list of roles ("tag:<uuid>"), where a setting picks people by role or by tag. */
export const TAG_REF = /^tag:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const tagRef = (tagId: string): string => `tag:${tagId}`;

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function toSlug(name: string, max = 64): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
}

export function typedSlug(value: string): string {
  return Array.from(value, (char) => {
    const lower = char.toLowerCase();
    return /^[a-z0-9-]$/.test(lower) ? lower : "-";
  }).join("");
}
