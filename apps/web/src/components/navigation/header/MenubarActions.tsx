import { Separator } from "@bogey/ui/components/separator";
import { AccountMenu } from "./AccountMenu.tsx";
import { NotificationsButton } from "./NotificationsButton.tsx";
import { PluginMenubarItems } from "./PluginMenubarItems.tsx";

/** The signed-in end of the menubar: icon buttons (plugins', then notifications), then menus (plugins', then the account menu). */
export function MenubarActions() {
  return (
    <div className="flex items-center gap-2">
      <div data-slot="menubar-buttons" className="flex items-center gap-1">
        <PluginMenubarItems kind="button" />
        <NotificationsButton />
      </div>
      <Separator orientation="vertical" className="h-4 data-vertical:self-center" />
      <div data-slot="menubar-menus" className="flex items-center gap-1">
        <PluginMenubarItems kind="menu" />
        <AccountMenu />
      </div>
    </div>
  );
}
