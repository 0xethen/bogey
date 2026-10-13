import { defineConfig } from "@bogey/config/define";

export default defineConfig({
  brand: {
    name: "My Hacks",
    shortName: "Hacks",
    theme: "default",
    icons: { default: "/brand/logo.svg" },
  },
  plugins: { disabled: [] },
  security: { verboseErrors: false },
  repository: false,
  updates: { check: true },
});
