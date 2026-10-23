import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconEdit, IconPlus, IconTrash } from "@tabler/icons-react";
import { classify, ok, toFailure, unwrap, userMessage } from "@bogey/db/errors";
import type { PluginRouteContext } from "@bogey/plugins/runtime";
import { Badge } from "@bogey/ui/components/badge";
import { Button, ButtonLabel } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Screen } from "@bogey/ui/components/screen";
import { Skeleton } from "@bogey/ui/components/skeleton";
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
import { Link, problemSlug, useGoTo, type Settings } from "../shared.tsx";
import { messageOf } from "./pages.tsx";
import {
  client,
  juryChallengesQueryOptions,
  type ChallengeInput,
  type JuryChallenge,
} from "./database.ts";

type Context = PluginRouteContext<Settings>;

// /jury lists the challenges; /jury/<id> edits one and /jury/new adds one, like a contest's problems
export function CtfJuryPage({ eventId, splat }: Context) {
  const id = problemSlug(splat);
  const challenges = useQuery(juryChallengesQueryOptions(eventId));
  if (!id) return <CtfJuryHome eventId={eventId} />;
  if (challenges.isPending) return <Screen.Skeleton width="narrow" />;
  const challenge = challenges.data?.find((each) => each.id === id);
  if (id !== "new" && !challenge) {
    return (
      <Screen title="Challenge not found" width="narrow">
        <ErrorAlert error={messageOf(challenges.error)} title="Can't show challenges" />
        <p className="text-sm text-muted-fg">It may have been deleted.</p>
        <div>
          <BackToJury />
        </div>
      </Screen>
    );
  }
  return <ChallengeEditor key={id} eventId={eventId} challenge={challenge} />;
}

function BackToJury() {
  return (
    <Button variant="outline" nativeButton={false} render={<Link to="/jury" />}>
      <IconArrowLeft />
      All challenges
    </Button>
  );
}

function CtfJuryHome({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const challenges = useQuery(juryChallengesQueryOptions(eventId));
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client().rpc("ctf_delete_challenge", { p_id: id });
      return unwrap(error ? toFailure(error, "deleting the challenge") : ok(undefined));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ctf"] }),
  });
  return (
    <Screen
      title="Jury"
      width="wide"
      description="Write the challenges, their flags and hints. Flags are stored hashed, so they can't be shown again."
      actions={
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/scoreboard" />}
            nativeButton={false}
          >
            Scoreboard
          </Button>
          <Button size="sm" render={<Link to="/jury" splat="new" />} nativeButton={false}>
            <IconPlus />
            Add a challenge
          </Button>
        </div>
      }
    >
      <ErrorAlert error={messageOf(challenges.error ?? remove.error)} title="Couldn't do that" />
      <Screen.Section title="Challenges">
        {challenges.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : (challenges.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-fg">No challenges yet.</p>
        ) : (
          <div className="overflow-x-auto">
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
                {challenges.data?.map((challenge) => (
                  <TableRow key={challenge.id}>
                    <TableCell className="font-medium">
                      <Link to="/jury" splat={challenge.id}>
                        {challenge.title}
                      </Link>
                      {!challenge.visible && (
                        <Badge variant="outline" className="ml-2">
                          Hidden
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{challenge.category}</TableCell>
                    <TableCell className="text-right">{challenge.points}</TableCell>
                    <TableCell className="text-right">{challenge.solves}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm-icon-on-phones"
                          variant="ghost"
                          aria-label={`Edit ${challenge.title}`}
                          tooltip="Edit"
                          render={<Link to="/jury" splat={challenge.id} />}
                          nativeButton={false}
                        >
                          <IconEdit />
                          <ButtonLabel>Edit</ButtonLabel>
                        </Button>
                        <Button
                          size="sm-icon-on-phones"
                          variant="destructive"
                          aria-label={`Delete ${challenge.title}...`}
                          tooltip="Delete..."
                          confirm={{
                            title: `Delete ${challenge.title}?`,
                            description: "Its solves are deleted with it and scores change.",
                            label: "Delete challenge",
                          }}
                          onClick={() => remove.mutate(challenge.id)}
                        >
                          <IconTrash />
                          <ButtonLabel>Delete...</ButtonLabel>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Screen.Section>
    </Screen>
  );
}

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

function valuesOf(challenge: JuryChallenge | undefined): ChallengeValues {
  return {
    title: challenge?.title ?? "",
    category: challenge?.category ?? "misc",
    description: challenge?.description_md ?? "",
    scoring: challenge?.scoring ?? "static",
    pointsInitial: challenge?.points_initial ?? 100,
    pointsMin: challenge?.points_min ?? 100,
    decay: challenge?.decay ?? 20,
    visible: challenge?.visible ?? true,
    flagKind: challenge?.flag_kind ? "keep" : "static",
    flag: "",
    caseSensitive: challenge?.case_sensitive ?? true,
    hints: (challenge?.hints ?? []).map((hint) => ({
      id: crypto.randomUUID(),
      cost: hint.cost,
      content: hint.content_md,
    })),
  };
}

function ChallengeEditor({
  eventId,
  challenge,
}: {
  eventId: string;
  challenge: JuryChallenge | undefined;
}) {
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: valuesOf(challenge),
      errorVisibility,
      validators: [rewardEarlyPunishLate(challengeSchema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
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
      const { data: id, error } = await client().rpc("ctf_save_challenge", {
        p_event: eventId,
        p_id: challenge?.id,
        p_data: body,
      });
      if (error) return createValidationError(userMessage(error, classify(error)));
      // a kept flag stays kept; a new one is hashed now and can't be shown again
      formApi.reset({ ...value, flagKind: "keep", flag: "" });
      await queryClient.invalidateQueries({ queryKey: ["ctf"] });
      if (!challenge) await goTo("/jury", { splat: id, replace: true });
      return undefined;
    },
  });
  const flagKinds = [
    ...(challenge?.flag_kind ? [{ value: "keep" as const, label: "Keep the current flag" }] : []),
    { value: "static" as const, label: "The exact flag" },
    { value: "regex" as const, label: "Any flag matching a pattern" },
  ];
  return (
    <Screen
      title={challenge ? challenge.title : "New challenge"}
      description={
        challenge
          ? `${challenge.points} points now · ${challenge.solves} ${challenge.solves === 1 ? "solve" : "solves"}`
          : "Flags are stored hashed, so keep your own copy."
      }
      width="narrow"
      actions={<BackToJury />}
    >
      <form.AppForm>
        <form.Form
          unsaved={challenge ? "save" : "draft"}
          anchor="challenge"
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="title">{(field) => <field.TextField required />}</form.Field>
            <form.Field name="category">{(field) => <field.TextField required />}</form.Field>
          </div>
          <form.Field name="description">{(field) => <field.MarkdownField rows={8} />}</form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
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
                      size="sm-icon-on-phones"
                      variant="ghost"
                      className="mt-6"
                      aria-label={`Remove hint ${index + 1}`}
                      tooltip="Remove"
                      onClick={() => hints.removeValue(index)}
                    >
                      <IconTrash />
                      <ButtonLabel>Remove</ButtonLabel>
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
                    <IconPlus />
                    Add a hint
                  </Button>
                </div>
              </div>
            )}
          </form.ArrayField>
          <form.FormAlert title="Couldn't save the challenge" />
          {!challenge && (
            <div>
              <form.Submit pending="Adding...">Add the challenge</form.Submit>
            </div>
          )}
        </form.Form>
      </form.AppForm>
    </Screen>
  );
}
