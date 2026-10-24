import { useState } from "react";
import { formatForDisplay, useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { Button } from "@bogey/ui/components/button";
import { FieldError } from "@bogey/ui/components/field";
import { Kbd } from "@bogey/ui/components/kbd";
import { Row, RowList } from "@bogey/ui/components/row";
import { installedPlugins, type PluginHotkeyDeclaration } from "@bogey/plugins";
import { bindingProblem, type Binding } from "#/lib/shortcut-conflicts.ts";
import {
  SHORTCUT_IDS,
  SHORTCUTS,
  useBindings,
  usePluginShortcutKeys,
  useShortcutKeys,
  type ShortcutId,
} from "#/lib/shortcuts.ts";
import { sayOr, useT } from "#/lib/translate.tsx";

export function ShortcutSettings() {
  const plugins = installedPlugins().filter((manifest) => manifest.hotkeys?.length);
  const all = useBindings();
  return (
    <div className="flex flex-col gap-4">
      <RowList variant="flush" render={<ul />}>
        {SHORTCUT_IDS.map((id) => (
          <CoreShortcutRow key={id} id={id} all={all} />
        ))}
      </RowList>
      {plugins.map((manifest) => (
        <div key={manifest.key} className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-muted-fg">{manifest.name}</h3>
          <RowList variant="flush" render={<ul />}>
            {manifest.hotkeys?.map((hotkey) => (
              <PluginShortcutRow key={hotkey.id} plugin={manifest.key} hotkey={hotkey} all={all} />
            ))}
          </RowList>
        </div>
      ))}
    </div>
  );
}

function CoreShortcutRow({ id, all }: { id: ShortcutId; all: Tuple<Binding> }) {
  const t = useT();
  const shortcut = SHORTCUTS[id];
  return (
    <ShortcutRow
      name={sayOr(t, `shortcut.${id}`, shortcut.name)}
      description={sayOr(t, `shortcut.${id}.help`, shortcut.description)}
      binding={useShortcutKeys(id)}
      ownId={`core.${id}`}
      all={all}
    />
  );
}

function PluginShortcutRow({
  plugin,
  hotkey,
  all,
}: {
  plugin: string;
  hotkey: PluginHotkeyDeclaration;
  all: Tuple<Binding>;
}) {
  const t = useT();
  return (
    <ShortcutRow
      name={hotkey.label}
      description={hotkey.description ?? t("shortcuts.inEvents")}
      binding={usePluginShortcutKeys(plugin, hotkey)}
      ownId={`${plugin}.${hotkey.id}`}
      all={all}
    />
  );
}

function ShortcutRow({
  name,
  description,
  binding,
  ownId,
  all,
}: {
  name: string;
  description: string;
  binding: ReturnType<typeof useShortcutKeys>;
  ownId: string;
  all: Tuple<Binding>;
}) {
  const t = useT();
  const { keys, set, custom, error, fallback } = binding;
  const [refusal, setRefusal] = useState<string | null>(null);
  const recorder = useHotkeyRecorder({
    validate: (hotkey) => bindingProblem(hotkey, ownId, all, t) ?? true,
    onReject: (rejection) => setRefusal(rejection.message),
    onRecord: (hotkey) => {
      setRefusal(null);
      set(hotkey);
    },
    onClear: () => {
      setRefusal(null);
      set(null);
    },
    onCancel: () => setRefusal(null),
  });
  const problem = refusal ?? (error instanceof Error ? error.message : null);

  return (
    <Row
      render={<li />}
      title={name}
      meta={description}
      actions={
        recorder.isRecording ? (
          <>
            <span className="text-sm text-muted-fg" aria-live="polite">
              {recorder.recordedHotkey
                ? formatForDisplay(recorder.recordedHotkey)
                : `${t("shortcuts.recording")}...`}
            </span>
            <Button size="sm" variant="ghost" onClick={recorder.cancelRecording}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <>
            {keys ? (
              <Kbd>{formatForDisplay(keys)}</Kbd>
            ) : (
              <span className="text-sm text-muted-fg">{t("shortcuts.off")}</span>
            )}
            <Button size="sm" variant="outline" onClick={recorder.startRecording}>
              {t("shortcuts.change")}...
            </Button>
            {custom && (
              <Button size="sm" variant="ghost" onClick={() => set(fallback)}>
                {t("shortcuts.reset")}
              </Button>
            )}
          </>
        )
      }
    >
      {problem && <FieldError>{problem}</FieldError>}
    </Row>
  );
}
