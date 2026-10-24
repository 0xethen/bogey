import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { IconDatabase, IconEdit, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { pluginPageUrl } from "@bogey/plugins/api";
import type { PluginPageContext } from "@bogey/plugins/runtime";
import { Badge } from "@bogey/ui/components/badge";
import { Button, ButtonLabel } from "@bogey/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { RelativeTime } from "@bogey/ui/components/relative-time";
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
  bankQueryOptions,
  deleteBankProblem,
  juryEventsQueryOptions,
  problemLabelsQueryOptions,
  problemsQueryOptions,
  updateBankProblem,
  addFromBank,
  type BankProblem,
} from "../db.ts";
import { manifest } from "../manifest.ts";
import { nextId, PROBLEM_KIND, useGoTo, type Settings } from "../shared.tsx";
import { useChallenges } from "../context.tsx";

const ALL = "all";
const NONE = "none";

/** Problems matching the search and category, grouped by category with the uncategorized last. */
function grouped(bank: Tuple<BankProblem>, search: string, category: string) {
  const needle = search.trim().toLowerCase();
  const shown = bank.filter(
    (each) =>
      (category === ALL || (category === NONE ? !each.category : each.category === category)) &&
      (!needle ||
        each.title.toLowerCase().includes(needle) ||
        each.slug.toLowerCase().includes(needle) ||
        each.category.toLowerCase().includes(needle)),
  );
  const groups = new Map<string, BankProblem[]>();
  for (const each of shown) groups.set(each.category, [...(groups.get(each.category) ?? []), each]);
  return [...groups.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
}

function BankFilters({
  bank,
  search,
  onSearch,
  category,
  onCategory,
}: {
  bank: Tuple<BankProblem>;
  search: string;
  onSearch: (search: string) => void;
  category: string;
  onCategory: (category: string) => void;
}) {
  const categories = [...new Set(bank.map((each) => each.category).filter(Boolean))].sort();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-fg" />
        <Input
          type="search"
          aria-label="Search the bank"
          placeholder="Search titles"
          className="pl-9"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <OptSelect
        ariaLabel="Category"
        value={category}
        options={[
          { value: ALL, label: "Every category" },
          ...categories.map((each) => ({ value: each, label: each })),
          ...(bank.some((each) => !each.category) ? [{ value: NONE, label: "No category" }] : []),
        ]}
        onChange={onCategory}
      />
    </div>
  );
}

function Facts({ problem }: { problem: BankProblem }) {
  return (
    <span className="text-muted-fg">
      {PROBLEM_KIND[problem.kind].label} · {problem.tests} {problem.tests === 1 ? "test" : "tests"}
      {problem.solutions > 0 &&
        ` · ${problem.solutions} jury ${problem.solutions === 1 ? "solution" : "solutions"}`}
    </span>
  );
}

// ── Organization → Problem bank ───────────────────────────────────────

export function BankPage({ orgId, settings }: PluginPageContext<"org", Settings>) {
  const bank = useQuery(bankQueryOptions(orgId));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [editing, setEditing] = useState<BankProblem | null>(null);
  const [using, setUsing] = useState<BankProblem | null>(null);
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: deleteBankProblem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bankQueryOptions(orgId).queryKey }),
  });
  const rows = bank.data ?? [];

  return (
    <Screen
      title="Problem bank"
      description="A shared bank of contest problems. Use them in a contest with the Jury/Reuse menu."
    >
      <ErrorAlert
        error={bank.error instanceof Error ? bank.error : remove.error}
        title="Couldn't load the bank"
      />
      {bank.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <Screen.Fallback
          icon={<IconDatabase />}
          title="The bank is empty"
          description="Open a problem on a contest's Jury page and save it to the bank from its Reuse tab."
        />
      ) : (
        <>
          <BankFilters
            bank={rows}
            search={search}
            onSearch={setSearch}
            category={category}
            onCategory={setCategory}
          />
          {grouped(rows, search, category).map(([group, problems]) => (
            <Screen.Section key={group || NONE} title={group || "No category"}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Problem</TableHead>
                      <TableHead>Saved</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {problems.map((problem) => (
                      <TableRow key={problem.id}>
                        <TableCell>
                          <span className="flex flex-col gap-0.5 text-sm">
                            <span className="font-medium">{problem.title}</span>
                            <Facts problem={problem} />
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-fg">
                          <RelativeTime value={problem.updated_at} />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button size="sm" variant="outline" onClick={() => setUsing(problem)}>
                            <IconPlus />
                            Use in a contest...
                          </Button>
                          <Button
                            size="sm-icon-on-phones"
                            variant="ghost"
                            aria-label={`Edit ${problem.title}`}
                            tooltip="Edit"
                            onClick={() => setEditing(problem)}
                          >
                            <IconEdit />
                            <ButtonLabel>Edit</ButtonLabel>
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost-destructive"
                            aria-label={`Remove ${problem.title} from the bank...`}
                            tooltip="Remove..."
                            disabled={remove.isPending}
                            confirm={{
                              title: `Remove ${problem.title} from the bank?`,
                              description:
                                "Contests that already use a copy keep it. Only the bank's copy goes.",
                              label: "Remove",
                            }}
                            onClick={() => remove.mutate(problem.id)}
                          >
                            <IconTrash />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Screen.Section>
          ))}
        </>
      )}
      <EditBankProblem
        orgId={orgId}
        problem={editing}
        categories={rows.map((each) => each.category)}
        onClose={() => setEditing(null)}
      />
      <UseInContest
        orgId={orgId}
        settings={settings}
        problem={using}
        onClose={() => setUsing(null)}
      />
    </Screen>
  );
}

function EditBankProblem({
  orgId,
  problem,
  categories,
  onClose,
}: {
  orgId: string;
  problem: BankProblem | null;
  categories: Tuple<string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={problem !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {problem && (
          <EditBankForm
            key={problem.id}
            orgId={orgId}
            problem={problem}
            categories={categories}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditBankForm({
  orgId,
  problem,
  categories,
  onDone,
}: {
  orgId: string;
  problem: BankProblem;
  categories: Tuple<string>;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(problem.title);
  const [category, setCategory] = useState(problem.category);
  const save = useMutation({
    mutationFn: () =>
      updateBankProblem(problem.id, { title: title.trim(), category: category.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: bankQueryOptions(orgId).queryKey });
      onDone();
    },
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit {problem.title}</DialogTitle>
        <DialogDescription>
          Its statement, limits and tests change in a contest: use it in one, edit it there, and
          save it to the bank again from its Reuse tab.
        </DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="bank-title">Title</FieldLabel>
        <Input
          id="bank-title"
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="bank-edit-category">Category</FieldLabel>
        <Input
          id="bank-edit-category"
          list="bank-edit-categories"
          maxLength={60}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
        <datalist id="bank-edit-categories">
          {[...new Set(categories.filter(Boolean))].sort().map((each) => (
            <option key={each} value={each} />
          ))}
        </datalist>
      </Field>
      <ErrorAlert error={save.error} title="Couldn't save it" />
      <DialogFooter>
        <Button type="submit" disabled={!title.trim() || save.isPending}>
          {save.isPending ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** From the bank: pick one of your contests and the problem's ID there. */
function UseInContest({
  orgId,
  settings,
  problem,
  onClose,
}: {
  orgId: string;
  settings: Settings;
  problem: BankProblem | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={problem !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {problem && (
          <UseInContestForm key={problem.id} orgId={orgId} settings={settings} problem={problem} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function UseInContestForm({
  orgId,
  settings,
  problem,
}: {
  orgId: string;
  settings: Settings;
  problem: BankProblem;
}) {
  const events = useQuery(juryEventsQueryOptions(orgId));
  const [target, setTarget] = useState<string | null>(null);
  const picked = (events.data ?? []).find((each) => each.id === target) ?? events.data?.[0];
  const labels = useQuery({ ...problemLabelsQueryOptions(picked?.id ?? ""), enabled: !!picked });
  const [label, setLabel] = useState<string | null>(null);
  const suggested = labels.data ? nextId(settings.idKind, labels.data) : "";
  const use = useMutation({
    mutationFn: () => {
      if (!picked) throw new Error("Pick a contest.");
      return addFromBank(problem.id, picked.id, (label ?? suggested).trim());
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Use {problem.title} in a contest</DialogTitle>
        <DialogDescription>
          The contest gets its own copy, with the tests and jury solutions, which are judged again
          there.
        </DialogDescription>
      </DialogHeader>
      {events.isSuccess && events.data.length === 0 ? (
        <p className="text-sm text-muted-fg">
          You're not on the jury of any of the organization's contests.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor="use-target">Contest</FieldLabel>
            <OptSelect
              id="use-target"
              ariaLabel="Contest"
              value={picked?.id ?? null}
              placeholder="Pick a contest"
              options={(events.data ?? []).map((each) => ({ value: each.id, label: each.name }))}
              onChange={(next) => {
                setTarget(next);
                setLabel(null);
                use.reset();
              }}
            />
          </Field>
          <Field className="w-24">
            <FieldLabel htmlFor="use-label">ID there</FieldLabel>
            <Input
              id="use-label"
              maxLength={16}
              value={label ?? suggested}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </div>
      )}
      <ErrorAlert error={use.error} title="Couldn't add it" />
      {use.isSuccess && picked ? (
        <p className="text-sm">
          Added to {picked.name}.{" "}
          <RouterLink
            className="font-medium text-primary-text underline-offset-4 hover:underline"
            to={pluginPageUrl(manifest, "event", "/jury", picked.slug)}
          >
            Open its jury page
          </RouterLink>
        </p>
      ) : (
        <DialogFooter>
          <Button
            disabled={!picked || !(label ?? suggested).trim() || use.isPending}
            onClick={() => use.mutate()}
          >
            {use.isPending ? "Adding..." : "Add to the contest"}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

// ── Add a problem → From the bank ─────────────────────────────────────

/** The new-problem page's other start: pick a problem in the bank and add a copy to this contest. */
export function FromBank({ orgId }: { orgId: string }) {
  const { eventId, settings } = useChallenges();
  const queryClient = useQueryClient();
  const goTo = useGoTo();
  const bank = useQuery(bankQueryOptions(orgId));
  const problems = useQuery(problemsQueryOptions(eventId));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const next = nextId(settings.idKind, problems.data ?? []);
  const add = useMutation({
    mutationFn: (bankId: string) => addFromBank(bankId, eventId, next),
    onSuccess: async (id) => {
      const fresh = await queryClient.fetchQuery(problemsQueryOptions(eventId));
      const added = fresh.find((each) => each.id === id);
      if (added) await goTo("/jury", { splat: added.slug, replace: true });
    },
  });
  const rows = bank.data ?? [];
  const used = new Set((problems.data ?? []).map((each) => each.bank_problem_id));

  return (
    <Screen.Section
      title="From the problem bank"
      description={`A copy comes into this contest as ${next || "the next ID"}, with its tests and jury solutions.`}
    >
      <ErrorAlert
        error={bank.error instanceof Error ? bank.error : add.error}
        title="Couldn't add it"
      />
      {bank.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-fg">
          The bank is empty. Save a problem to it from its Reuse tab.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <BankFilters
            bank={rows}
            search={search}
            onSearch={setSearch}
            category={category}
            onCategory={setCategory}
          />
          <div className="flex flex-col gap-4">
            {grouped(rows, search, category).map(([group, list]) => (
              <section key={group || NONE} className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-fg">{group || "No category"}</h3>
                <ul className="flex flex-col divide-y divide-border border-y border-border">
                  {list.map((problem) => (
                    <li key={problem.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">{problem.title}</span>
                        <Facts problem={problem} />
                      </span>
                      {used.has(problem.id) && <Badge variant="outline">In this contest</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={add.isPending || !next}
                        onClick={() => add.mutate(problem.id)}
                      >
                        <IconPlus />
                        Add
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </Screen.Section>
  );
}
