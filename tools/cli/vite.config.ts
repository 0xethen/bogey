import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/bin.ts"],
    format: "esm",
    platform: "node",
    outDir: "dist",
    deps: { alwaysBundle: [/^@bogey\//, "zod"] },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
