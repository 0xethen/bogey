import { useState } from "react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { classify, ok, toFailure, unwrap, userMessage } from "@bogey/db/errors";
import type { PluginContext } from "@bogey/plugins/runtime";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Markdown } from "@bogey/ui/components/markdown";
import { Panel } from "@bogey/ui/components/panel";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Screen } from "@bogey/ui/components/screen";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bogey/ui/components/table";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { signals } from "../shared.tsx";
import { flagMessage, groupByCategory, isFlagResult } from "./categories.ts";
import {
  challengesQueryOptions,
  client,
  scoreboardQueryOptions,
  type Challenge,
} from "./database.ts";

export function messageOf(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error.message : "Something went wrong.";
}

function HintRow({
  challenge,
  hint,
  canPlay,
}: {
  challenge: Challenge;
  hint: Challenge["hints"][number];
  canPlay: boolean;
}) {
  const queryClient = useQueryClient();
  const unlock = useMutation({
    mutationFn: async () => {
      const { error } = await client().rpc("ctf_unlock_hint", {
        p_challenge: challenge.id,
        p_ordinal: hint.ordinal,
      });
      return unwrap(error ? toFailure(error, "unlocking the hint") : ok(undefined));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ctf"] }),
  });
  if (hint.content_md !== null) {
    return (
      <div className="rounded-2xl bg-muted p-3 text-sm">
        <Markdown>{hint.content_md}</Markdown>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!canPlay || unlock.isPending}
          onClick={() => unlock.mutate()}
        >
          {`Hint ${hint.ordinal} (costs ${hint.cost})...`}
        </Button>
      </div>
      <ErrorAlert error={messageOf(unlock.error)} />
    </div>
  );
}

const flagSchema = z.object({
  flag: z.string().trim().min(1, "Enter a flag").meta({ label: "Flag", placeholder: "flag{...}" }),
});

function ChallengeCard({
  eventId,
  challenge,
  canPlay,
}: {
  eventId: string;
  challenge: Challenge;
  canPlay: boolean;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { flag: "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(flagSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const { data, error } = await client().rpc("ctf_submit_flag", {
        p_challenge: challenge.id,
        p_flag: value.flag.trim(),
      });
      if (error) return createValidationError(userMessage(error, classify(error)));
      if (data === "correct" || data === "incorrect") {
        signals.emit(data === "correct" ? "flag-correct" : "flag-wrong", eventId);
      }
      setResult(isFlagResult(data) ? flagMessage(data) : data);
      if (data === "correct") formApi.reset();
      await queryClient.invalidateQueries({ queryKey: ["ctf"] });
      return undefined;
    },
  });
  return (
    <Panel
      size="sm"
      title={challenge.title}
      description={`${challenge.points} points · ${challenge.solves} ${challenge.solves === 1 ? "solve" : "solves"}${challenge.first_solve ? ` · first solved by ${challenge.first_solve}` : ""}`}
      action={challenge.solved ? <Badge>Solved</Badge> : undefined}
    >
      <Markdown>{challenge.description_md}</Markdown>
      {challenge.hints.map((hint) => (
        <HintRow key={hint.ordinal} challenge={challenge} hint={hint} canPlay={canPlay} />
      ))}
      {!challenge.solved && canPlay && (
        <form.AppForm>
          <form.Form className="flex flex-wrap items-start gap-2">
            <div className="min-w-48 flex-1">
              <form.Field name="flag">
                {(field) => (
                  <field.Field>
                    <field.TextInput
                      autoComplete="off"
                      aria-label={`Flag for ${challenge.title}`}
                    />
                    <field.Error />
                  </field.Field>
                )}
              </form.Field>
            </div>
            <form.Submit pending="Checking...">Submit</form.Submit>
          </form.Form>
          <form.FormAlert />
        </form.AppForm>
      )}
      {result && <p className="text-sm">{result}</p>}
    </Panel>
  );
}

export function ChallengesPage({ eventId }: PluginContext) {
  const challenges = useQuery(challengesQueryOptions(eventId));
  const groups = groupByCategory(challenges.data ?? []);
  return (
    <Screen title="Challenges" description="Find the flags to solve a challenge for your team.">
      <ErrorAlert error={messageOf(challenges.error)} title="Can't show challenges" />
      {challenges.data?.length === 0 && <p className="text-sm text-muted-fg">No challenges yet.</p>}
      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-3">
          <h2 className="font-heading text-lg capitalize">{group.category}</h2>
          {group.challenges.map((challenge) => (
            <ChallengeCard key={challenge.id} eventId={eventId} challenge={challenge} canPlay />
          ))}
        </section>
      ))}
    </Screen>
  );
}

export function ScoreboardPage({ eventId, settings }: PluginContext) {
  const board = useQuery(scoreboardQueryOptions(eventId));
  return (
    <Screen
      title="Scoreboard"
      description={
        settings.freezeAt ? "The board freezes at the time the organizers set." : undefined
      }
    >
      <ErrorAlert error={messageOf(board.error)} title="No scoreboard to show" />
      {board.data?.length === 0 && <p className="text-sm text-muted-fg">No solves yet.</p>}
      {board.data && board.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Team</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead className="text-right">Solves</TableHead>
              <TableHead className="text-right">First solves</TableHead>
              <TableHead>Last solve</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.data.map((row) => (
              <TableRow key={`${row.rank}:${row.team_name}`}>
                <TableCell>{row.rank}</TableCell>
                <TableCell>{row.team_name}</TableCell>
                <TableCell className="text-right">{row.score}</TableCell>
                <TableCell className="text-right">{row.solves}</TableCell>
                <TableCell className="text-right">{row.first_solves}</TableCell>
                <TableCell>
                  <RelativeTime value={row.last_solve_at} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Screen>
  );
}
