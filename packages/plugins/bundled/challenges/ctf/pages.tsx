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
  FieldSelect,
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
  type ChallengeInput,
} from "./database.ts";

function messageOf(error: unknown): string | null {
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
      description={`${challenge.points} points · ${challenge.solves} ${challenge.solves === 1 ? "solve" : "solves"}${challenge.first_blood ? ` · first blood: ${challenge.first_blood}` : ""}`}
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
              <TableHead className="text-right">First bloods</TableHead>
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
                <TableCell className="text-right">{row.first_bloods}</TableCell>
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

const BLANK: ChallengeInput = {
  title: "",
  category: "misc",
  description_md: "",
  scoring: "static",
  points_initial: 100,
  points_min: 100,
  decay: 20,
  visible: true,
  hints: [],
};

const SCORING = [
  { value: "static", label: "Fixed points" },
  { value: "dynamic", label: "Points fall as teams solve it" },
] as const;

const challengeSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Give it a title")
      .max(120, "Keep it under 120 characters")
      .meta({ label: "Title" }),
    category: z
      .string()
      .trim()
      .min(1, "Give it a category")
      .max(40, "Keep it under 40 characters")
      .meta({ label: "Category", placeholder: "misc" }),
    description: z.string().max(20_000).meta({ label: "Description" }),
    scoring: z.enum(["static", "dynamic"]).meta({ label: "Scoring" }),
    pointsInitial: z.int().min(0, "0 or more").meta({ label: "Starting points" }),
    pointsMin: z.int().min(0, "0 or more").meta({ label: "Lowest points" }),
    decay: z.int().min(1, "At least 1").meta({ label: "Solves until lowest" }),
    visible: z.boolean().meta({ label: "Visible to teams" }),
    flagKind: z.enum(["keep", "static", "regex"]).meta({ label: "Flag" }),
    flag: z.string().meta({ label: "Flag", placeholder: "flag{...}" }),
    caseSensitive: z.boolean().meta({ label: "Match case" }),
    hints: z.array(
      z.object({
        id: z.string(),
        cost: z.int().min(0, "0 or more").meta({ label: "Cost" }),
        content: z.string().trim().min(1, "Write the hint").meta({ label: "Hint" }),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.flagKind !== "keep" && !value.flag.trim()) {
      ctx.addIssue({ code: "custom", path: ["flag"], message: "Enter the flag" });
    }
    if (value.scoring === "dynamic" && value.pointsMin > value.pointsInitial) {
      ctx.addIssue({ code: "custom", path: ["pointsMin"], message: "At most the starting points" });
    }
  });

type ChallengeValues = z.input<typeof challengeSchema>;

function valuesOf(start: ChallengeInput, editing: boolean): ChallengeValues {
  return {
    title: start.title,
    category: start.category,
    description: start.description_md,
    scoring: start.scoring,
    pointsInitial: start.points_initial,
    pointsMin: start.points_min,
    decay: start.decay,
    visible: start.visible,
    flagKind: editing ? "keep" : "static",
    flag: "",
    caseSensitive: true,
    hints: start.hints.map((hint) => ({
      id: crypto.randomUUID(),
      cost: hint.cost,
      content: hint.content_md,
    })),
  };
}

function ChallengeForm({
  eventId,
  id,
  start,
  onDone,
}: {
  eventId: string;
  id?: string;
  start: ChallengeInput;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: valuesOf(start, id !== undefined),
      errorVisibility,
      validators: [rewardEarlyPunishLate(challengeSchema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      const body: ChallengeInput = {
        title: value.title.trim(),
        category: value.category.trim(),
        description_md: value.description,
        scoring: value.scoring,
        points_initial: value.pointsInitial,
        points_min: value.scoring === "static" ? value.pointsInitial : value.pointsMin,
        decay: value.decay,
        visible: value.visible,
        hints: value.hints.map((hint) => ({ cost: hint.cost, content_md: hint.content.trim() })),
        ...(value.flagKind === "keep"
          ? {}
          : { flag_kind: value.flagKind, flag: value.flag, case_sensitive: value.caseSensitive }),
      };
      const { error } = await client().rpc("ctf_save_challenge", {
        p_event: eventId,
        p_id: id,
        p_data: body,
      });
      if (error) return createValidationError(userMessage(error, classify(error)));
      await queryClient.invalidateQueries({ queryKey: ["ctf"] });
      onDone();
      return undefined;
    },
  });
  const flagKinds = [
    ...(id ? [{ value: "keep" as const, label: "Keep the current flag" }] : []),
    { value: "static" as const, label: "The exact flag" },
    { value: "regex" as const, label: "Any flag matching a pattern" },
  ];
  return (
    <Panel size="sm" title={id ? "Edit challenge" : "New challenge"}>
      <form.AppForm>
        <form.Form unsaved="draft" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="title">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="category">{(field) => <field.TextField required />}</form.Field>
          </div>
          <form.Field name="description">{(field) => <field.MarkdownField rows={5} />}</form.Field>
          <div className="grid gap-4 sm:grid-cols-4">
            <form.Field name="scoring">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect field={field} options={SCORING} />
                </field.Field>
              )}
            </form.Field>
            <form.Field name="pointsInitial">{(field) => <field.NumberField min={0} />}</form.Field>
            <form.Subscribe selector={(state) => state.values.scoring === "dynamic"}>
              {(dynamic) =>
                dynamic && (
                  <>
                    <form.Field name="pointsMin">
                      {(field) => <field.NumberField min={0} />}
                    </form.Field>
                    <form.Field name="decay">{(field) => <field.NumberField min={1} />}</form.Field>
                  </>
                )
              }
            </form.Subscribe>
          </div>
          <form.Field name="visible">{(field) => <field.SwitchField />}</form.Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <form.Field name="flagKind">
              {(field) => (
                <field.Field>
                  <field.Label />
                  <FieldSelect field={field} options={flagKinds} />
                </field.Field>
              )}
            </form.Field>
            <form.Subscribe selector={(state) => state.values.flagKind}>
              {(flagKind) =>
                flagKind !== "keep" && (
                  <div className="flex flex-wrap items-end gap-4">
                    <div className="min-w-48 flex-1">
                      <form.Field name="flag">
                        {(field) => (
                          <field.TextField
                            required
                            autoComplete="off"
                            label={flagKind === "regex" ? "Pattern" : "Flag"}
                            placeholder={flagKind === "regex" ? "flag\\{[a-f0-9]{8}\\}" : undefined}
                          />
                        )}
                      </form.Field>
                    </div>
                    <form.Field name="caseSensitive">{(field) => <field.SwitchField />}</form.Field>
                  </div>
                )
              }
            </form.Subscribe>
          </div>
          <form.ArrayField name="hints">
            {(hints) => (
              <div className="flex flex-col gap-3">
                {hints.value.map((hint, index) => (
                  <div key={hint.id} className="flex flex-wrap items-start gap-2">
                    <div className="w-28">
                      <form.Field name={`hints[${index}].cost`}>
                        {(field) => <field.NumberField min={0} />}
                      </form.Field>
                    </div>
                    <div className="min-w-48 flex-1">
                      <form.Field name={`hints[${index}].content`}>
                        {(field) => <field.TextField required />}
                      </form.Field>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="mt-6"
                      onClick={() => hints.removeValue(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      hints.pushValue({ id: crypto.randomUUID(), cost: 10, content: "" })
                    }
                  >
                    Add a hint
                  </Button>
                </div>
              </div>
            )}
          </form.ArrayField>
          <form.FormAlert title="Couldn't save the challenge" />
          <div className="flex flex-wrap gap-2">
            <form.Submit pending="Saving...">Save</form.Submit>
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form.Form>
      </form.AppForm>
    </Panel>
  );
}

export function ManagePage({ eventId }: PluginContext) {
  const queryClient = useQueryClient();
  const challenges = useQuery(challengesQueryOptions(eventId));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client().rpc("ctf_delete_challenge", { p_id: id });
      return unwrap(error ? toFailure(error, "deleting the challenge") : ok(undefined));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ctf"] }),
  });
  const current = challenges.data?.find((challenge) => challenge.id === editing);
  return (
    <Screen
      title="Edit challenges"
      description="Flags are stored hashed, so they can't be shown again."
    >
      <ErrorAlert error={messageOf(challenges.error ?? remove.error)} />
      {editing === "new" && (
        <ChallengeForm eventId={eventId} start={BLANK} onDone={() => setEditing(null)} />
      )}
      {current && (
        <ChallengeForm
          key={current.id}
          eventId={eventId}
          id={current.id}
          start={{
            ...BLANK,
            title: current.title,
            category: current.category,
            description_md: current.description_md,
            points_initial: current.points,
            points_min: current.points,
            hints: current.hints.map((hint) => ({
              cost: hint.cost,
              content_md: hint.content_md ?? "",
            })),
          }}
          onDone={() => setEditing(null)}
        />
      )}
      {editing === null && (
        <div>
          <Button onClick={() => setEditing("new")}>New challenge</Button>
        </div>
      )}
      {challenges.data && challenges.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Challenge</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Points now</TableHead>
              <TableHead className="text-right">Solves</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {challenges.data.map((challenge) => (
              <TableRow key={challenge.id}>
                <TableCell>{challenge.title}</TableCell>
                <TableCell>{challenge.category}</TableCell>
                <TableCell className="text-right">{challenge.points}</TableCell>
                <TableCell className="text-right">{challenge.solves}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(challenge.id)}>
                    Edit...
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    confirm={{
                      title: `Delete ${challenge.title}?`,
                      description: "Its solves are deleted with it and scores change.",
                      label: "Delete challenge",
                    }}
                    onClick={() => remove.mutate(challenge.id)}
                  >
                    Delete...
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Screen>
  );
}
