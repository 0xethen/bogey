import { createFileRoute } from "@tanstack/react-router";
import { msg, useT } from "#/lib/translate.tsx";
import { Screen } from "@bogey/ui/components/screen";
import { ShortcutSettings } from "./-components/shortcut-settings.tsx";

export const Route = createFileRoute("/_authed/account/shortcuts")({
  staticData: {
    title: msg("accountNav.shortcuts"),
    settings: (t) => [{ label: t("accountNav.shortcuts"), keywords: ["hotkeys", "keybinds"] }],
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  return (
    <Screen title={t("accountNav.shortcuts")} description={t("shortcuts.intro")} width="embedded">
      <ShortcutSettings />
    </Screen>
  );
}
