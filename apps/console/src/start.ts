import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { COOKIE, cookieValue, loopbackHost, validCookie, validToken } from "#/server/access.ts";

function refuse(status: 400 | 401 | 403, message: string): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

const accessMiddleware = createMiddleware({ type: "request" }).server(async ({ request, next }) => {
  const url = new URL(request.url);
  if (!loopbackHost(request.headers.get("host")))
    return refuse(403, "This console is only accessible on 127.0.0.1.");
  if (validCookie(getCookie(COOKIE))) return next();
  const token = url.searchParams.get("token");
  if (validToken(token)) {
    return new Response(null, {
      status: 303,
      headers: {
        Location: url.pathname,
        "Set-Cookie": `${COOKIE}=${cookieValue()}; HttpOnly; SameSite=Strict; Path=/`,
      },
    });
  }
  return refuse(401, "Open the local link `bogey console` printed to access Bogey Console.");
});

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [accessMiddleware, csrfMiddleware],
}));
