import { Screen } from "@bogey/ui/components/screen";
import { loadedPluginSlots } from "@bogey/plugins";

export function PendingComponent() {
  const Custom = loadedPluginSlots().find((loaded) => loaded.slots.pending)?.slots.pending;
  if (Custom) return <Custom />;
  return <Screen.Skeleton />;
}
