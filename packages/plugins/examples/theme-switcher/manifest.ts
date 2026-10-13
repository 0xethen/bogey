import { definePlugin } from "@bogey/plugins/api";

export const manifest = definePlugin({
  key: "theme-switcher",
  name: "Theme switcher",
  api: 1,
  version: "0.0.0",
  description: "A Theme submenu in the account menu for picking among the installed themes.",
  author: { name: "Bogey" },
  license: "MIT",
  source: {
    repository: "github:0xethen/bogey",
    directory: "packages/plugins/examples/theme-switcher",
  },
});

export default manifest;
