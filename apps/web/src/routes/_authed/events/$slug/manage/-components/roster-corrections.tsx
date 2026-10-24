import { IconChevronRight, IconInfoCircle } from "@tabler/icons-react";
import type { RosterNote, RosterNoteKind } from "@bogey/utils/roster";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@bogey/ui/components/collapsible";
import { useT } from "#/lib/translate.tsx";
import { LineButton, WithLineRefs } from "./line-refs.tsx";

// this many of one kind of correction are listed under one heading
const GROUP_AT = 3;

type Entry =
  | { kind: "note"; note: RosterNote }
  | { kind: "group"; of: RosterNoteKind; notes: RosterNote[] };

/** Corrections in roster order, with runs of the same kind gathered under a heading. */
export function groupCorrections(notes: Tuple<RosterNote>): Entry[] {
  const byKind = Map.groupBy(notes, (note) => note.kind);
  const entries: Entry[] = [];
  const placed = new Set<RosterNoteKind>();
  for (const note of notes) {
    const same = byKind.get(note.kind) ?? [];
    if (same.length < GROUP_AT) entries.push({ kind: "note", note });
    else if (!placed.has(note.kind)) {
      placed.add(note.kind);
      entries.push({ kind: "group", of: note.kind, notes: same });
    }
  }
  return entries;
}

export function RosterCorrections({
  notes,
  onJump,
}: {
  notes: Tuple<RosterNote>;
  onJump: (line: number) => void;
}) {
  const t = useT();
  return (
    <ul className="-mx-1 flex max-h-[min(30rem,60vh)] flex-col gap-1.5 overflow-y-auto overscroll-contain px-1 text-sm">
      {groupCorrections(notes).map((entry) =>
        entry.kind === "note" ? (
          <li key={`${entry.note.line}:${entry.note.message}`} className="flex gap-2">
            <IconInfoCircle className="mt-0.5 size-4 shrink-0 text-muted-fg" />
            <Correction note={entry.note} onJump={onJump} />
          </li>
        ) : (
          <li key={`group:${entry.of}`}>
            <Collapsible>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left">
                <IconChevronRight className="size-4 shrink-0 text-muted-fg transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
                <span>{t(`rosterImport.group.${entry.of}`)}</span>
                <span className="text-xs text-muted-fg tabular-nums">{entry.notes.length}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="flex flex-col gap-1 pt-1 pl-6 text-muted-fg">
                  {entry.notes.map((note) => (
                    <li key={`${note.line}:${note.message}`}>
                      <Correction note={note} onJump={onJump} />
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </li>
        ),
      )}
    </ul>
  );
}

function Correction({ note, onJump }: { note: RosterNote; onJump: (line: number) => void }) {
  return (
    <span>
      {note.line !== undefined && (
        <span className="text-muted-fg">
          <LineButton line={note.line} onJump={onJump} />{" "}
        </span>
      )}
      <WithLineRefs text={note.message} onJump={onJump} />
    </span>
  );
}
