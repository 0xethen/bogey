import { notFound, useMatches } from "@tanstack/react-router";
import { BogeyRequestError } from "@bogey/db/errors";
import type { AnyRouteMatch, StaticDataRouteOption } from "@tanstack/react-router";
import { msg, useSay, type Text } from "#/lib/translate.tsx";

type Match = AnyRouteMatch;

export type RouteTitle = Text | { page: Text; breadcrumb?: Text };

type Say = (text: Text) => string;

function loaderTitle(data: unknown): RouteTitle | undefined {
  if (typeof data !== "object" || data === null || !("title" in data)) return undefined;
  const { title } = data;
  if (typeof title === "string") return title || undefined;
  if (typeof title !== "object" || title === null || !("page" in title)) return undefined;
  if (typeof title.page !== "string") return undefined;
  const breadcrumb =
    "breadcrumb" in title && typeof title.breadcrumb === "string" ? title.breadcrumb : undefined;
  return { page: title.page, breadcrumb };
}

export function titleOf(match: Match, say: Say): { page: string; breadcrumb: string } | undefined {
  const title = loaderTitle(match.loaderData) ?? match.staticData.title;
  if (title === undefined) return undefined;
  if (typeof title === "string" || "message" in title) {
    return { page: say(title), breadcrumb: say(title) };
  }
  return { page: say(title.page), breadcrumb: say(title.breadcrumb ?? title.page) };
}

function isFailed(match: Match): boolean {
  return match.status === "notFound" || match.status === "error";
}

export function makeTitle(matches: readonly Match[], say: Say, separator = " - "): string {
  const failed = matches.find(isFailed);
  if (failed) {
    return say(failed.status === "notFound" ? msg("title.notFound") : msg("title.wentWrong"));
  }

  return matches
    .toReversed()
    .map((match) => titleOf(match, say)?.page)
    .filter((title): title is string => title !== undefined)
    .filter((title, index, all) => all.indexOf(title) === index)
    .join(separator);
}

export function classNamesOf(matches: readonly Match[]): StaticDataRouteOption["classNames"] {
  for (const match of matches.toReversed()) {
    if (match.staticData.classNames !== undefined) return match.staticData.classNames;
  }
  return undefined;
}

export interface Breadcrumb {
  title: string;
  href: string;
}

export function getBreadcrumbs(matches: readonly Match[], say: Say): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [];
  for (const match of matches) {
    if (isFailed(match)) break;
    const title = titleOf(match, say)?.breadcrumb;
    if (!title || !match.pathname) continue;

    const href = match.pathname.replace(/(.)\/$/, "$1");
    if (crumbs.at(-1)?.href === href) continue;
    crumbs.push({ title, href });
  }
  return crumbs;
}

export function useBreadcrumbs(): Breadcrumb[] {
  const say = useSay();
  return useMatches({ select: (matches) => getBreadcrumbs(matches, say) });
}

export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof BogeyRequestError && error.code === "not_found") throw notFound();
    throw error;
  }
}
