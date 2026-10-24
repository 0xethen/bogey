import { sessionQueryOptions } from "@bogey/db/auth";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_unauthed")({
  beforeLoad: async ({ context }) => {
    const result = await context.query.query({ ...sessionQueryOptions(), staleTime: "static" });

    if (result.status === "authenticated") {
      throw Route.redirect({ to: "/" });
    }
  },
  component: Outlet,
});
