import { useMatches } from "@tanstack/react-router";
import type { AnyRouteMatch } from "@tanstack/react-router";
import type { ComponentType, ReactNode } from "react";
import { SectionTabs, type SectionTab } from "./SectionTabs.tsx";
import { PreviewBar } from "./PreviewBar.tsx";
import { Menubar } from "./Menubar.tsx";

export interface HeaderDeclaration {
  type?: "menubar" | "nav" | "none";
  content?: { start?: ReactNode; end?: ReactNode };
  nav?: Tuple<SectionTab> | ComponentType;
}

export interface ResolvedHeader {
  type: "menubar" | "nav" | "none";
  content: { start?: ReactNode; end?: ReactNode };
  nav?: HeaderDeclaration["nav"];
}

export function resolveHeader(matches: readonly AnyRouteMatch[]): ResolvedHeader {
  const resolved: ResolvedHeader = { type: "none", content: {} };

  for (const match of matches) {
    const header = match.staticData.header;
    if (!header) continue;
    if (header.type) resolved.type = header.type;
    if (header.content?.start !== undefined) resolved.content.start = header.content.start;
    if (header.content?.end !== undefined) resolved.content.end = header.content.end;
    if (header.nav) resolved.nav = header.nav;
  }

  return resolved;
}

export function useResolvedHeader(): ResolvedHeader {
  return useMatches({ select: resolveHeader });
}

export function Header() {
  const header = useResolvedHeader();

  if (header.type === "none") return null;

  return (
    <div className="sticky top-0 z-40">
      <PreviewBar />
      <Menubar content={header.content} />
      {header.type === "nav" && header.nav && <HeaderNav nav={header.nav} />}
    </div>
  );
}

function HeaderNav({ nav: Nav }: { nav: NonNullable<HeaderDeclaration["nav"]> }) {
  return typeof Nav === "function" ? <Nav /> : <SectionTabs tabs={Nav} />;
}
