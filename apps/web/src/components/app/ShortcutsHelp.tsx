import { Link } from "@tanstack/react-router";
import { formatForDisplay, useHotkeyRegistrations } from "@tanstack/react-hotkeys";
import {
  createDialogHandle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bogey/ui/components/dialog";
import { Kbd, KbdGroup } from "@bogey/ui/components/kbd";
import { useShortcut } from "#/lib/shortcuts.ts";
import { useSession } from "#/lib/viewer.ts";
import { sayOr, useT } from "#/lib/translate.tsx";

export const shortcutsHelp = createDialogHandle<undefined>();

interface Row {
  name: string;
  description?: string;
  keys: string[];
}

export function ShortcutsHelp() {
  const t = useT();
  useShortcut("shortcuts", () => shortcutsHelp.open(null));
  const signedIn = useSession() !== undefined;
  return (
    <Dialog handle={shortcutsHelp}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shortcut.shortcuts")}</DialogTitle>
          <DialogDescription>
            {t("shortcutsHelp.intro")}{" "}
            {signedIn && (
              <Link to="/account/shortcuts" className="link" onClick={() => shortcutsHelp.close()}>
                {t("shortcuts.change")}
              </Link>
            )}
          </DialogDescription>
        </DialogHeader>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}

function ShortcutList() {
  const t = useT();
  const { hotkeys, sequences } = useHotkeyRegistrations();
  const groups = new Map<string, Map<string, Row>>();
  const add = (group: string | undefined, row: Row) => {
    const rows = groups.get(group ?? "Other") ?? new Map<string, Row>();
    if (!rows.has(row.name)) rows.set(row.name, row);
    groups.set(group ?? "Other", rows);
  };
  for (const hotkey of hotkeys) {
    const meta = hotkey.options.meta;
    if (!meta?.name || hotkey.options.enabled === false) continue;
    add(meta.group, {
      name: meta.name,
      description: meta.description,
      keys: [formatForDisplay(hotkey.hotkey)],
    });
  }
  for (const sequence of sequences) {
    const meta = sequence.options.meta;
    if (!meta?.name || sequence.options.enabled === false) continue;
    add(meta.group, {
      name: meta.name,
      description: meta.description,
      keys: sequence.sequence.map((step) => formatForDisplay(step)),
    });
  }

  if (groups.size === 0) return <p className="text-sm text-muted-fg">{t("shortcutsHelp.none")}</p>;
  return (
    <div className="flex flex-col gap-5">
      {[...groups].map(([group, rows]) => (
        <section key={group} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-fg uppercase">
            {sayOr(t, `shortcutGroup.${group}`, group)}
          </h3>
          <dl className="flex flex-col gap-2">
            {[...rows.values()].map((row) => (
              <div key={row.name} className="flex items-start justify-between gap-4 text-sm">
                <dt className="flex flex-col">
                  <span>{row.name}</span>
                  {row.description && (
                    <span className="text-xs text-muted-fg">{row.description}</span>
                  )}
                </dt>
                <dd>
                  <KbdGroup>
                    {row.keys.map((key, index) => (
                      <Kbd key={index}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
