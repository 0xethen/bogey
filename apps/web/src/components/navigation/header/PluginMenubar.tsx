import { Fragment } from "react";
import { loadedPluginSlots, readPluginSettings } from "@bogey/plugins";
import { useViewerSession } from "#/lib/viewer.ts";

export function PluginMenubar() {
  const session = useViewerSession();
  if (!session) return null;
  return loadedPluginSlots().map(({ key, manifest, slots }) => {
    const Control = slots.menubar;
    return Control ? (
      <Fragment key={key}>
        <Control settings={readPluginSettings(manifest, {})} session={session} />
      </Fragment>
    ) : null;
  });
}
