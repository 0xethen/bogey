import { defineConfig } from "@bogey/config/define";

export default defineConfig({
  brand: {
    name: "Example Org",
    shortName: "Example",
    theme: "default",
    icons: { default: "/brand/logo.svg", dark: "/brand/logo.svg" },
  },
  plugins: {
    disabled: [],
  },
  security: {
    verboseErrors: false,
  },
});
