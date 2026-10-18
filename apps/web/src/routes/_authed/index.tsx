import { createFileRoute } from "@tanstack/react-router";
import { homePath, homeTargetFn } from "#/lib/home.ts";

export const Route = createFileRoute("/_authed/")({
  beforeLoad: async ({ context }) => {
    const { session } = context;
    const target = await homeTargetFn({ data: session.org?.id ?? null })
      .then((result) => (result.ok ? result.data : null))
      .catch(() => null);
    throw Route.redirect({ ...homePath(target, session), replace: true });
  },
});
