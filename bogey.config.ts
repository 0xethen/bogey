import { defineConfig } from "@bogey/config/define";

export default defineConfig({
  brand: {
    name: "Example Organization",
    shortName: "Example Org.",
    theme: "default",
    icons: { default: "/brand/logo.svg" },
  },
  appUrl: "https://bogey.example.org",
  // plugins: { disabled: [] },
  // events: { uiDeletion: true },
  // network: {
  //   trustProxy: true,
  //   clientIpHeader: "x-forwarded-for",
  //   trustedHops: 1,
  //   trustedProxies: ["172.18.0.0/16"],
  // },
  // security: {
  //   verboseErrors: false,
  //   requireAdminMfa: true,
  //   headers: { frameAncestors: ["'self'"], hsts: true },
  // },
  // repository: "github:0xethen/bogey",
  // updates: { check: true },
});
