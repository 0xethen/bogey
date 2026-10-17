import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink, useParams } from "@tanstack/react-router";
import { IconFileCode, IconHourglass, IconListDetails } from "@tabler/icons-react";
import { pluginPageUrl } from "@bogey/plugins/api";
import type { PluginContext } from "@bogey/plugins/runtime";
import { Button } from "@bogey/ui/components/button";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import { Stat, StatGroup } from "@bogey/ui/components/stat";
import { useNow } from "@bogey/ui/hooks/now";
import { contestOverviewQueryOptions } from "../db.ts";
import { manifest } from "../manifest.ts";
import { useContest, type Settings } from "../shared.tsx";

const STYLES: Record<Settings["scoring"], string> = {
  icpc: "ICPC scoring",
  ioi: "IOI scoring",
  golf: "Code golf scoring",
};

/** The Contest section of Manage → Overview: where the contest stands, and the way to its settings. */
export function ManageOverview({ eventId, settings }: PluginContext<Settings>) {
  const { slug } = useParams({ strict: false });
  const { window: contest, running } = useContest(eventId);
  const now = useNow(60_000);
  const { data } = useQuery(contestOverviewQueryOptions(eventId));
  if (settings.format === "ctf" || !slug) return null;

  const page = manifest.settingsPages?.[0];
  const settingsUrl = page ? pluginPageUrl(manifest, "manage", `/${page.key}`, slug) : null;
  const upcoming = contest?.opens_at && now !== null && new Date(contest.opens_at).getTime() > now;

  return (
    <Screen.Section
      id="contest"
      title="Contest"
      actions={
        settingsUrl && (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<RouterLink to={settingsUrl} />}
          >
            All settings
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-fg">
          {!contest ? (
            <>
              No contest window is set. Add one in{" "}
              <RouterLink className="link" to={`/events/${slug}/manage/agenda`} hash="windows">
                Agenda
              </RouterLink>
              .
            </>
          ) : running ? (
            contest.closes_at ? (
              <>
                Running. It ends <RelativeTime value={contest.closes_at} />.
              </>
            ) : (
              "Running now."
            )
          ) : upcoming && contest.opens_at ? (
            <>
              Starts <RelativeTime value={contest.opens_at} />.
            </>
          ) : (
            "The contest is over."
          )}{" "}
          {STYLES[settings.scoring]}.
        </p>
        {data && (
          <StatGroup>
            <Stat
              icon={IconListDetails}
              label={data.hidden > 0 ? `Problems (${data.hidden} hidden)` : "Problems"}
              value={data.problems}
            />
            <Stat icon={IconFileCode} label="Solutions sent" value={data.solutions} />
            <Stat icon={IconHourglass} label="Waiting for judgement" value={data.waiting} />
          </StatGroup>
        )}
      </div>
    </Screen.Section>
  );
}
