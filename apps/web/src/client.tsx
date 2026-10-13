import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";
import { installedPlugins, pluginSlots } from "@bogey/plugins";

if (installedPlugins().length > 0) await pluginSlots();

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
