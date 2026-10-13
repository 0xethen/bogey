import { useRoleLabel } from "#/lib/roles.ts";
import { Fragment } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { can, setViewAs, useViewAs, VIEW_AS_ROLES } from "@bogey/db/permissions";
import { useQuery } from "@tanstack/react-query";
import {
  IconBuilding,
  IconChevronDown,
  IconExternalLink,
  IconEye,
  IconLogout,
  IconSearch,
  IconServer,
  IconShieldLock,
  IconUserCircle,
} from "@tabler/icons-react";
import { isOrgAdmin, type Session } from "@bogey/db/auth";
import { useT } from "#/lib/translate.tsx";
import { ownSettingsQueryOptions } from "@bogey/db/queries/settings";
import {
  installedPlugins,
  loadedPluginSlots,
  pluginAccountLinks,
  readPluginSettings,
} from "@bogey/plugins";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@bogey/ui/components/dropdown-menu";
import { orgTabs } from "#/lib/org.ts";
import { useRealEventAccess, useViewerSession } from "#/lib/viewer.ts";
import { cmdK } from "#/components/app/CmdK.tsx";
import { signOutDialog } from "#/components/app/SignOutDialog.tsx";
import { useModifierLabel } from "#/lib/hooks/modifier-label.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bogey/ui/components/tooltip";

export function AccountMenu() {
  const session = useViewerSession();
  return session ? <Account session={session} /> : null;
}

function Account({ session }: { session: Session }) {
  const t = useT();
  const modifier = useModifierLabel();
  const name = session.profile?.display_name ?? session.user.email ?? t("nav.account");
  const links = pluginAccountLinks(installedPlugins());
  const pluginItems = loadedPluginSlots().filter(({ slots }) => slots.accountMenu);
  const pluginGroups = installedPlugins()
    .map((manifest) => ({
      key: manifest.key,
      name: manifest.name,
      links: links.filter((link) => link.plugin === manifest.key),
      slots: pluginItems.find((item) => item.key === manifest.key),
    }))
    .filter((group) => group.links.length > 0 || group.slots);
  const orgAdmin = isOrgAdmin(session) && !!session.org;
  const more = session.platformAdmin || !!session.adminNeedsMfa || orgAdmin;
  const instance = useQuery({
    ...ownSettingsQueryOptions({ scope: "instance" }, "branding"),
    enabled: session.platformAdmin,
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("nav.accountMenu")}
          className="shrink-0 flex items-center gap-1.5 text-sm text-muted-fg transition-colors hocus:text-fg data-popup-open:text-fg"
        >
          <IconUserCircle className="size-4" />
          <span className="hidden max-w-40 truncate sm:inline">{name}</span>
          <IconChevronDown className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex flex-col">
              <span className="truncate">{name}</span>
              {session.user.email && (
                <span className="truncate text-xs font-normal text-muted-fg">
                  {session.user.email}
                </span>
              )}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuGroup>
            <DropdownMenuItem render={<Link to="/account" />}>
              <IconUserCircle />
              {t("nav.account")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => cmdK.open(null)}>
              <IconSearch />
              {t("nav.search")}
              <DropdownMenuShortcut>{modifier}K</DropdownMenuShortcut>
            </DropdownMenuItem>
            <ViewAsMenu />
          </DropdownMenuGroup>
          {more && <DropdownMenuSeparator />}
          {more && (
            <DropdownMenuGroup>
              {session.platformAdmin && (
                <DropdownMenuItem render={<Link to="/admin" />}>
                  <IconServer />
                  <span className="truncate">{instance.data?.name ?? t("nav.instance")}</span>
                </DropdownMenuItem>
              )}
              {session.adminNeedsMfa && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuItem
                        render={<Link to="/account/security" search={{ mfa: "admin" }} />}
                      />
                    }
                  >
                    <IconShieldLock />
                    {t("nav.instance")}
                  </TooltipTrigger>
                  <TooltipContent side="left">{t("nav.mfaRequired")}</TooltipContent>
                </Tooltip>
              )}
              {orgAdmin && session.org && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <IconBuilding />
                    <span className="truncate">{session.org.name}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {orgTabs(t).map((tab) => (
                      <DropdownMenuItem key={tab.key} render={<Link to={tab.to} />}>
                        {tab.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>
          )}
          {pluginGroups.map(({ key, name, links: groupLinks, slots }) => {
            const Items = slots?.slots.accountMenu;
            return (
              <Fragment key={key}>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-xs text-muted-fg">{name}</DropdownMenuLabel>
                  {groupLinks.map((link) => (
                    <DropdownMenuItem
                      key={link.key}
                      render={
                        <a
                          href={link.href}
                          {...(link.external
                            ? { target: "_blank", rel: "noopener noreferrer" }
                            : {})}
                        />
                      }
                    >
                      {link.label}
                      {link.external && <IconExternalLink className="ml-auto" />}
                    </DropdownMenuItem>
                  ))}
                  {Items && slots && (
                    <Items settings={readPluginSettings(slots.manifest, {})} session={session} />
                  )}
                </DropdownMenuGroup>
              </Fragment>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={() => signOutDialog.open(null)}>
              <IconLogout />
              {t("nav.signOut")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ViewAsMenu() {
  const t = useT();
  const roleLabel = useRoleLabel();
  const real = useRealEventAccess();
  const previewing = useViewAs();
  const navigate = useNavigate();
  if (!real || !can(real.access, "event.manage")) return null;
  const slug = real.event.slug;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconEye />
        {t("nav.viewAs")}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {VIEW_AS_ROLES.map((role) => (
          <DropdownMenuItem
            key={role}
            disabled={role === previewing}
            onClick={() => {
              setViewAs(role);
              void navigate({ to: "/events/$slug", params: { slug } });
            }}
          >
            {roleLabel(role)}
          </DropdownMenuItem>
        ))}
        {previewing && (
          <DropdownMenuItem
            onClick={() => {
              setViewAs(null);
              void navigate({ to: "/events/$slug/manage", params: { slug } });
            }}
          >
            {t("nav.stopPreviewing")}
          </DropdownMenuItem>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
