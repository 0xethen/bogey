import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { IconLayoutDashboard, IconPlug } from "@tabler/icons-react";
import type { HomeBlock, HomeLayout } from "@bogey/config/settings";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import {
  BLOCK_GROUPS,
  BLOCK_INFO,
  blockLabel,
  ONCE_PER_PAGE,
  type BlockType,
} from "../-components/home/blocks.tsx";
import { searchSection } from "#/components/settings/layout/search-entries.ts";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/manage/homepage")({
  staticData: {
    title: msg("homepageSetup.title"),
    settings: (t) => [
      searchSection(t("homepageSetup.current"), {
        keywords: ["blocks", "customize", "layout"],
        id: "current-setup",
      }),
      searchSection(t("homepageSetup.available"), { id: "available-blocks" }),
    ],
  },
  loader: ({ context }) =>
    context.query.query({
      ...settingsQueryOptions({ eventId: context.event.id }, ["home"]),
      staleTime: "static",
    }),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="embedded" />,
});

const COLUMNS: Tuple<{ key: keyof HomeLayout; label: PlainKey; hint: PlainKey }> = [
  { key: "main", label: "homeEditor.main", hint: "homeEditor.mainHint" },
  { key: "aside", label: "homepageSetup.sideLabel", hint: "homepageSetup.sideHint" },
];

const BLOCK_TYPES = Object.keys(BLOCK_INFO).filter((type): type is BlockType => type in BLOCK_INFO);

function RouteComponent() {
  const t = useT();
  const { event } = Route.useRouteContext();
  const { data: settings } = useSuspenseQuery(
    settingsQueryOptions({ eventId: event.id }, ["home"]),
  );
  const layout = settings.home.layout;
  const total = layout.main.length + layout.aside.length;

  return (
    <Screen
      title={t("homepageSetup.title")}
      description={t("homepageSetup.intro")}
      width="embedded"
      actions={
        <Button
          render={
            <Link to="/events/$slug" params={{ slug: event.slug }} search={{ customize: "" }} />
          }
          nativeButton={false}
        >
          <IconLayoutDashboard />
          {t("homepageSetup.customize")}...
        </Button>
      }
    >
      <Screen.Section
        id="organization"
        title={t("homepageSetup.organization")}
        description={t("homepageSetup.organizationHelp")}
      >
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-fg marker:text-border">
          <li>{t("homepageSetup.point1")}</li>
          <li>{t("homepageSetup.point2")}</li>
          <li>{t("homepageSetup.point3")}</li>
          <li>{t("homepageSetup.point4")}</li>
        </ul>
      </Screen.Section>

      <Screen.Section
        id="current-setup"
        title={t("homepageSetup.current")}
        description={t("homepageSetup.onPage", { count: total })}
      >
        <div className="grid gap-6 sm:grid-cols-[3fr_2fr]">
          {COLUMNS.map((column) => (
            <div key={column.key} className="flex flex-col gap-2">
              <div className="flex flex-col">
                <h3 className="text-sm font-semibold">{t(column.label)}</h3>
                <p className="text-xs text-muted-fg">{t(column.hint)}</p>
              </div>
              {layout[column.key].length === 0 ? (
                <p className="text-sm text-muted-fg">{t("homepageSetup.nothing")}</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {layout[column.key].map((block) => (
                    <LayoutRow key={block.id} block={block} />
                  ))}
                </ol>
              )}
            </div>
          ))}
        </div>
      </Screen.Section>

      <Screen.Section id="available-blocks" title={t("homepageSetup.available")}>
        <div className="flex flex-col gap-6">
          {BLOCK_GROUPS.map((group) => {
            const types = BLOCK_TYPES.filter((type) => BLOCK_INFO[type].group === group.key);
            return (
              <div key={group.key} className="flex flex-col gap-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-xs font-semibold tracking-wide uppercase">
                    {t(group.label)}
                  </h3>
                  {"hint" in group && <p className="text-xs text-muted-fg">{t(group.hint)}</p>}
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {types.map((type) => {
                    const info = BLOCK_INFO[type];
                    return (
                      <li
                        key={type}
                        className="flex items-start gap-3 rounded-2xl border border-border px-3 py-2.5"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-fg">
                          <info.icon className="size-4" />
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="text-sm font-medium">
                            {t(info.label)}
                            {ONCE_PER_PAGE.has(type) && (
                              <span className="ml-2 text-xs font-normal text-muted-fg">
                                {t("homepageSetup.oncePerPage")}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-fg">{t(info.description)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Screen.Section>
    </Screen>
  );
}

function LayoutRow({ block }: { block: HomeBlock }) {
  const t = useT();
  const Icon = block.type === "plugin" ? IconPlug : BLOCK_INFO[block.type].icon;
  const heading = block.type === "divider" ? "" : (block.title?.trim() ?? "");
  const label = blockLabel(block, [], t);
  return (
    <li className="flex items-center gap-2.5 rounded-xl bg-muted/40 px-3 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-fg" />
      <span className={cn("min-w-0 flex-1 truncate", block.hidden && "text-muted-fg")}>
        {label}
        {heading && heading !== label && <span className="text-muted-fg"> · {heading}</span>}
      </span>
      {block.hidden && <Badge variant="secondary">{t("homepageSetup.hidden")}</Badge>}
    </li>
  );
}
