import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { sessionQueryOptions } from "@bogey/db/auth";
import { portfolioQueryOptions, type Portfolio } from "@bogey/db/queries/profile";
import { Badge } from "@bogey/ui/components/badge";
import { Markdown } from "@bogey/ui/components/markdown";
import { Screen } from "@bogey/ui/components/screen";
import { PublicBar } from "#/components/navigation/header/PublicBar.tsx";
import { ProfileLinkIcon, profileLinkLabel } from "#/components/profile/link-kinds.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/@{$handle}/")({
  staticData: { title: msg("accountNav.profile"), command: false },
  loader: async ({ context, params }) => {
    const [portfolio] = await Promise.all([
      context.query.query({ ...portfolioQueryOptions(params.handle), staleTime: "static" }),
      context.query.query({ ...sessionQueryOptions(), staleTime: "static" }),
    ]);
    if (!portfolio) throw notFound();
    return { title: portfolio.name };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    return {
      meta: [
        { property: "og:title", content: loaderData.title },
        { property: "og:type", content: "profile" },
      ],
    };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { handle } = Route.useParams();
  const { data: portfolio } = useSuspenseQuery(portfolioQueryOptions(handle));
  const { data: session } = useSuspenseQuery(sessionQueryOptions());
  if (!portfolio) return null;
  return (
    <>
      <PublicBar
        orgName={session.status === "authenticated" ? session.session.org?.name : undefined}
      />
      <PortfolioPage portfolio={portfolio} />
    </>
  );
}

function PortfolioPage({ portfolio }: { portfolio: Portfolio }) {
  const t = useT();
  return (
    <Screen
      title={portfolio.name}
      description={[`@${portfolio.handle}`, portfolio.pronouns].filter(Boolean).join(" · ")}
      width="narrow"
    >
      {portfolio.bio && <Markdown>{portfolio.bio}</Markdown>}
      {portfolio.links.length > 0 && (
        <ul className="flex flex-wrap gap-3 text-sm">
          {portfolio.links.map((link) => (
            <li key={`${link.kind}:${link.url}`}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener nofollow ugc"
                className="inline-flex items-center gap-1.5"
              >
                <ProfileLinkIcon kind={link.kind} className="size-4" />
                {profileLinkLabel(link.kind, t)}
              </a>
            </li>
          ))}
        </ul>
      )}
      {portfolio.awards.length > 0 && (
        <Screen.Section id="awards" title={t("results.awards")}>
          <ul className="flex flex-col gap-2 text-sm">
            {portfolio.awards.map((award) => (
              <li key={`${award.event}:${award.label}:${award.project}`}>
                <Badge className="mr-2">{award.place ? `#${award.place}` : award.kind}</Badge>
                {t("portfolio.awardAt", { label: award.label, project: award.project })}{" "}
                <Link to="/gallery/$slug" params={{ slug: award.event }}>
                  {award.eventName}
                </Link>
              </li>
            ))}
          </ul>
        </Screen.Section>
      )}
      {portfolio.projects.length > 0 && (
        <Screen.Section id="projects" title={t("gallery.projects")}>
          <ul className="flex flex-col gap-2 text-sm">
            {portfolio.projects.map((project) => (
              <li key={project.id}>
                <Link
                  to="/gallery/$slug/$projectId"
                  params={{ slug: project.event, projectId: project.id }}
                >
                  {project.title || t("judging.untitled")}
                </Link>{" "}
                <span className="text-muted-fg">
                  {t("portfolio.with", { team: project.team, event: project.eventName })}
                </span>
              </li>
            ))}
          </ul>
        </Screen.Section>
      )}
      {portfolio.events.length > 0 && (
        <Screen.Section id="events" title={t("orgTab.events")}>
          <ul className="flex flex-col gap-1 text-sm">
            {portfolio.events.map((event) => (
              <li key={event.slug}>{event.name}</li>
            ))}
          </ul>
        </Screen.Section>
      )}
    </Screen>
  );
}
