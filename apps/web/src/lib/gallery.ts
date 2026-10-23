import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { GalleryEngagement, GalleryProject, GallerySettings } from "@bogey/db/queries/gallery";
import type { PlainKey } from "#/lib/translate.tsx";

export type GallerySort = NonNullable<GallerySettings["sort"]>;
export type GalleryView = "grid" | "list";

export const GALLERY_SORTS = [
  { key: "newest", label: "gallery.sort.newest" },
  { key: "oldest", label: "gallery.sort.oldest" },
  { key: "title", label: "gallery.sort.title" },
  { key: "team", label: "gallery.sort.team" },
  { key: "winners", label: "gallery.sort.winners" },
  { key: "liked", label: "gallery.sort.liked" },
  { key: "votes", label: "gallery.sort.votes" },
  { key: "discussed", label: "gallery.sort.discussed" },
  { key: "random", label: "gallery.sort.random" },
] as const satisfies Tuple<{ key: GallerySort; label: PlainKey }>;

/** What a sort can use that isn't on the project itself; a sort with nothing to go on is left out. */
export interface SortInputs {
  engagement: ReadonlyMap<string, GalleryEngagement>;
  votes: ReadonlyMap<string, number>;
  /** Changes the shuffled order. */
  seed: number;
}

/** The sorts worth offering: the ones the organizers' settings leave something to sort by. */
export function availableSorts(
  settings: GallerySettings,
  projects: Tuple<GalleryProject>,
  inputs: Pick<SortInputs, "votes">,
): GallerySort[] {
  return GALLERY_SORTS.map((sort) => sort.key).filter((key) => {
    if (key === "winners") return settings.winners && projects.some((p) => p.wins.length > 0);
    if (key === "liked") return settings.likes;
    if (key === "discussed") return settings.comments;
    if (key === "votes") return inputs.votes.size > 0;
    return true;
  });
}

// a small deterministic hash, so a shuffle holds still between renders of the same seed
function scramble(id: string, seed: number): number {
  let hash = seed | 0;
  for (let i = 0; i < id.length; i += 1) hash = Math.imul(hash ^ id.charCodeAt(i), 2654435761);
  return hash >>> 0;
}

const placeRank = (project: GalleryProject) =>
  project.wins.length === 0 ? Infinity : Math.min(...project.wins.map((win) => win.place ?? 99));

export function sortProjects(
  projects: Tuple<GalleryProject>,
  sort: GallerySort,
  inputs: SortInputs,
): GalleryProject[] {
  const by =
    (value: (project: GalleryProject) => number) => (a: GalleryProject, b: GalleryProject) =>
      value(b) - value(a);
  const text =
    (value: (project: GalleryProject) => string) => (a: GalleryProject, b: GalleryProject) =>
      value(a).localeCompare(value(b), undefined, { sensitivity: "base", numeric: true });
  const time = (project: GalleryProject) => Date.parse(project.submittedAt ?? "") || 0;
  const likes = (project: GalleryProject) => inputs.engagement.get(project.id)?.likes ?? 0;
  const comments = (project: GalleryProject) => inputs.engagement.get(project.id)?.comments ?? 0;
  const votes = (project: GalleryProject) => inputs.votes.get(project.id) ?? 0;
  const compare = {
    newest: by(time),
    oldest: (a: GalleryProject, b: GalleryProject) => time(a) - time(b),
    title: text((project) => project.title),
    team: text((project) => project.teamName ?? ""),
    winners: (a: GalleryProject, b: GalleryProject) =>
      placeRank(a) - placeRank(b) || time(b) - time(a),
    liked: by(likes),
    votes: by(votes),
    discussed: by(comments),
    random: (a: GalleryProject, b: GalleryProject) =>
      scramble(a.id, inputs.seed) - scramble(b.id, inputs.seed),
  } satisfies Record<GallerySort, (a: GalleryProject, b: GalleryProject) => number>;
  return [...projects].sort(compare[sort]);
}

/** A soft, stable backdrop for a project with no image, from its id. */
export function bannerGradient(id: string): string {
  const hue = scramble(id, 7) % 360;
  return `linear-gradient(135deg, oklch(0.82 0.07 ${hue}), oklch(0.64 0.12 ${(hue + 50) % 360}))`;
}

const ORDINALS: Record<number, PlainKey> = {
  1: "gallery.place1",
  2: "gallery.place2",
  3: "gallery.place3",
};
export const placeKey = (place: number | null): PlainKey | null =>
  place === null ? null : (ORDINALS[place] ?? null);

/** The gallery's address filters, shared by its list and its slideshow. */
export const gallerySearch = z.object({
  form: z.string().optional().catch(undefined),
  track: z.string().optional().catch(undefined),
  division: z.string().optional().catch(undefined),
  sort: z
    .enum(GALLERY_SORTS.map((sort) => sort.key))
    .optional()
    .catch(undefined),
  view: z.enum(["grid", "list"]).optional().catch(undefined),
});

const VIEW_KEY = "bogey.gallery.view";
const viewListeners = new Set<() => void>();

function readView(): GalleryView | undefined {
  try {
    const value = localStorage.getItem(VIEW_KEY);
    return value === "grid" || value === "list" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The viewer's view mode: the address wins, then what they last picked here. */
export function useGalleryView(
  fromUrl: GalleryView | undefined,
): [GalleryView, (view: GalleryView) => void] {
  const saved = useSyncExternalStore(
    (listener) => {
      viewListeners.add(listener);
      return () => void viewListeners.delete(listener);
    },
    readView,
    () => undefined,
  );
  const set = (view: GalleryView) => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // storage can be blocked
    }
    viewListeners.forEach((listener) => listener());
  };
  return [fromUrl ?? saved ?? "grid", set];
}
