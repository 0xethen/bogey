import { useRoleLabel } from "#/lib/roles.ts";
import { useId, useMemo, useRef, useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import {
  mappingRule,
  type RosterCatalog,
  type RosterRole,
  type ValueToMap,
} from "@bogey/utils/roster";
import {
  parseRules,
  ruleProblem,
  RULE_ACTIONS,
  RULE_OPERATORS,
  rulesToText,
  VALUELESS,
  type ImportRule,
  type RuleAction,
  type RuleActionKind,
  type RuleCondition,
  type RuleOperator,
} from "@bogey/utils/roster-rules";
import { Button } from "@bogey/ui/components/button";
import { Input } from "@bogey/ui/components/input";
import { OptSelect, type SelectOption } from "@bogey/ui/components/opt-select";
import { Tabs, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import { CodeEditor, type EditorHandle } from "@bogey/ui/components/code-editor";
import { highlight, lineMarks, type LineMark } from "@bogey/ui/lib/editor-lines";
import { LineButton } from "./line-refs.tsx";
import { RULES_HIGHLIGHT } from "./roster-editor.tsx";
import { sayOr, useHelperSay, useT, type T } from "#/lib/translate.tsx";

const newId = () => crypto.randomUUID();

const ROLES: Tuple<RosterRole> = ["participant", "judge", "staff", "organizer"];

const OPERATOR_OPTIONS: Tuple<SelectOption<RuleOperator>> = RULE_OPERATORS.map((operator) => ({
  value: operator,
  label: operator,
}));

const actionOptions = (t: T): Tuple<SelectOption<RuleActionKind>> =>
  RULE_ACTIONS.map((action) => ({
    value: action.kind,
    label: sayOr(t, `ruleAction.${action.kind}`, action.label),
  }));

interface Columns {
  headers: Tuple<string>;
  values: ReadonlyMap<string, Tuple<string>>;
}

function actionOf(kind: RuleActionKind, catalog: RosterCatalog): RuleAction {
  switch (kind) {
    case "division":
      return { kind, target: catalog.divisions[0]?.name ?? "" };
    case "session":
      return { kind, target: catalog.sessions[0]?.name ?? "" };
    case "team":
      return { kind, target: "" };
    case "role":
      return { kind, target: "judge" };
    case "no team":
    case "skip":
      return { kind };
  }
}

export function ImportRules({
  rules,
  onChange,
  columns,
  catalog,
}: {
  rules: Tuple<ImportRule>;
  onChange: (rules: ImportRule[]) => void;
  columns: Columns;
  catalog: RosterCatalog;
}) {
  const t = useT();
  const [mode, setMode] = useState<"cards" | "text">("cards");
  const targets = {
    divisions: catalog.divisions.map((division) => division.name),
    sessions: catalog.sessions.map((session) => session.name),
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-fg">{t("importRules.intro")}</p>
        <Tabs
          value={mode}
          onValueChange={(next: "cards" | "text") => setMode(next)}
          className="gap-0"
        >
          <TabsList variant="switch" aria-label={t("importRules.editAs")}>
            <TabsTrigger value="cards">{t("importRules.cards")}</TabsTrigger>
            <TabsTrigger value="text">{t("homeEditor.text")}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {mode === "cards" ? (
        <RuleCards
          rules={rules}
          onChange={onChange}
          columns={columns}
          catalog={catalog}
          targets={targets}
        />
      ) : (
        <RuleText rules={rules} onChange={onChange} />
      )}
    </div>
  );
}

function RuleCards({
  rules,
  onChange,
  columns,
  catalog,
  targets,
}: {
  rules: Tuple<ImportRule>;
  onChange: (rules: ImportRule[]) => void;
  columns: Columns;
  catalog: RosterCatalog;
  targets: { divisions: Tuple<string>; sessions: Tuple<string> };
}) {
  const t = useT();
  const say = useHelperSay();
  const replace = (rule: ImportRule) =>
    onChange(rules.map((each) => (each.id === rule.id ? rule : each)));
  const firstColumn = columns.headers[0] ?? "";
  const condition = (): RuleCondition => ({ column: firstColumn, operator: "is", value: "" });

  return (
    <div className="flex flex-col gap-2">
      {rules.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-fg">
          {t("importRules.none")}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {rules.map((rule, index) => {
          const problem = ruleProblem(rule, columns.headers, targets, say);
          return (
            <li
              key={rule.id}
              className="flex flex-col gap-2 rounded-2xl border border-border p-3 text-sm aria-invalid:border-destructive"
              aria-invalid={problem ? true : undefined}
            >
              <div className="flex items-start gap-2">
                <span className="mt-1.5 w-5 shrink-0 text-xs text-muted-fg tabular-nums">
                  {index + 1}.
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {rule.when.length === 0 && <p className="py-1.5">{t("importRules.everyone")}</p>}
                  {rule.when.map((each, position) => (
                    <ConditionRow
                      key={position}
                      lead={position === 0 ? t("importRules.when") : t("importRules.and")}
                      condition={each}
                      columns={columns}
                      onChange={(next) =>
                        replace({ ...rule, when: rule.when.with(position, next) })
                      }
                      onRemove={() => replace({ ...rule, when: rule.when.toSpliced(position, 1) })}
                    />
                  ))}
                  <ActionRow
                    action={rule.then}
                    catalog={catalog}
                    onChange={(then) => replace({ ...rule, then })}
                  />
                  {problem && <p className="text-xs text-destructive">{problem}</p>}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("importRules.removeRule")}
                    tooltip={t("importRules.removeRule")}
                    onClick={() => onChange(rules.filter((each) => each.id !== rule.id))}
                  >
                    <IconTrash />
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="ml-7 self-start"
                onClick={() => replace({ ...rule, when: [...rule.when, condition()] })}
              >
                <IconPlus />
                {t("importRules.andWhen")}...
              </Button>
            </li>
          );
        })}
      </ol>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={!firstColumn}
        onClick={() =>
          onChange([
            ...rules,
            { id: newId(), when: [condition()], then: actionOf("division", catalog) },
          ])
        }
      >
        <IconPlus />
        {t("importRules.addRule")}
      </Button>
    </div>
  );
}

function ConditionRow({
  lead,
  condition,
  columns,
  onChange,
  onRemove,
}: {
  lead: string;
  condition: RuleCondition;
  columns: Columns;
  onChange: (condition: RuleCondition) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const listId = useId();
  const suggestions = columns.values.get(condition.column) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-muted-fg">{lead}</span>
      <OptSelect
        size="sm"
        ariaLabel={t("importRules.column")}
        className="max-w-64"
        value={columns.headers.includes(condition.column) ? condition.column : null}
        placeholder={condition.column || `${t("importRules.columnPlaceholder")}...`}
        options={columns.headers.map((header) => ({ value: header, label: header }))}
        onChange={(column) => onChange({ ...condition, column })}
      />
      <OptSelect
        size="sm"
        ariaLabel={t("importRules.compare")}
        value={condition.operator}
        options={OPERATOR_OPTIONS}
        onChange={(operator) => onChange({ ...condition, operator })}
      />
      {!VALUELESS.has(condition.operator) && (
        <>
          <Input
            aria-label={t("importRules.value")}
            className="h-8 w-48"
            list={listId}
            value={condition.value}
            placeholder={
              condition.operator === "matches" ? t("importRules.pattern") : t("importRules.value")
            }
            onChange={(event) => onChange({ ...condition, value: event.target.value })}
          />
          <datalist id={listId}>
            {suggestions.slice(0, 50).map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </>
      )}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label={t("importRules.removeCondition")}
        tooltip={t("importRules.removeCondition")}
        onClick={onRemove}
      >
        <IconTrash />
      </Button>
    </div>
  );
}

function ActionRow({
  action,
  catalog,
  onChange,
}: {
  action: RuleAction;
  catalog: RosterCatalog;
  onChange: (action: RuleAction) => void;
}) {
  const t = useT();
  const roleLabel = useRoleLabel();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-12 shrink-0 text-muted-fg">{t("importRules.then")}</span>
      <OptSelect
        size="sm"
        ariaLabel={t("importRules.whatToDo")}
        value={action.kind}
        options={actionOptions(t)}
        onChange={(kind) => onChange(actionOf(kind, catalog))}
      />
      {action.kind === "division" && (
        <OptSelect
          size="sm"
          ariaLabel={t("importRules.division")}
          value={
            catalog.divisions.some((each) => each.name === action.target) ? action.target : null
          }
          placeholder={
            catalog.divisions.length
              ? `${t("importRules.divisionPlaceholder")}...`
              : t("importRules.noDivisions")
          }
          options={catalog.divisions.map((each) => ({ value: each.name, label: each.name }))}
          onChange={(target) => onChange({ kind: "division", target })}
        />
      )}
      {action.kind === "session" && (
        <OptSelect
          size="sm"
          ariaLabel={t("importRules.session")}
          className="max-w-72"
          value={
            catalog.sessions.some((each) => each.name === action.target) ? action.target : null
          }
          placeholder={
            catalog.sessions.length
              ? `${t("importRules.sessionPlaceholder")}...`
              : t("importRules.noSessions")
          }
          options={catalog.sessions.map((each) => ({ value: each.name, label: each.name }))}
          onChange={(target) => onChange({ kind: "session", target })}
        />
      )}
      {action.kind === "team" && (
        <Input
          aria-label={t("teamForm.name")}
          className="h-8 w-48"
          value={action.target}
          placeholder={t("teamForm.name")}
          onChange={(event) => onChange({ kind: "team", target: event.target.value })}
        />
      )}
      {action.kind === "role" && (
        <OptSelect
          size="sm"
          ariaLabel={t("importRules.role")}
          value={action.target}
          options={ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
          onChange={(target) => onChange({ kind: "role", target })}
        />
      )}
    </div>
  );
}

const EXAMPLE = [
  '[Grade level] is "8th" -> division "Middle school"',
  '[Time Slot 2] contains "Sorting" -> session "Sorting and Searching"',
  '[Email Address] ends with "@ourschool.edu" -> role staff',
  "* -> skip",
].join("\n");

function RuleText({
  rules,
  onChange,
}: {
  rules: Tuple<ImportRule>;
  onChange: (rules: ImportRule[]) => void;
}) {
  const t = useT();
  const say = useHelperSay();
  const [text, setText] = useState(() => rulesToText(rules));
  const editor = useRef<EditorHandle | null>(null);
  const { problems } = parseRules(text, newId, say);
  const marks = problems.map((problem): LineMark => ({
    line: problem.line,
    severity: "error",
    message: problem.message,
  }));
  const key = JSON.stringify(marks);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the marks' contents, not their identity
  const extensions = useMemo(() => [highlight(RULES_HIGHLIGHT), lineMarks(marks)], [key]);
  return (
    <div className="flex flex-col gap-2">
      <CodeEditor
        label={t("importRules.rules")}
        language="plain"
        value={text}
        placeholder={EXAMPLE}
        minHeight="6rem"
        invalid={problems.length > 0}
        extensions={extensions}
        settings={{ autocomplete: false, tabSize: 2, lineWrapping: true }}
        onReady={(handle) => {
          editor.current = handle;
        }}
        onChange={(next) => {
          setText(next);
          const parsed = parseRules(next, newId, say);
          if (!parsed.problems.length) onChange(parsed.rules);
        }}
      />
      {problems.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-destructive">
          {problems.map((problem) => (
            <li key={problem.line}>
              <LineButton line={problem.line} onJump={(line) => editor.current?.jumpToLine(line)} />{" "}
              {problem.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-fg">
          {t("importRules.syntax", { operators: RULE_OPERATORS.join(", ") })}
        </p>
      )}
    </div>
  );
}

export function ValueMapper({
  values,
  rules,
  onChange,
  catalog,
}: {
  values: Tuple<ValueToMap>;
  rules: Tuple<ImportRule>;
  onChange: (rules: ImportRule[]) => void;
  catalog: RosterCatalog;
}) {
  const t = useT();
  const [showMatched, setShowMatched] = useState(false);
  const AUTO = "auto";
  const SKIP = "skip";
  const listed = values.filter(
    (each) => showMatched || !each.matched || mappingRule(rules, each.column, each.value),
  );
  const hidden = values.length - listed.length;
  if (!values.length) return null;

  const set = (each: ValueToMap, choice: string) => {
    const existing = mappingRule(rules, each.column, each.value);
    const rest = rules.filter((rule) => rule !== existing);
    if (choice === AUTO) return onChange(rest);
    const then: RuleAction =
      choice === SKIP
        ? { kind: "skip" }
        : each.kind === "division"
          ? { kind: "division", target: choice }
          : { kind: "session", target: choice };
    const rule: ImportRule = {
      id: existing?.id ?? newId(),
      when: [{ column: each.column, operator: "is", value: each.value }],
      then,
    };
    onChange(existing ? rules.map((each) => (each === existing ? rule : each)) : [...rest, rule]);
  };

  const columns = [...new Set(listed.map((each) => each.column))];
  return (
    <div className="flex flex-col gap-4">
      {columns.map((column) => (
        <div key={column} className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium">{column}</h4>
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
            {listed
              .filter((each) => each.column === column)
              .map((each) => {
                const rule = mappingRule(rules, each.column, each.value);
                const targets = each.kind === "division" ? catalog.divisions : catalog.sessions;
                const value = !rule
                  ? AUTO
                  : rule.then.kind === "skip"
                    ? SKIP
                    : rule.then.kind === "division" || rule.then.kind === "session"
                      ? rule.then.target
                      : AUTO;
                return (
                  <li
                    key={each.value}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      {each.value}{" "}
                      <span className="text-xs text-muted-fg">
                        ({t("managePeople.count", { count: each.count })})
                      </span>
                    </span>
                    <OptSelect
                      size="sm"
                      ariaLabel={t("importRules.whereGoes", { value: each.value })}
                      className="max-w-72"
                      value={value}
                      options={[
                        {
                          value: AUTO,
                          label: each.matched
                            ? t("importRules.matched", { name: each.matched })
                            : t("importRules.noMatch"),
                        },
                        ...targets.map((target) => ({ value: target.name, label: target.name })),
                        ...(each.kind === "session"
                          ? []
                          : [{ value: SKIP, label: t("importRules.dontImport") }]),
                      ]}
                      onChange={(choice) => set(each, choice)}
                    />
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
      {hidden > 0 && (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="self-start"
          onClick={() => setShowMatched(true)}
        >
          {t("importRules.showMatched", { count: hidden })}
        </Button>
      )}
    </div>
  );
}
