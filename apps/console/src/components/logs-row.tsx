import { useId, useState } from "react";
import { Button } from "@bogey/ui/components/button";
import { Field, FieldLabel } from "@bogey/ui/components/field";
import { NativeSelect, NativeSelectOption } from "@bogey/ui/components/native-select";
import { IconFileText } from "@tabler/icons-react";
import { isLogService, LOG_SERVICES, type LogService } from "#/server/commands.ts";
import { useRun } from "#/lib/runs.tsx";
import { ConsoleRow } from "#/components/command-row.tsx";

const LINES = [100, 200, 500, 1000] as const;

export function LogsRow() {
  const serviceId = useId();
  const linesId = useId();
  const [open, setOpen] = useState(false);
  const [service, setService] = useState<LogService>("web");
  const [lines, setLines] = useState<number>(200);
  const { run, running, start, show } = useRun("logs");
  const line = `docker compose logs --tail ${lines} ${service}`;
  return (
    <ConsoleRow
      title="Container logs"
      line={line}
      run={run}
      onShowRun={show}
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-sm text-muted-fg">
        The last lines of a service in deploy/compose.yml, if Docker runs on this machine.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor={serviceId}>Service</FieldLabel>
          <NativeSelect
            id={serviceId}
            value={service}
            onChange={(event) => {
              if (isLogService(event.target.value)) setService(event.target.value);
            }}
          >
            {LOG_SERVICES.map((each) => (
              <NativeSelectOption key={each} value={each}>
                {each}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor={linesId}>Lines</FieldLabel>
          <NativeSelect
            id={linesId}
            value={String(lines)}
            onChange={(event) => setLines(Number(event.target.value))}
          >
            {LINES.map((each) => (
              <NativeSelectOption key={each} value={String(each)}>
                {each}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button
          className="ml-auto"
          disabled={running}
          onClick={() => void start({ title: `Logs: ${service}`, line }, { logs: service, lines })}
        >
          <IconFileText data-icon="inline-start" />
          Show logs
        </Button>
      </div>
    </ConsoleRow>
  );
}
