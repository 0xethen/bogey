import type { Enums } from "./types.ts";

// "View as" lives in a session cookie so the server sees it too; every Supabase request carries it
// as a header, and the database's access helpers answer as that role (supabase/schemas/01_access.sql).
export const VIEW_AS_ROLES = ["participant", "staff", "judge"] as const satisfies Tuple<
  Enums<"event_role">
>;
export type ViewAsRole = (typeof VIEW_AS_ROLES)[number];

export const VIEW_AS_COOKIE = "bogey-view-as";
export const VIEW_AS_HEADER = "x-bogey-view-as";

export function parseViewAs(value: string | null | undefined): ViewAsRole | null {
  return VIEW_AS_ROLES.find((role) => role === value) ?? null;
}

export function viewAsCookie(): ViewAsRole | null {
  if (typeof document === "undefined") return null;
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${VIEW_AS_COOKIE}=`));
  return parseViewAs(entry?.slice(VIEW_AS_COOKIE.length + 1));
}

/** Sends the browser's current "view as" with each request. */
export function withViewAs(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const role = viewAsCookie();
    if (!role) return base(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set(VIEW_AS_HEADER, role);
    return base(input, { ...init, headers });
  };
}
