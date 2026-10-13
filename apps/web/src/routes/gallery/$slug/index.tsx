import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { galleryQueryOptions, type Gallery } from "@bogey/db/queries/gallery";
import { Badge } from "@bogey/ui/components/badge";
import { VoteButton } from "#/components/event/judging/vote-button.tsx";
import { Button } from "@bogey/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { IconLayoutGrid } from "@tabler/icons-react";
import { CardGrid, LinkCard } from "#/routes/gallery/$slug/-components/link-card.tsx";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { localizationQueryOptions } from "#/lib/i18n.ts";
import { msg, translatorFor, useT } from "#/lib/translate.tsx";

const search = z.object({
  form: z.string().optional().catch(undefined),
  track: z.string().optional().catch(undefined),
  division: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/gallery/$slug/")({
  staticData: { title: msg("gallery.projects") },
  validateSearch: search,
  head: ({ match }) => {
    const gallery = match.context.query.getQueryData(
      galleryQueryOptions(match.params.slug).queryKey,
    );
    if (!gallery) return {};
    const t = translatorFor(match.context.query.getQueryData(localizationQueryOptions().queryKey));
    const title = t("gallery.pageTitle", { event: gallery.event.name });
    const description = t("gallery.pageDescription", {
      count: gallery.projects.length,
      event: gallery.event.name,
      org: gallery.event.orgName,
    });
    return {
      meta: [
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "description", content: description },
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { slug } = Route.useParams();
  const filter = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: gallery } = useSuspenseQuery(galleryQueryOptions(slug));
  if (!gallery) return null;

  const shown = gallery.projects.filter(
    (project) =>
      (!filter.form || project.formId === filter.form) &&
      (!filter.track || project.trackIds.includes(filter.track)) &&
      (!filter.division || project.divisionId === filter.division),
  );
  const set = (patch: z.infer<typeof search>) =>
    void navigate({ search: { ...filter, ...patch }, replace: true });

  return (
    <Screen
      title={gallery.event.name}
      description={t("gallery.count", { count: gallery.projects.length })}
      width="wide"
      actions={
        gallery.projects.length > 0 && (
          <>
            <Filters gallery={gallery} filter={filter} onChange={set} />
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={<Link to="/gallery/$slug/present" params={{ slug }} />}
            >
              {t("gallery.slideshow")}
            </Button>
          </>
        )
      }
    >
      {shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconLayoutGrid />
            </EmptyMedia>
            <EmptyTitle>
              {gallery.projects.length ? t("gallery.nothingMatches") : t("gallery.comingSoon")}
            </EmptyTitle>
            <EmptyDescription>
              {gallery.projects.length ? t("gallery.adjust") : t("gallery.shareHint")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <CardGrid>
          {shown.map((project) => (
            <div key={project.id} className="flex flex-col gap-2">
              <LinkCard
                render={
                  <Link to="/gallery/$slug/$projectId" params={{ slug, projectId: project.id }} />
                }
                eyebrow={project.teamName}
                title={project.title}
                description={project.blurb}
                footer={gallery.tracks
                  .filter((track) => project.trackIds.includes(track.id))
                  .map((track) => (
                    <Badge key={track.id} variant="secondary">
                      {track.name}
                    </Badge>
                  ))}
              />
              <VoteButton eventId={gallery.event.id} submissionId={project.id} />
            </div>
          ))}
        </CardGrid>
      )}
    </Screen>
  );
}

type Filter = z.infer<typeof search>;

function Filters({
  gallery,
  filter,
  onChange,
}: {
  gallery: Gallery;
  filter: Filter;
  onChange: (patch: Filter) => void;
}) {
  const t = useT();
  const lists = [
    {
      key: "form",
      label: t("gallery.allForms"),
      items: gallery.forms.map((f) => ({ id: f.id, name: f.title })),
    },
    { key: "track", label: t("gallery.allTracks"), items: gallery.tracks },
    { key: "division", label: t("gallery.allDivisions"), items: gallery.divisions },
  ] as const;
  const shown = lists.filter((list) => list.items.length > 1);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {shown.map((list) => (
        <OptSelect
          key={list.key}
          ariaLabel={list.label}
          className="w-48"
          value={filter[list.key] ?? ""}
          options={[
            { value: "", label: list.label },
            ...list.items.map((item) => ({ value: item.id, label: item.name })),
          ]}
          onChange={(value) => onChange({ [list.key]: value || undefined })}
        />
      ))}
    </div>
  );
}
