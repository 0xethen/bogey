import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eventTeamsQueryOptions } from "@bogey/db/queries/roster";
import {
  applyTeamMatchingFn,
  teamMatchingOverviewQueryOptions,
} from "@bogey/db/queries/team-board";
import { unwrap } from "@bogey/db/errors";
import { propose, type Proposal } from "@bogey/utils/team-matcher";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "@bogey/ui/components/number-field";
import { Panel } from "@bogey/ui/components/panel";
import { Label } from "@bogey/ui/components/label";
import { useT } from "#/lib/translate.tsx";

export function TeamMatcher({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const overview = useQuery(teamMatchingOverviewQueryOptions(eventId));
  const [target, setTarget] = useState<number | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const apply = useMutation({
    mutationFn: async (groups: Proposal["groups"]) =>
      unwrap(await applyTeamMatchingFn({ data: { eventId, groups } })),
    onSuccess: async () => {
      setProposal(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventTeamsQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({
          queryKey: teamMatchingOverviewQueryOptions(eventId).queryKey,
        }),
      ]);
      onDone();
    },
  });

  const data = overview.data;
  if (!data)
    return (
      <ErrorAlert
        error={overview.error instanceof Error ? overview.error : null}
        title={t("teamMatch.loadFailed")}
      />
    );
  const size = target ?? data.max;
  const names = new Map(data.people.map((person) => [person.id, person.name]));
  const teamNames = new Map(data.teams.map((team) => [team.id, team.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  return (
    <Panel
      title={t("teamMatch.title")}
      description={t("teamMatch.help", { count: data.people.length })}
      action={
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="match-size">{t("teamMatch.aimFor")}</Label>
          <NumberField
            id="match-size"
            value={size}
            min={data.min}
            max={data.max}
            onValueChange={(value) => {
              setTarget(value);
              setProposal(null);
            }}
            className="w-36"
          >
            <NumberFieldGroup>
              <NumberFieldDecrement />
              <NumberFieldInput />
              <NumberFieldIncrement />
            </NumberFieldGroup>
          </NumberField>
        </div>
        <Button
          variant="outline"
          disabled={data.people.length === 0}
          onClick={() =>
            setProposal(
              propose(
                data.people,
                data.teams,
                { min: data.min, max: data.max, target: size },
                (n) => t("teamMatch.newName", { number: n }),
              ),
            )
          }
        >
          {proposal ? t("teamMatch.again") : t("teamMatch.propose")}
        </Button>
      </div>

      {proposal && (
        <div className="flex flex-col gap-3">
          {proposal.groups.length === 0 && (
            <p className="text-sm text-muted-fg">{t("teamMatch.nothing")}</p>
          )}
          <ul className="flex flex-col gap-2">
            {proposal.groups.map((group, index) => (
              <li
                key={group.team ?? `new-${index}`}
                className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {group.team
                    ? t("teamMatch.addTo", { team: teamNames.get(group.team) ?? "" })
                    : t("teamMatch.newTeam", { team: group.name ?? "" })}
                </span>
                <span className="text-muted-fg">{group.members.map(nameOf).join(", ")}</span>
              </li>
            ))}
          </ul>
          {proposal.unmatched.length > 0 && (
            <p className="text-sm text-muted-fg">
              {t("teamMatch.noPlace", { names: proposal.unmatched.map(nameOf).join(", ") })}
            </p>
          )}
          <ErrorAlert error={apply.error} title={t("teamMatch.applyFailed")} />
          <div>
            <Button
              disabled={apply.isPending || proposal.groups.length === 0}
              confirm={{
                title: t("teamMatch.confirmTitle"),
                description: t("teamMatch.confirmBody"),
                label: t("teamMatch.confirmLabel"),
                variant: "default",
              }}
              onClick={() => apply.mutate(proposal.groups)}
            >
              {t("teamMatch.apply")}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
