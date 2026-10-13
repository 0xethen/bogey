import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import css from "#/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Bogey Developer Console" },
      { name: "robots", content: "noindex" },
    ],
    links: [{ rel: "stylesheet", href: css }],
  }),
  component: () => (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
