import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { consumeRedirectFn, sessionQueryKey, verifySignInLinkFn } from "@bogey/db/auth";

export const Route = createFileRoute("/_unauthed/auth/confirm")({
  validateSearch: z.object({
    token_hash: z.string().optional().catch(undefined),
    type: z.string().optional().catch(undefined),
  }),
  beforeLoad: async ({ search, context }) => {
    let signedIn = false;
    if (search.token_hash && search.type) {
      try {
        const result = await verifySignInLinkFn({
          data: { tokenHash: search.token_hash, type: search.type },
        });
        signedIn = result.ok;
      } catch {}
    }
    if (!signedIn) throw Route.redirect({ to: "/auth/login", search: { error: "auth" } });

    context.query.removeQueries({ queryKey: sessionQueryKey });
    if (search.type === "email_change") throw Route.redirect({ to: "/account", replace: true });
    const destination = await consumeRedirectFn();
    if (destination) throw redirect({ href: destination, replace: true });
    throw Route.redirect({ to: "/", replace: true });
  },
});
