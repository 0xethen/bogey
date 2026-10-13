import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  galleryProjectQueryOptions,
  galleryQueryOptions,
  type Gallery,
} from "@bogey/db/queries/gallery";
import { submissionFormsQueryOptions, type TeamSubmission } from "@bogey/db/queries/submissions";
import { Button } from "@bogey/ui/components/button";
import { Screen } from "@bogey/ui/components/screen";
import { IconArrowLeft } from "@tabler/icons-react";
import { VoteButton } from "#/components/event/judging/vote-button.tsx";
import { SubmissionAnswers } from "#/components/event/submission/submission-answers.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/gallery/$slug/$projectId")({
  staticData: { title: msg("judging.project") },
  loader: async ({ context, params }) => {
    const gallery = await context.query.ensureQueryData(galleryQueryOptions(params.slug));
    if (!gallery) throw notFound();
    const [project] = await Promise.all([
      context.query.ensureQueryData(galleryProjectQueryOptions(params.slug, params.projectId)),
      context.query.ensureQueryData(submissionFormsQueryOptions(gallery.event.id)),
    ]);
    if (!project) throw notFound();
    return { title: project.title };
  },
  head: ({ match, loaderData }) => {
    const gallery = match.context.query.getQueryData(
      galleryQueryOptions(match.params.slug).queryKey,
    );
    const blurb = gallery?.projects.find((project) => project.id === match.params.projectId)?.blurb;
    if (!loaderData) return {};
    return {
      meta: [
        { property: "og:title", content: loaderData.title },
        { property: "og:type", content: "article" },
        ...(blurb
          ? [
              { property: "og:description", content: blurb },
              { name: "description", content: blurb },
            ]
          : []),
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug, projectId } = Route.useParams();
  const { data: gallery } = useSuspenseQuery(galleryQueryOptions(slug));
  const { data: project } = useSuspenseQuery(galleryProjectQueryOptions(slug, projectId));
  if (!gallery || !project) return null;
  return <Project gallery={gallery} project={project} />;
}

function Project({ gallery, project }: { gallery: Gallery; project: TeamSubmission }) {
  const t = useT();
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(gallery.event.id));
  const form = forms.find((candidate) => candidate.id === project.form_id);

  return (
    <Screen
      title={project.title || t("judging.untitled")}
      description={[project.teamName, gallery.event.name].join(" · ")}
      actions={
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link to="/gallery/$slug" params={{ slug: gallery.event.slug }} />}
        >
          <IconArrowLeft />
          {t("gallery.all")}
        </Button>
      }
    >
      <VoteButton eventId={gallery.event.id} submissionId={project.id} />
      {form ? (
        <SubmissionAnswers form={form} submission={project} files={project.files} />
      ) : (
        <p className="text-sm text-muted-fg">{t("judging.formRemoved")}</p>
      )}
    </Screen>
  );
}
