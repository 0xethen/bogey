import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { IconSlash } from "@tabler/icons-react";
import { brand } from "@bogey/config";
import { Button } from "@bogey/ui/components/button";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@bogey/ui/components/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import { useBreadcrumbs } from "#/lib/routing.ts";
import { useT } from "#/lib/translate.tsx";
import { Clock } from "./Clock.tsx";
import { ConnectionStatus } from "./ConnectionStatus.tsx";

const ORG_NAME = brand.shortName || brand.name;

function HomeMark() {
  if (!brand.icons) return <span aria-hidden>▞</span>;
  const { default: light, dark } = brand.icons;
  if (!dark) return <img src={light} alt="" className="size-5" />;
  return (
    <>
      <img src={light} alt="" className="size-5 dark:hidden" />
      <img src={dark} alt="" className="hidden size-5 dark:block" />
    </>
  );
}

const CRUMB_LINK =
  "underline decoration-muted-fg decoration-dotted underline-offset-2 hover:decoration-solid";

function Breadcrumbs() {
  const t = useT();
  const breadcrumbs = useBreadcrumbs();

  if (!breadcrumbs || breadcrumbs.length === 0) {
    return (
      <Link to="/" aria-label={ORG_NAME} title={ORG_NAME}>
        <HomeMark />
      </Link>
    );
  }

  const trail = breadcrumbs.slice(1);
  const folded = trail.slice(0, Math.max(0, trail.length - 1));

  return (
    <Breadcrumb>
      <BreadcrumbList className="select-none flex-nowrap text-muted-fg">
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/" aria-label={ORG_NAME} title={ORG_NAME} />}>
            <HomeMark />
          </BreadcrumbLink>
        </BreadcrumbItem>

        {folded.length > 0 && (
          <>
            <BreadcrumbSeparator className="md:hidden">
              <IconSlash />
            </BreadcrumbSeparator>
            <BreadcrumbItem className="md:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="icon-sm" variant="ghost">
                      <BreadcrumbEllipsis />
                      <span className="sr-only">{t("nav.earlierPages")}</span>
                    </Button>
                  }
                />
                <DropdownMenuContent align="start">
                  <DropdownMenuGroup>
                    {folded
                      .map((crumb) => (
                        <DropdownMenuItem key={crumb.href} render={<Link to={crumb.href} />}>
                          {crumb.title}
                        </DropdownMenuItem>
                      ))
                      .reverse()}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
          </>
        )}

        {trail.map((crumb, index) => {
          const hideSmall = index < folded.length ? "hidden md:inline-flex" : undefined;
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbSeparator className={hideSmall}>
                <IconSlash />
              </BreadcrumbSeparator>
              <BreadcrumbItem className={hideSmall}>
                {index === trail.length - 1 ? (
                  <BreadcrumbPage className="max-w-48 truncate">{crumb.title}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
                    render={<Link to={crumb.href} className={CRUMB_LINK} />}
                  >
                    {crumb.title}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function Menubar({ content }: { content: { start?: ReactNode; end?: ReactNode } }) {
  return (
    <header className="surface-primary relative flex h-(--menubar-height) items-center justify-between gap-3 px-3 transition-all select-none">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {content.start ?? <Breadcrumbs />}
      </div>
      <div className="flex shrink-0">
        <Clock placement="center" />
      </div>
      <div className="flex lg:flex-1 items-center justify-end gap-2">
        <Clock placement="end" />
        <ConnectionStatus />
        {content.end}
      </div>
    </header>
  );
}
