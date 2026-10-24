import { createFileRoute, notFound, Outlet } from "@tanstack/react-router";
import { sessionQueryOptions } from "@bogey/db/auth";
import { galleryQueryOptions } from "@bogey/db/queries/gallery";
import { PublicBar } from "#/components/navigation/header/PublicBar.tsx";
import { msg } from "#/lib/translate.tsx";

export const Route = createFileRoute("/gallery/$slug")({
  staticData: { title: msg("gallery.title"), command: false },
  loader: async ({ context, params }) => {
    const [gallery] = await Promise.all([
      context.query.query({ ...galleryQueryOptions(params.slug), staleTime: "static" }),
      context.query.query({ ...sessionQueryOptions(), staleTime: "static" }),
    ]);
    if (!gallery) throw notFound();
    return { title: gallery.event.name, gallery };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { gallery } = Route.useLoaderData();
  return (
    <>
      <PublicBar orgName={gallery.event.orgName} />
      <Outlet />
    </>
  );
}
