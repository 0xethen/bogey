import { useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatForDisplay, useHotkeyRegistrations } from "@tanstack/react-hotkeys";
import { browserClient } from "@bogey/db/browser";
import { useViewAs } from "@bogey/db/permissions";
import { eventWindowsQueryOptions, isWindowOpen } from "@bogey/db/queries/windows";
import { useNow } from "@bogey/ui/hooks/now";
import { loadedPluginSlots, pluginStatuses } from "@bogey/plugins";
import { useUnsavedState } from "#/components/unsaved-changes/index.tsx";
import { useEventViewer, useSession } from "#/lib/viewer.ts";

const TABS = [
  "Session",
  "Plugins",
  "Windows",
  "Settings",
  "Realtime",
  "Unsaved",
  "Hotkeys",
] as const;
type Tab = (typeof TABS)[number];

const PANEL_COLORS = {
  dark: "[color-scheme:dark] [--color-fg:#e5e7eb] [--color-muted:#374151] [--color-muted-fg:#9ca3af] [--color-border:#374151]",
  light:
    "[color-scheme:light] [--color-fg:#111827] [--color-muted:#e5e7eb] [--color-muted-fg:#4b5563] [--color-border:#d1d5db]",
} as const;

export function BogeyDevtools({ theme }: { theme: keyof typeof PANEL_COLORS }) {
  const [tab, setTab] = useState<Tab>("Session");
  return (
    <div
      className={`${PANEL_COLORS[theme]} flex h-full flex-col gap-3 overflow-auto p-3 text-xs text-fg [&_code]:rounded-md [&_code]:border [&_code]:border-border [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_pre]:font-mono [&_table]:font-mono`}
    >
      <div role="tablist" className="flex flex-wrap gap-1">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className="rounded-md px-2 py-1 hover:bg-muted aria-selected:bg-muted aria-selected:font-semibold"
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "Session" && <SessionTab />}
      {tab === "Plugins" && <PluginsTab />}
      {tab === "Windows" && <WindowsTab />}
      {tab === "Settings" && <SettingsTab />}
      {tab === "Realtime" && <RealtimeTab />}
      {tab === "Unsaved" && <UnsavedTab />}
      {tab === "Hotkeys" && <HotkeysTab />}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="overflow-auto rounded-md bg-muted/50 p-2 whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Table({ head, rows }: { head: Tuple<string>; rows: Tuple<Tuple<ReactNode>> }) {
  if (rows.length === 0) return <p className="text-muted-fg">Nothing to see here!</p>;
  return (
    <table className="w-full text-left">
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} className="border-b border-border py-1 pr-3 font-semibold">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index} className="align-top">
            {row.map((cell, column) => (
              <td key={column} className="border-b border-border/50 py-1 pr-3">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SessionTab() {
  const session = useSession();
  const event = useEventViewer();
  const previewing = useViewAs();
  return (
    <>
      <p>Viewing as: {previewing ?? "yourself"}</p>
      <Json
        value={{
          user: session?.user ?? null,
          org: session?.org ?? null,
          orgRole: session?.orgRole ?? null,
          platformAdmin: session?.platformAdmin ?? false,
          event: event
            ? {
                slug: event.event.slug,
                role: event.access.role,
                orgAdmin: event.access.orgAdmin,
                grants: event.access.grants,
                pluginRoles: event.access.roleKeys,
                plugins: event.plugins.map((plugin) => plugin.key),
              }
            : null,
        }}
      />
    </>
  );
}

function PluginsTab() {
  const slots = new Map(loadedPluginSlots().map((entry) => [entry.key, Object.keys(entry.slots)]));
  return (
    <Table
      head={["Key", "Version", "API", "Status", "Routes", "Slots", "Settings"]}
      rows={pluginStatuses().map(({ manifest, status, detail }) => [
        manifest.key,
        manifest.version,
        manifest.api,
        detail ? `${status}: ${detail}` : status,
        (manifest.routes ?? []).map((route) => route.path || "/").join(", "),
        (slots.get(manifest.key) ?? []).join(", "),
        Object.keys(manifest.settings ?? {}).join(", "),
      ])}
    />
  );
}

function useCachedQueries() {
  const cache = useQueryClient().getQueryCache();
  const [queries, setQueries] = useState(() => cache.getAll());
  useEffect(() => cache.subscribe(() => setQueries(cache.getAll())), [cache]);
  return queries;
}

function WindowsTab() {
  const event = useEventViewer();
  const now = useNow(1000);
  const { data: windows } = useQuery({
    ...eventWindowsQueryOptions(event?.event.id ?? ""),
    enabled: !!event,
  });
  if (!event) return <p className="text-muted-fg">Open an event to see its windows.</p>;
  if (now === null) return null;
  const time = (value: string | null) => (value ? new Date(value).toLocaleString() : "");
  return (
    <Table
      head={["Window", "Open now", "Opens", "Closes", "Forced"]}
      rows={(windows ?? event.windows).map((window) => [
        window.key,
        isWindowOpen(window, new Date(now)) ? "yes" : "no",
        time(window.opens_at),
        time(window.closes_at),
        window.override ?? "",
      ])}
    />
  );
}

function SettingsTab() {
  const queries = useCachedQueries().filter((query) => query.queryKey[0] === "settings");
  return (
    <>
      <p className="text-muted-fg">
        Find settings this page has retrieved. Resolved values come from <code>settings_for</code>.
      </p>
      {queries.length === 0 && <p className="text-muted-fg">None loaded.</p>}
      {queries.map((query) => (
        <details key={query.queryHash}>
          <summary className="cursor-pointer">{JSON.stringify(query.queryKey)}</summary>
          <Json value={query.state.data} />
        </details>
      ))}
    </>
  );
}

function RealtimeTab() {
  const [channels, setChannels] = useState(() => snapshot());
  useEffect(() => {
    const timer = setInterval(() => setChannels(snapshot()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <Table
      head={["Channel", "State"]}
      rows={channels.map((channel) => [channel.topic, channel.state])}
    />
  );
}

function snapshot() {
  return browserClient()
    .getChannels()
    .map((channel) => ({ topic: channel.topic, state: channel.state }));
}

function UnsavedTab() {
  const unsaved = useUnsavedState();
  if (!unsaved)
    return (
      <p className="text-muted-fg">
        Trigger an UnsavedChanges bar (by editing a form) to see unsaved state details.
      </p>
    );

  return (
    <Table
      head={["Entry", "Dirty", "Kind"]}
      rows={unsaved.entries.map((entry) => [
        entry.id,
        entry.dirty ? "yes" : "no",
        entry.draft ? "draft (own submit)" : "saves through the bar",
      ])}
    />
  );
}

function HotkeysTab() {
  const { hotkeys, sequences } = useHotkeyRegistrations();
  return (
    <Table
      head={["Keys", "Name", "Group", "On? (ctx)", "Hit Count"]}
      rows={[
        ...hotkeys.map((hotkey) => [
          formatForDisplay(hotkey.hotkey),
          hotkey.options.meta?.name ?? "",
          hotkey.options.meta?.group ?? "",
          hotkey.options.enabled === false ? "no" : "yes",
          hotkey.triggerCount,
        ]),
        ...sequences.map((sequence) => [
          sequence.sequence.map((step) => formatForDisplay(step)).join(" "),
          sequence.options.meta?.name ?? "",
          sequence.options.meta?.group ?? "",
          sequence.options.enabled === false ? "no" : "yes",
          sequence.triggerCount,
        ]),
      ]}
    />
  );
}
