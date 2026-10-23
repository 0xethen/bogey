import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { IconLayoutGrid, IconPlayerPlay } from "@tabler/icons-react";
import {
  galleryEngagementQueryOptions,
  galleryQueryOptions,
  type Gallery,
} from "@bogey/db/queries/gallery";
import { voteCountsQueryOptions } from "@bogey/db/queries/votes";
import { Button } from "@bogey/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import { cn } from "@bogey/ui/lib/utils";
import { localizationQueryOptions } from "#/lib/i18n.ts";
import { availableSorts, gallerySearch, sortProjects } from "#/lib/gallery.ts";
import { useShuffleSeed } from "#/lib/slideshow.ts";
import { msg, translatorFor, useT } from "#/lib/translate.tsx";
import { LayoutToggle, SortMenu } from "#/routes/gallery/$slug/-components/gallery-controls.tsx";
import { ProjectCard } from "#/routes/gallery/$slug/-components/project-card.tsx";

export const Route = createFileRoute("/gallery/$slug/")({
  staticData: { title: msg("gallery.projects") },
  validateSearch: gallerySearch,
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

const LAYOUT_CLASS = {
  grid: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
  // columns everywhere, native grid-lanes where the browser has it
  lanes:
    "columns-1 gap-4 sm:columns-2 lg:columns-3 supports-[display:grid-lanes]:grid-lanes supports-[display:grid-lanes]:columns-auto supports-[display:grid-lanes]:[grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]",
} as const;

function RouteComponent() {
  const t = useT();
  const { slug } = Route.useParams();
  const filter = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: gallery } = useSuspenseQuery(galleryQueryOptions(slug));
  const eventId = gallery?.event.id ?? "";
  const engagement = useQuery({ ...galleryEngagementQueryOptions(eventId), enabled: !!gallery });
  const counts = useQuery({ ...voteCountsQueryOptions(eventId), enabled: !!gallery });
  const seed = useShuffleSeed();
  if (!gallery) return null;

  const { settings } = gallery;
  const votes = new Map((counts.data ?? []).map((row) => [row.submissionId, row.count]));
  const sorts = availableSorts(settings, gallery.projects, { votes });
  const sort = filter.sort && sorts.includes(filter.sort) ? filter.sort : settings.sort;
  const layout = settings.switchLayout ? (filter.layout ?? settings.layout) : settings.layout;
  const counted = new Map((engagement.data ?? []).map((row) => [row.submissionId, row]));

  const shown = sortProjects(
    gallery.projects.filter(
      (project) =>
        (!filter.form || project.formId === filter.form) &&
        (!filter.track || project.trackIds.includes(filter.track)) &&
        (!filter.division || project.divisionId === filter.division),
    ),
    sort,
    { engagement: counted, votes, seed },
  );
  const set = (patch: Partial<z.infer<typeof gallerySearch>>) =>
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
            <div className="flex items-center gap-1">
              <SortMenu value={sort} options={sorts} onChange={(next) => set({ sort: next })} />
              {settings.switchLayout && (
                <LayoutToggle value={layout} onChange={(next) => set({ layout: next })} />
              )}
              {settings.slideshow && (
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={t("gallery.slideshow")}
                  tooltip={t("gallery.slideshow")}
                  render={
                    <Link
                      to="/gallery/$slug/present"
                      params={{ slug }}
                      search={{ ...filter, sort }}
                    />
                  }
                  nativeButton={false}
                >
                  <IconPlayerPlay />
                </Button>
              )}
            </div>
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
        <div className={cn(LAYOUT_CLASS[layout])}>
          {shown.map((project) => (
            <div
              key={project.id}
              className={cn(
                layout === "lanes" && "mb-4 break-inside-avoid supports-[display:grid-lanes]:mb-0",
                layout === "grid" && project.cardSize === "large" && "lg:col-span-2",
              )}
            >
              <ProjectCard
                gallery={gallery}
                project={project}
                tracks={gallery.tracks.filter((track) => project.trackIds.includes(track.id))}
                engagement={counted.get(project.id)}
              />
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

type Filter = z.infer<typeof gallerySearch>;

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
