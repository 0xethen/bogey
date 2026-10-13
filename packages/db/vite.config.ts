import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  envPrefix: ["VITE_", "PUBLIC_"],
});
