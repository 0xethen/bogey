import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { IconCheck, IconCopy, IconDatabase } from "@tabler/icons-react";
import { pluginPageUrl } from "@bogey/plugins/api";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import {
  bankQueryOptions,
  copyProblem,
  juryEventsQueryOptions,
  problemLabelsQueryOptions,
  problemsQueryOptions,
  saveToBank,
  type Problem,
} from "../db.ts";
import { manifest } from "../manifest.ts";
import { nextId } from "../shared.tsx";
import { useChallenges } from "../context.tsx";

/** Categories already in the bank, for the category field to suggest. */
export function useBankCategories(orgId: string | null): string[] {
  const bank = useQuery({ ...bankQueryOptions(orgId ?? ""), enabled: !!orgId });
  return [...new Set((bank.data ?? []).map((each) => each.category).filter(Boolean))].sort();
}

/** The problem editor's Reuse tab: keep it in the org's bank, or copy it to another contest. */
export function ReuseProblem({ problem }: { problem: Problem }) {
  const { orgId } = useChallenges();
  return (
    <>
      <SaveToBank problem={problem} />
      {orgId && <CopyToContest orgId={orgId} problem={problem} />}
    </>
  );
}

function SaveToBank({ problem }: { problem: Problem }) {
  const { eventId, orgId } = useChallenges();
  const queryClient = useQueryClient();
  const categories = useBankCategories(orgId);
  const [category, setCategory] = useState("");
  const banked = problem.bank_problem_id !== null;
  const save = useMutation({
    mutationFn: () => saveToBank(problem.id, banked && !category.trim() ? null : category.trim()),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: problemsQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: ["challenges", "bank"] }),
      ]),
  });
  return (
    <Screen.Section
      title="Problem bank"
      description="The organization's problems, outside any event. Saving copies this problem's statement, limits, scripts, tests and jury solutions there, so another contest can use it. Its PDF and files stay here."
    >
      <div className="flex flex-col gap-4">
        {banked && (
          <p className="flex items-center gap-2 text-sm">
            <IconCheck className="size-4 text-success" />
            It's in the bank. Saving again replaces the bank's copy with this one.
          </p>
        )}
        <Field className="sm:w-72">
          <FieldLabel htmlFor="bank-category">Category</FieldLabel>
          <Input
            id="bank-category"
            list="bank-categories"
            maxLength={60}
            placeholder={banked ? "Keep its category" : "Graphs, warm-ups..."}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
          <datalist id="bank-categories">
            {categories.map((each) => (
              <option key={each} value={each} />
            ))}
          </datalist>
          <FieldDescription>Optional. The bank groups and filters by it.</FieldDescription>
        </Field>
        <ErrorAlert error={save.error} title="Couldn't save it to the bank" />
        {save.isSuccess && <p className="text-sm text-success">Saved to the bank.</p>}
        <div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <IconDatabase />
            {save.isPending ? "Saving..." : banked ? "Save to the bank again" : "Save to the bank"}
          </Button>
        </div>
      </div>
    </Screen.Section>
  );
}

function CopyToContest({ orgId, problem }: { orgId: string; problem: Problem }) {
  const { eventId, settings } = useChallenges();
  const events = useQuery(juryEventsQueryOptions(orgId));
  const others = (events.data ?? []).filter((each) => each.id !== eventId);
  const [target, setTarget] = useState<string | null>(null);
  const picked = others.find((each) => each.id === target) ?? others[0];
  const labels = useQuery({
    ...problemLabelsQueryOptions(picked?.id ?? ""),
    enabled: !!picked,
  });
  const [label, setLabel] = useState<string | null>(null);
  const suggested = labels.data ? nextId(settings.idKind, labels.data) : "";
  const copy = useMutation({
    mutationFn: () => {
      if (!picked) throw new Error("Pick a contest.");
      return copyProblem(problem.id, picked.id, (label ?? suggested).trim());
    },
  });

  return (
    <Screen.Section
      title="Copy to another contest"
      description="Puts a copy in another of the organization's contests where you're on the jury, with its tests and jury solutions, which are judged again there. Changing either copy leaves the other alone."
    >
      {events.isSuccess && others.length === 0 ? (
        <p className="text-sm text-muted-fg">
          You're not on the jury of another contest in this organization.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field className="sm:w-72">
              <FieldLabel htmlFor="copy-target">Contest</FieldLabel>
              <OptSelect
                id="copy-target"
                ariaLabel="Contest"
                value={picked?.id ?? null}
                placeholder="Pick a contest"
                options={others.map((each) => ({ value: each.id, label: each.name }))}
                onChange={(next) => {
                  setTarget(next);
                  setLabel(null);
                  copy.reset();
                }}
              />
            </Field>
            <Field className="w-28">
              <FieldLabel htmlFor="copy-label">ID there</FieldLabel>
              <Input
                id="copy-label"
                maxLength={16}
                value={label ?? suggested}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Button
              disabled={!picked || !(label ?? suggested).trim() || copy.isPending}
              onClick={() => copy.mutate()}
            >
              <IconCopy />
              {copy.isPending ? "Copying..." : "Copy"}
            </Button>
          </div>
          <ErrorAlert error={copy.error} title="Couldn't copy it" />
          {copy.isSuccess && picked && (
            <p className="text-sm">
              Copied to {picked.name}.{" "}
              <RouterLink
                className="font-medium text-primary-text underline-offset-4 hover:underline"
                to={pluginPageUrl(manifest, "event", "/jury", picked.slug)}
              >
                Open its jury page
              </RouterLink>
            </p>
          )}
        </div>
      )}
    </Screen.Section>
  );
}
