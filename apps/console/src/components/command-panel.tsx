import { useState } from "react";
import { cn } from "@bogey/ui/lib/utils";
import { Input } from "@bogey/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@bogey/ui/components/tabs";
import { IconSearch } from "@tabler/icons-react";
import { COMMANDS, GROUPS, type CommandGroup, type ConsoleCommand } from "#/server/commands.ts";
import { CommandRow } from "#/components/command-row.tsx";
import { LogsRow } from "#/components/logs-row.tsx";

const LOGS = "container logs docker compose logs";

function matches(command: ConsoleCommand, words: Tuple<string>): boolean {
  const text = [command.label, `bogey ${command.cli.join(" ")}`, command.description]
    .join(" ")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** One column until the panel is stretched; then two lanes, filled left, right, left... */
function lane(index: number): string {
  return index % 2 === 0 ? "@3xl:col-start-1" : "@3xl:col-start-2";
}

function isGroup(value: unknown): value is CommandGroup {
  return GROUPS.some((group) => group.id === value);
}

export function CommandPanel({ plugins }: { plugins: Tuple<string> }) {
  const [tab, setTab] = useState<CommandGroup>("status");
  const [search, setSearch] = useState("");
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const logsMatch = words.every((word) => LOGS.includes(word));
  const anyMatch = COMMANDS.some((command) => matches(command, words)) || logsMatch;

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <Tabs
          value={searching ? null : tab}
          onValueChange={(value) => {
            if (isGroup(value)) {
              setTab(value);
              setSearch("");
            }
          }}
          className="max-w-full"
        >
          <TabsList className="scroll-fade-x max-w-full justify-start overflow-x-auto">
            {GROUPS.map((group) => (
              <TabsTrigger key={group.id} value={group.id} className="flex-none">
                {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative w-full @4xl:w-64">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-fg" />
          <Input
            type="search"
            value={search}
            placeholder="Find a command"
            aria-label="Find a command"
            className="pl-9"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="scroll-fade min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10">
        <div className="flex flex-col gap-6">
          {searching && !anyMatch && (
            <p className="py-12 text-center text-sm text-muted-fg">
              No command matches “{search.trim()}”.
            </p>
          )}

          {GROUPS.map((group) => {
            const commands = COMMANDS.filter((command) => command.group === group.id);
            const shown = searching
              ? commands.filter((command) => matches(command, words))
              : commands;
            const withLogs = group.id === "host" && (!searching || logsMatch);
            const visible = searching ? shown.length > 0 || withLogs : group.id === tab;
            return (
              <section key={group.id} hidden={!visible} className="flex flex-col gap-3">
                <p className="text-sm text-muted-fg">
                  {searching && <span className="font-medium text-fg">{group.label} · </span>}
                  {group.description}
                </p>
                <div className="grid-lanes items-start gap-3 @3xl:grid-cols-2">
                  {commands.map((command) => (
                    <div
                      key={command.id}
                      hidden={!shown.includes(command)}
                      className={cn("min-w-0", lane(shown.indexOf(command)))}
                    >
                      <CommandRow command={command} plugins={plugins} />
                    </div>
                  ))}
                  {group.id === "host" && (
                    <div hidden={!withLogs} className={cn("min-w-0", lane(shown.length))}>
                      <LogsRow />
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
