import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { eventsQueryOptions, type EventSummary } from "@bogey/db/queries/events";
import { isOrgAdmin } from "@bogey/db/auth";
import { Button } from "@bogey/ui/components/button";
import { IconPlus } from "@tabler/icons-react";
import { BogeyRequestError } from "@bogey/db/errors";
import { useT } from "#/lib/translate.tsx";
import { eventListIconsQueryOptions } from "#/lib/plugins.ts";
import { EventList } from "./-components/event-list.tsx";
import { useViewerSession } from "#/lib/viewer.ts";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@bogey/ui/components/empty";
import { Screen } from "@bogey/ui/components/screen";
import { Row, RowList } from "@bogey/ui/components/row";

export const Route = createFileRoute("/_authed/events/")({
  beforeLoad: ({ context }) => {
    if (!context.session.org)
      throw new BogeyRequestError({
        code: "not_found",
        message: "This address isn't connected to an organization yet.",
        retryable: false,
      });
    return { org: context.session.org };
  },
  loader: async ({ context }) => {
    const events = await context.query.ensureQueryData(eventsQueryOptions(context.org.id));
    await context.query.ensureQueryData(
      eventListIconsQueryOptions(
        context.org.id,
        events.map((event) => event.id),
      ),
    );
  },
  component: RouteComponent,
});

function hasEnded(event: EventSummary, now: Date): boolean {
  return event.ends_at !== null && new Date(event.ends_at) < now;
}

function RouteComponent() {
  const t = useT();
  const { org } = Route.useRouteContext();
  const session = useViewerSession();
  const { data: loaded } = useSuspenseQuery(eventsQueryOptions(org.id));
  const { data: icons } = useSuspenseQuery(
    eventListIconsQueryOptions(
      org.id,
      loaded.map((event) => event.id),
    ),
  );
  const admin = isOrgAdmin(session);
  const events = admin
    ? loaded.map((event) => ({ ...event, myRole: event.myRole ?? ("organizer" as const) }))
    : loaded;
  const [now] = useState(() => new Date());
  const newEvent = admin && (
    <>
      <Button
        size="icon"
        className="sm:hidden"
        aria-label={t("events.new")}
        nativeButton={false}
        render={<Link to="/events/new" />}
      >
        <IconPlus />
      </Button>
      <Button
        className="hidden sm:inline-flex"
        nativeButton={false}
        render={<Link to="/events/new" />}
      >
        <IconPlus />
        {t("events.new")}
      </Button>
    </>
  );

  const templates = events.filter((event) => event.is_template);
  const real = events.filter((event) => !event.is_template);
  const yours = real.filter((event) => event.myRole && !hasEnded(event, now));
  const open = real.filter((event) => !event.myRole && !hasEnded(event, now));
  const past = real.filter((event) => hasEnded(event, now));

  return (
    <Screen title={t("events.title")} description={org.name} actions={newEvent}>
      {real.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("events.none")}</EmptyTitle>
            <EmptyDescription>{t("events.noneBody", { org: org.name })}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {yours.length > 0 && (
            <Screen.Section title={t("events.yours")}>
              <EventList events={yours} icons={icons} to="home" showRole />
            </Screen.Section>
          )}
          {open.length > 0 && (
            <Screen.Section
              title={yours.length > 0 ? t("events.alsoHappening") : t("events.happening")}
            >
              <EventList events={open} icons={icons} to="home" showRole />
            </Screen.Section>
          )}
          {past.length > 0 && (
            <Screen.Section title={t("events.past")}>
              <EventList events={past} icons={icons} to="home" showRole />
            </Screen.Section>
          )}
        </>
      )}
      {admin && templates.length > 0 && (
        <Screen.Section title={t("events.templates")} description={t("events.templatesBody")}>
          <RowList render={<ul />}>
            {templates.map((template) => (
              <Row
                key={template.id}
                render={<li />}
                size="sm"
                title={
                  <Link
                    to="/events/$slug/manage"
                    params={{ slug: template.slug }}
                    className="truncate no-underline hover:underline"
                  >
                    {template.name}
                  </Link>
                }
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<Link to="/events/copy" search={{ from: template.id }} />}
                  >
                    {t("events.useTemplate")}
                  </Button>
                }
              />
            ))}
          </RowList>
        </Screen.Section>
      )}
    </Screen>
  );
}
