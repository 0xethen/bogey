import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { instanceOrgsQueryOptions, instanceOverviewQueryOptions } from "@bogey/db/queries/instance";
import { Badge } from "@bogey/ui/components/badge";
import { DisclosureList } from "@bogey/ui/components/disclosure-row";
import { LinkRow } from "@bogey/ui/components/link-row";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Facts } from "@bogey/ui/components/facts";
import { Screen } from "@bogey/ui/components/screen";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { formatDateTime } from "@bogey/utils/time";
import { IconBuilding, IconCalendarEvent, IconShieldCheck, IconUsers } from "@tabler/icons-react";
import { ReleaseStatus, SchemaStatus } from "./-components/schema-status.tsx";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/")({
  staticData: { command: { label: msg("adminTab.overview") } },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(instanceOverviewQueryOptions()),
      context.query.ensureQueryData(instanceOrgsQueryOptions()),
    ]),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const { data: overview } = useSuspenseQuery(instanceOverviewQueryOptions());
  const { data: orgs } = useSuspenseQuery(instanceOrgsQueryOptions());
  const time = useTimeFormat();
  const schema = overview.migrations?.at(-1) ?? __BOGEY_MIGRATIONS__.at(-1);

  return (
    <Screen title={t("adminHome.title")} description={t("adminHome.intro")}>
      <SchemaStatus applied={overview.migrations} />
      <ReleaseStatus />
      <StatGroup>
        <Stat
          icon={IconBuilding}
          label={t("adminTab.orgs")}
          value={overview.orgs}
          render={<Link to="/admin/orgs" />}
        />
        <Stat
          icon={IconCalendarEvent}
          label={t("orgTab.events")}
          value={overview.events}
          render={<Link to="/events" />}
        />
        <Stat
          icon={IconUsers}
          label={t("adminTab.people")}
          value={overview.people}
          render={<Link to="/admin/people" />}
        />
        <Stat
          icon={IconShieldCheck}
          label={t("adminHome.admins")}
          value={overview.admins}
          render={<Link to="/admin/people" />}
        />
      </StatGroup>

      <Facts
        facts={[
          { label: t("adminHome.version"), value: __BOGEY_VERSION__ },
          {
            label: t("adminHome.schema"),
            value: schema ? <code>{schema}</code> : t("adminHome.notTracked"),
          },
          {
            label: t("adminHome.setUp"),
            value: overview.setUpAt
              ? formatDateTime(overview.setUpAt, time)
              : t("adminHome.notYet"),
          },
          {
            label: t("adminHome.outbox"),
            value: (
              <>
                {overview.outbox.queued === 0 ? (
                  t("adminHome.empty")
                ) : (
                  <>
                    {t("adminHome.queued", { count: overview.outbox.queued })}
                    {overview.outbox.oldestQueuedAt && (
                      <>
                        , {t("adminHome.oldest")}{" "}
                        <RelativeTime value={overview.outbox.oldestQueuedAt} />
                      </>
                    )}
                  </>
                )}
                {overview.outbox.failed24h > 0 &&
                  `. ${t("adminHome.failed", { count: overview.outbox.failed24h })}${
                    overview.outbox.lastError ? `: ${overview.outbox.lastError}` : ""
                  }`}
              </>
            ),
          },
          {
            label: t("adminHome.settingsUpdated"),
            value: overview.settingsChangedAt
              ? formatDateTime(overview.settingsChangedAt, time)
              : t("adminHome.never"),
          },
        ]}
      />

      <Screen.Section id="organizations" title={t("adminTab.orgs")}>
        <DisclosureList className="border-y-0">
          {orgs.slice(0, 8).map((org) => (
            <LinkRow
              key={org.id}
              render={<Link to="/admin/orgs" hash={org.slug} />}
              leading={<NameAvatar name={org.name} />}
              title={
                <>
                  {org.name}
                  {org.status === "suspended" && (
                    <Badge variant="outline">{t("suspended.title")}</Badge>
                  )}
                </>
              }
              meta={[
                org.hostnames[0] ?? org.slug,
                t("adminHome.events", { count: org.events }),
                t("adminHome.members", { count: org.members }),
              ].join(" · ")}
            />
          ))}
        </DisclosureList>
      </Screen.Section>
    </Screen>
  );
}
