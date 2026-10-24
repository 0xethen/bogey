import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { IconChevronDown, IconUsersGroup } from "@tabler/icons-react";
import { z } from "zod";
import { requestFailure } from "@bogey/db/errors";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { eventPeopleQueryOptions, manageSummaryQueryOptions } from "@bogey/db/queries/manage";
import {
  eventTeamsQueryOptions,
  importRosterFn,
  type ImportResult,
} from "@bogey/db/queries/roster";
import { agendaQueryOptions } from "@bogey/db/queries/sessions";
import {
  COLUMN_KINDS,
  GUESS_LEVELS,
  planRoster,
  tableToText,
  valuesToMap,
  type ColumnKind,
  type GuessLevel,
  type RosterCatalog,
  type RosterPlan,
  type RosterResolutions,
} from "@bogey/utils/roster";
import type { ImportRule } from "@bogey/utils/roster-rules";
import { sayOr, useHelperSay, useT, type PlainKey, type T } from "#/lib/translate.tsx";
import { useLocale } from "@bogey/ui/lib/locale";
import { Badge } from "@bogey/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { FileDrop } from "@bogey/ui/components/file-drop";
import { OptSelect, type SelectOption } from "@bogey/ui/components/opt-select";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  FieldSelect,
  rewardEarlyPunishLate,
  useAppForm,
  schemaMetaOf,
} from "@bogey/ui/lib/form";
import { ImportRules, ValueMapper } from "./import-rules.tsx";
import type { EditorHandle } from "@bogey/ui/components/code-editor";
import type { LineMark } from "@bogey/ui/lib/editor-lines";
import { LineButton, WithLineRefs } from "./line-refs.tsx";
import { RosterConflicts } from "./roster-conflicts.tsx";
import { RosterCorrections } from "./roster-corrections.tsx";
import { RosterEditor } from "./roster-editor.tsx";

const ROLES = [
  {
    value: "participant",
    label: "rosterRole.participant",
    description: "rosterRole.participantHelp",
  },
  { value: "judge", label: "rosterRole.judge", description: "rosterRole.judgeHelp" },
  { value: "staff", label: "rosterRole.staff", description: "rosterRole.staffHelp" },
  { value: "organizer", label: "rosterRole.organizer", description: "rosterRole.organizerHelp" },
] as const satisfies Tuple<{ value: string; label: PlainKey; description: PlainKey }>;

const kindOptions = (t: T): Tuple<SelectOption<ColumnKind>> =>
  COLUMN_KINDS.map((each) => ({
    value: each.kind,
    label: sayOr(t, `columnKind.${each.kind}`, each.label),
    description: each.description
      ? sayOr(t, `columnKind.${each.kind}.help`, each.description)
      : undefined,
  }));

const guessOptions = (t: T): Tuple<SelectOption<GuessLevel>> =>
  GUESS_LEVELS.map((level) => ({
    value: level,
    label: t(`rosterImport.guess.${level}`),
  }));

const ACCEPT = ".csv,.tsv,.txt,.xlsx";

const importSchema = (t: T) =>
  z.object({
    text: z
      .string()
      .trim()
      .min(1, t("rosterImport.needText"))
      .meta({
        label: t("rosterImport.paste"),
        placeholder:
          "ethen@example.com\nada@example.com, Ada Lovelace, Team Cobol, , grace@example.com",
      })
      .describe(t("rosterImport.pasteHelp")),
    role: z
      .enum(["participant", "judge", "staff", "organizer"])
      .meta({ label: t("rosterImport.addAs") }),
    notify: z
      .boolean()
      .meta({ label: t("rosterImport.notify") })
      .describe(t("rosterImport.notifyHelp")),
  });

async function fileText(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) return file.text();
  const { readSheet } = await import("read-excel-file/browser");
  const rows = await readSheet(file);
  return tableToText(
    rows.map((row) =>
      row.map((cell) =>
        cell === null ? "" : cell instanceof Date ? cell.toISOString() : String(cell),
      ),
    ),
  );
}

function lineMarksOf(plan: RosterPlan): LineMark[] {
  return [
    ...plan.problems.flatMap((problem): LineMark[] =>
      problem.line ? [{ line: problem.line, severity: "error", message: problem.message }] : [],
    ),
    ...plan.notes.flatMap((note): LineMark[] =>
      note.line !== undefined ? [{ line: note.line, severity: "note", message: note.message }] : [],
    ),
  ];
}

export function RosterImport({ eventId, maxTeamSize }: { eventId: string; maxTeamSize: number }) {
  const t = useT();
  const say = useHelperSay();
  const locale = useLocale();
  const schema = useMemo(() => importSchema(t), [t]);
  const queryClient = useQueryClient();
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));
  const agenda = useQuery(agendaQueryOptions(eventId));
  const teams = useQuery(eventTeamsQueryOptions(eventId));
  const catalog: RosterCatalog = {
    divisions: divisions.map((division) => ({ id: division.id, name: division.name })),
    sessions: (agenda.data?.slots ?? [])
      .filter((slot) => slot.kind === "choose")
      .flatMap((slot) => slot.sessions.map((session) => ({ id: session.id, name: session.name }))),
    teams: (teams.data?.teams ?? []).map((team) => team.name),
  };

  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Readonly<Record<number, ColumnKind>>>({});
  const [guess, setGuess] = useState<GuessLevel>("max");
  const [rules, setRules] = useState<ImportRule[]>([]);
  const [resolutions, setResolutions] = useState<RosterResolutions>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const jump = useCallback((line: number) => editor.current?.jumpToLine(line), []);

  const plan = (text: string): RosterPlan =>
    planRoster(text, { kinds, rules, resolutions, catalog, maxTeamSize, guess, say, locale });

  const form = useAppForm({
    ...appFormOptions.strictSchema({
      defaultValues: { text: "", role: "participant", notify: false },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, formApi, createValidationError }) => {
      const planned = plan(value.text);
      const problem = planned.problems[0];
      if (problem) {
        return createValidationError(
          t("rosterImport.fixFirst", {
            where: problem.line ? t("rosterImport.lineN", { line: problem.line }) : "",
            message: problem.message,
          }),
        );
      }
      if (!planned.people.length) return createValidationError(t("rosterImport.nobody"));
      const undecided = planned.conflicts.filter((conflict) => !(conflict.key in resolutions));
      if (undecided.length) {
        return createValidationError(t("rosterImport.decideFirst", { count: undecided.length }));
      }
      const imported = await importRosterFn({
        data: {
          eventId,
          defaultRole: value.role,
          notify: value.notify,
          rows: planned.people.map((person) => ({
            email: person.email,
            name: person.name,
            team: person.team,
            teamOptions: person.teamOptions,
            division: person.division,
            sessions: person.sessions,
            role: person.role,
            answers: person.answers,
          })),
        },
      }).catch(requestFailure);
      if (!imported.ok) return createValidationError(imported.error.message);
      setResult(imported.data);
      reset();
      formApi.reset({ text: "", role: value.role, notify: false });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: manageSummaryQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: eventTeamsQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: ["roster-overlaps", eventId] }),
      ]);
      return undefined;
    },
  });

  const reset = () => {
    setKinds({});
    setResolutions({});
    setFileName(null);
    setReadError(null);
  };

  const load = async (file: File) => {
    setReading(true);
    setReadError(null);
    try {
      const text = await fileText(file);
      reset();
      setResult(null);
      setFileName(file.name);
      form.setFieldValue("text", text);
    } catch (error) {
      setReadError(
        t("rosterImport.readFailed", {
          name: file.name,
          error: error instanceof Error ? `: ${error.message}` : "",
        }),
      );
    } finally {
      setReading(false);
    }
  };

  return (
    <Screen.Section
      id="add-people-from-a-roster"
      title={t("managePeople.roster")}
      description={t("rosterImport.intro")}
    >
      <form.AppForm>
        <form.Form unsaved="draft" className="flex flex-col gap-4">
          <FileDrop
            files={fileName ? [{ id: fileName, name: fileName, sizeBytes: 0 }] : []}
            accept={ACCEPT}
            busy={reading}
            invalid={!!readError}
            onAdd={(files) => {
              const [file] = files;
              if (file) void load(file);
            }}
            onRemove={() => {
              reset();
              form.setFieldValue("text", "");
            }}
          />
          {readError && <p className="text-sm text-destructive">{readError}</p>}
          <form.Field
            name="text"
            listeners={[
              {
                triggers: ["change"],
                run: () => {
                  setResult(null);
                  setResolutions({});
                },
              },
            ]}
          >
            {(field) => (
              <field.Field>
                <field.Label />
                <RosterEditor
                  id={field.name}
                  label={t("rosterImport.rosterLabel")}
                  value={field.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  invalid={field.meta.isInvalid}
                  marks={field.value.trim() ? lineMarksOf(plan(field.value)) : []}
                  onReady={(handle) => {
                    editor.current = handle;
                  }}
                  placeholder={schemaMetaOf(field).placeholder}
                />
                <field.Description />
                <field.Error />
              </field.Field>
            )}
          </form.Field>

          <form.Subscribe selector={(state) => state.values.text}>
            {(text) =>
              text.trim() ? (
                <Review
                  plan={plan(text)}
                  catalog={catalog}
                  guess={guess}
                  kinds={kinds}
                  onKinds={(next) => {
                    setKinds(next);
                    setResolutions({});
                  }}
                  rules={rules}
                  onRules={setRules}
                  resolutions={resolutions}
                  onResolutions={setResolutions}
                  onJump={jump}
                />
              ) : null
            }
          </form.Subscribe>

          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{t("rosterImport.guessing")}</span>
              <OptSelect
                size="sm"
                ariaLabel={t("rosterImport.guessing")}
                value={guess}
                options={guessOptions(t)}
                onChange={(next) => {
                  setGuess(next);
                  setResolutions({});
                }}
              />
            </div>
            <p className="text-sm text-muted-fg">{t(`rosterImport.guess.${guess}Help`)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <form.Field name="role">
              {(field) => (
                <field.Field orientation="inline">
                  <field.Label />
                  <FieldSelect
                    field={field}
                    options={ROLES.map((each) => ({
                      ...each,
                      label: t(each.label),
                      description: t(each.description),
                    }))}
                  />
                </field.Field>
              )}
            </form.Field>
            <form.Submit pending={t("webhooks.adding")}>{t("rosterImport.add")}</form.Submit>
          </div>
          <form.Field name="notify">{(field) => <field.SwitchField />}</form.Field>
          <form.FormAlert title={t("rosterImport.addFailed")} />
          {result && (
            <p role="status" className="text-sm text-muted-fg">
              {t("rosterImport.added", { count: result.added })}
              {result.updated > 0 &&
                `, ${t("rosterImport.updated", { count: result.updated })}`}.{" "}
              {t("rosterImport.linked", { count: result.linked })}
              {result.asked > 0 && ` ${t("rosterImport.asked", { count: result.asked })}`}
            </p>
          )}
        </form.Form>
      </form.AppForm>
    </Screen.Section>
  );
}

function Part({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-2xl border border-border">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
        <span className="flex-1">{title}</span>
        {badge}
        <IconChevronDown className="size-4 text-muted-fg transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <div className="flex flex-col gap-3 border-t border-border p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Review({
  plan,
  catalog,
  guess,
  kinds,
  onKinds,
  rules,
  onRules,
  resolutions,
  onResolutions,
  onJump,
}: {
  plan: RosterPlan;
  catalog: RosterCatalog;
  guess: GuessLevel;
  kinds: Readonly<Record<number, ColumnKind>>;
  onKinds: (next: Readonly<Record<number, ColumnKind>>) => void;
  rules: ImportRule[];
  onRules: (rules: ImportRule[]) => void;
  resolutions: RosterResolutions;
  onResolutions: (next: RosterResolutions) => void;
  onJump: (line: number) => void;
}) {
  const t = useT();
  const { table } = plan;
  const values = new Map(
    table.columns.map((column) => [
      column.header,
      [...new Set(table.rows.map((row) => row.cells[column.index]?.trim() ?? "").filter(Boolean))],
    ]),
  );
  const toMap = valuesToMap(table, catalog, guess);
  const placed = plan.people.filter((person) => person.wantsTeam).length;
  const asking = plan.people.filter((person) => person.teamOptions?.length).length;
  const kept = table.columns.filter((column) => column.kind === "answer").length;
  const left = table.columns.filter((column) => column.kind === "ignore").length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" role="status">
        <span className="font-medium">
          {t("managePeople.count", { count: plan.people.length })}
        </span>
        {plan.teams.length > 0 && `, ${t("manageTeams.teamCount", { count: plan.teams.length })}`}
        {placed > 0 && `, ${t("rosterImport.toPlace", { count: placed })}`}
        {asking > 0 && `, ${t("rosterImport.toPick", { count: asking })}`}
        {plan.problems.length > 0 && (
          <span className="text-destructive">
            , {t("rosterImport.withErrors", { count: plan.problems.length })}
          </span>
        )}
        .
      </p>

      {plan.problems.length > 0 && (
        <ul className="flex max-h-[min(20rem,50vh)] flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-2xl border border-destructive/40 px-4 py-2.5 text-sm text-destructive">
          {plan.problems.map((problem) => (
            <li key={`${problem.line}:${problem.message}`}>
              {problem.line ? <LineButton line={problem.line} onJump={onJump} /> : null}
              {problem.line ? " " : ""}
              <WithLineRefs text={problem.message} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}

      {plan.conflicts.length > 0 && (
        <RosterConflicts
          conflicts={plan.conflicts}
          resolutions={resolutions}
          onChange={onResolutions}
          onJump={onJump}
        />
      )}

      <Part
        title={t("rosterImport.columns")}
        badge={
          <span className="text-xs font-normal text-muted-fg">
            {kept > 0 && t("rosterImport.kept", { count: kept })}
            {kept > 0 && left > 0 && " · "}
            {left > 0 && t("rosterImport.leftOut", { count: left })}
          </span>
        }
      >
        <p className="text-sm text-muted-fg">
          {table.hasHeader ? t("rosterImport.columnsHelp") : t("rosterImport.noHeader")}
        </p>
        <ul className="flex flex-col divide-y divide-border">
          {table.columns.map((column) => (
            <li
              key={column.index}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 text-sm"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium" title={column.header}>
                  {column.header}
                </span>
                {/* <span className="truncate text-xs text-muted-fg">
                  {column.samples.length ? column.samples.join(" · ") : "Empty"}
                </span> */}
              </span>
              <OptSelect
                size="sm"
                ariaLabel={t("rosterImport.holds", { header: column.header })}
                className="w-48"
                value={column.kind}
                options={kindOptions(t)}
                onChange={(kind) =>
                  onKinds(
                    kind === column.guessed
                      ? Object.fromEntries(
                          Object.entries(kinds).filter(([index]) => Number(index) !== column.index),
                        )
                      : { ...kinds, [column.index]: kind },
                  )
                }
              />
            </li>
          ))}
        </ul>
      </Part>

      {toMap.length > 0 && (
        <Part
          title={t("rosterImport.divSessions")}
          defaultOpen={toMap.some((each) => !each.matched)}
          badge={
            toMap.some((each) => !each.matched) ? (
              <span className="text-xs font-normal text-muted-fg">
                {t("rosterImport.unmatched", {
                  count: toMap.filter((each) => !each.matched).length,
                })}
              </span>
            ) : undefined
          }
        >
          <p className="text-sm text-muted-fg">{t("rosterImport.divSessionsHelp")}</p>
          <ValueMapper values={toMap} rules={rules} onChange={onRules} catalog={catalog} />
        </Part>
      )}

      <Part
        title={t("importRules.rules")}
        badge={
          rules.length ? (
            <span className="text-xs font-normal text-muted-fg">{rules.length}</span>
          ) : undefined
        }
      >
        <ImportRules
          rules={rules}
          onChange={onRules}
          columns={{ headers: table.columns.map((column) => column.header), values }}
          catalog={catalog}
        />
      </Part>

      {plan.teams.length > 0 && (
        <Part
          title={t("facts.teams")}
          badge={<span className="text-xs font-normal text-muted-fg">{plan.teams.length}</span>}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {plan.teams.map((team) => (
              <li
                key={`${team.name}:${team.members[0]}`}
                className="rounded-xl bg-muted/40 p-3 text-sm"
              >
                <p className="flex items-center gap-2 font-medium">
                  <IconUsersGroup className="size-4 text-muted-fg" />
                  <span className="min-w-0 flex-1 truncate">{team.name}</span>
                  {team.existing && <Badge variant="secondary">{t("rosterImport.inEvent")}</Badge>}
                  {team.asking && <Badge variant="outline">{t("rosterImport.theyChoose")}</Badge>}
                </p>
                <p className="mt-1 text-xs text-muted-fg">{team.members.join(", ")}</p>
              </li>
            ))}
          </ul>
        </Part>
      )}

      {plan.notes.length > 0 && (
        <Part
          title={t("rosterImport.corrections")}
          defaultOpen
          badge={<span className="text-xs font-normal text-muted-fg">{plan.notes.length}</span>}
        >
          <RosterCorrections notes={plan.notes} onJump={onJump} />
        </Part>
      )}
    </div>
  );
}
