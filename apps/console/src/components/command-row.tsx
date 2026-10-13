import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { Input } from "@bogey/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@bogey/ui/components/native-select";
import { Switch } from "@bogey/ui/components/switch";
import { IconEye, IconPlayerPlayFilled, IconReload } from "@tabler/icons-react";
import {
  commandArgs,
  paramProblem,
  type CommandParam,
  type ConsoleCommand,
  type ParamValues,
} from "#/server/commands.ts";
import { useRun, type Run } from "#/lib/runs.tsx";
import { RunBadge } from "#/components/output.tsx";

function ParamField({
  param,
  value,
  plugins,
  onChange,
}: {
  param: CommandParam;
  value: string | boolean | undefined;
  plugins: Tuple<string>;
  onChange: (value: string | boolean) => void;
}) {
  const id = useId();
  if (param.kind === "switch") {
    return (
      <Field orientation="horizontal" className="sm:col-span-2">
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={id}>{param.label}</FieldLabel>
          {param.description && <FieldDescription>{param.description}</FieldDescription>}
        </div>
      </Field>
    );
  }
  const text = typeof value === "string" ? value : "";
  const problem = text ? paramProblem(param, text, plugins) : null;
  const label = (
    <FieldLabel htmlFor={id}>
      {param.label}
      {param.optional && <span className="font-normal text-muted-fg">optional</span>}
    </FieldLabel>
  );
  if (param.kind === "plugin" || param.kind === "choice") {
    const options =
      param.kind === "plugin" ? plugins.map((key) => ({ value: key, label: key })) : param.options;
    return (
      <Field>
        {label}
        <NativeSelect
          id={id}
          className="w-full"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <NativeSelectOption value="">{param.optional ? "All" : "Choose…"}</NativeSelectOption>
          {options.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {option.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {param.description && <FieldDescription>{param.description}</FieldDescription>}
      </Field>
    );
  }
  return (
    <Field data-invalid={problem !== null}>
      {label}
      <Input
        id={id}
        value={text}
        placeholder={param.placeholder}
        aria-invalid={problem !== null}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        onChange={(event) => onChange(event.target.value)}
      />
      {(problem ?? param.description) && (
        <FieldDescription className={problem ? "text-destructive" : undefined}>
          {problem ?? param.description}
        </FieldDescription>
      )}
    </Field>
  );
}

function commandLine(command: ConsoleCommand, values: ParamValues, plugins: Tuple<string>): string {
  const built = commandArgs(command, values, plugins);
  const args = "args" in built ? built.args : command.cli;
  return `bogey ${args.map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`;
}

export function ConsoleRow({
  title,
  line,
  run,
  onShowRun,
  quick,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  line: string;
  run: Run | undefined;
  onShowRun: () => void;
  quick?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card px-4 transition-colors hover:border-ring/40 has-data-panel-open:border-ring/40">
      <DisclosureRow
        title={title}
        meta={<code className="font-mono text-xs">{line}</code>}
        actions={
          (run || quick) && (
            <>
              <RunBadge run={run} onShow={onShowRun} />
              {quick}
            </>
          )
        }
        open={open}
        onOpenChange={onOpenChange}
      >
        <div className="flex flex-col gap-4">{children}</div>
      </DisclosureRow>
    </div>
  );
}

export function CommandRow({
  command,
  plugins,
}: {
  command: ConsoleCommand;
  plugins: Tuple<string>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<ParamValues>({});
  const [previewed, setPreviewed] = useState<string | null>(null);
  const { run, running, start: startRun, show } = useRun(command.id);
  const params = command.params ?? [];
  const ready = "args" in commandArgs(command, values, plugins);
  const valuesKey = JSON.stringify(values);
  const line = commandLine(command, values, plugins);

  useEffect(() => {
    if (command.autorun) {
      void startRun(
        { title: command.label, line },
        { command: command.id },
        { reveal: false, once: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (step: "preview" | "apply") => {
    const status = await startRun(
      { title: command.label, line },
      { command: command.id, values, step },
    );
    setPreviewed(step === "preview" && status !== "stopped" ? valuesKey : null);
  };

  const runButton = (size: "sm" | "default") => (
    <Button
      size={size}
      variant={run ? "outline" : "default"}
      disabled={!ready || running}
      onClick={() => void start("apply")}
    >
      {!run ? (
        <>
          <IconPlayerPlayFilled data-icon="inline-start" />
          Run
        </>
      ) : (
        <>
          <IconReload data-icon="inline-start" />
          Re-run
        </>
      )}
    </Button>
  );

  let actions;
  if (command.twoStep) {
    const canApply = previewed === valuesKey && !running;
    actions = (
      <>
        <Button
          variant={canApply ? "outline" : "default"}
          disabled={!ready || running}
          onClick={() => void start("preview")}
        >
          <IconEye data-icon="inline-start" />
          Preview
        </Button>
        <Button
          variant="destructive"
          disabled={!ready || !canApply}
          confirm={{
            title: `${command.label}?`,
            description: (
              <>
                Runs <code className="font-mono">{line}</code> with what the preview showed.
              </>
            ),
            label: command.twoStep.applyLabel,
          }}
          onClick={() => void start("apply")}
        >
          {command.twoStep.applyLabel}
        </Button>
      </>
    );
  } else if (command.kind === "change") {
    actions = (
      <Button
        disabled={!ready || running}
        confirm={{
          title: `${command.label}?`,
          description: (
            <>
              Runs <code className="font-mono">{line}</code> on this machine.
            </>
          ),
          label: "Run",
          variant: "default",
        }}
        onClick={() => void start("apply")}
      >
        <IconPlayerPlayFilled data-icon="inline-start" />
        Run
      </Button>
    );
  } else {
    actions = runButton("default");
  }

  const quick =
    command.kind === "read" && params.every((param) => param.kind === "switch" || param.optional)
      ? runButton("sm")
      : undefined;

  return (
    <ConsoleRow
      title={command.label}
      line={line}
      run={run}
      onShowRun={show}
      quick={open ? undefined : quick}
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-sm text-muted-fg">{command.description}</p>
      {params.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {params.map((param) => (
            <ParamField
              key={param.name}
              param={param}
              value={values[param.name]}
              plugins={plugins}
              onChange={(value) => setValues((current) => ({ ...current, [param.name]: value }))}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">{actions}</div>
    </ConsoleRow>
  );
}
