import { defineConfig, lazyPlugins, type Plugin } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

function tokenLink(): Plugin {
  return {
    name: "bogey-console-token-link",
    apply: "serve",
    configureServer(server) {
      const token = process.env.CONSOLE_TOKEN;
      if (!token) return;
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        if (server.resolvedUrls) {
          server.resolvedUrls.local = server.resolvedUrls.local.map(
            (url) => `${url}?token=${token}`,
          );
        }
        printUrls();
      };
    },
  };
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  lint: { rules: { "import/extensions": ["allow"] } },
  plugins: lazyPlugins(() =>
    process.env.VITEST ? [] : [tokenLink(), tanstackStart(), nitro(), tailwindcss(), viteReact()],
  ),
  server: { host: "127.0.0.1", allowedHosts: ["127.0.0.1", "localhost"] },
});
