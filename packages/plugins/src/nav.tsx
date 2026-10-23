import type { ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams } from "@tanstack/react-router";
import { can, useEventAccess } from "@bogey/db/permissions";
import { EVENT_AREAS, pluginPageUrl, routeArea } from "./api.ts";
import type { PathsOf, PluginManifest, PluginRouteArea } from "./types.ts";

export const PLUGIN_ROUTE = "/events/$slug/x/$key/$" as const;

interface PluginLinkProps {
  children?: ReactNode;
  className?: string;
  activeProps?: { className?: string };
  preload?: false | "intent" | "viewport" | "render";
  replace?: boolean;
  hash?: string;
  "aria-label"?: string;
}

export function createPluginNav<const M extends PluginManifest>(manifest: M) {
  type Path = PathsOf<M>;

  function areaOf(path: Path): PluginRouteArea {
    const route = manifest.routes?.find((candidate) => candidate.path === path);
    return route ? routeArea(route) : "event";
  }

  function href(path: Path, options?: { slug?: string; splat?: string }): string {
    const area = areaOf(path);
    // a splat with slashes is a deeper path, so each segment is encoded on its own
    const below = options?.splat
      ? `/${options.splat.split("/").map(encodeURIComponent).join("/")}`
      : "";
    return `${pluginPageUrl(manifest, area, path, options?.slug)}${below}`;
  }

  function useSlug(): string | undefined {
    const { slug } = useParams({ strict: false });
    return slug;
  }

  function Link({ to, splat, ...rest }: PluginLinkProps & { to: Path; splat?: string }) {
    const slug = useSlug();
    if (EVENT_AREAS.includes(areaOf(to)) && !slug) return null;
    return <RouterLink {...rest} to={href(to, { slug, splat })} />;
  }

  function useGoTo(): (
    path: Path,
    options?: { replace?: boolean; splat?: string },
  ) => Promise<void> {
    const navigate = useNavigate();
    const slug = useSlug();

    return (path, options) =>
      navigate({ to: href(path, { slug, splat: options?.splat }), replace: options?.replace });
  }

  function useHref(path: Path, options?: { splat?: string }): string {
    const slug = useSlug();
    return href(path, { slug, splat: options?.splat });
  }

  function SettingsLink(props: PluginLinkProps) {
    const slug = useSlug();
    const access = useEventAccess();
    if (!slug || !can(access, "event.manage")) return null;
    return <RouterLink {...props} to="/events/$slug/manage/plugins" params={{ slug }} />;
  }

  return { Link, SettingsLink, href, useGoTo, useHref };
}
