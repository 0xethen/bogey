import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
  galleryEngagementQueryOptions,
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
import { Comments } from "#/routes/gallery/$slug/-components/comments.tsx";
import { LikeButton } from "#/routes/gallery/$slug/-components/likes.tsx";
import { Banner, WinnerBadges } from "#/routes/gallery/$slug/-components/project-card.tsx";

export const Route = createFileRoute("/gallery/$slug/$projectId")({
  staticData: { title: msg("judging.project") },
  loader: async ({ context, params }) => {
    const gallery = await context.query.query({
      ...galleryQueryOptions(params.slug),
      staleTime: "static",
    });
    if (!gallery) throw notFound();
    const [project] = await Promise.all([
      context.query.query({
        ...galleryProjectQueryOptions(params.slug, params.projectId),
        staleTime: "static",
      }),
      context.query.query({
        ...submissionFormsQueryOptions(gallery.event.id),
        staleTime: "static",
      }),
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
  const { settings } = gallery;
  const card = gallery.projects.find((candidate) => candidate.id === project.id);
  const { data: engagement } = useQuery(galleryEngagementQueryOptions(gallery.event.id));
  const counted = engagement?.find((row) => row.submissionId === project.id);

  return (
    <Screen
      title={project.title || t("judging.untitled")}
      description={[project.teamName, gallery.event.name].join(" · ")}
      leading={
        <Button
          size="icon-sm"
          variant="ghost"
          tooltip={t("gallery.backToProjects")}
          aria-label={t("gallery.backToProjects")}
          render={<Link to="/gallery/$slug" params={{ slug: gallery.event.slug }} />}
          nativeButton={false}
        >
          <IconArrowLeft />
        </Button>
      }
    >
      {card && settings.banners && <Banner project={card} className="rounded-2xl" />}
      {card && <WinnerBadges project={card} />}
      <div className="flex flex-wrap items-center gap-1">
        <VoteButton eventId={gallery.event.id} submissionId={project.id} />
        {settings.likes && (
          <LikeButton
            eventId={gallery.event.id}
            submissionId={project.id}
            count={counted?.likes ?? 0}
          />
        )}
      </div>
      {form ? (
        <SubmissionAnswers form={form} submission={project} files={project.files} />
      ) : (
        <p className="text-sm text-muted-fg">{t("judging.formRemoved")}</p>
      )}
      {settings.comments && <Comments eventId={gallery.event.id} submissionId={project.id} />}
    </Screen>
  );
}
