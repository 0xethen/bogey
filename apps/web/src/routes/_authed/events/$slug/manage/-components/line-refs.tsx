import { Fragment, type ReactNode } from "react";
import { useT } from "#/lib/translate.tsx";

export function LineButton({
  line,
  onJump,
  children,
}: {
  line: number;
  onJump?: ((line: number) => void) | undefined;
  children?: ReactNode;
}) {
  const t = useT();
  const label = children ?? t("rosterImport.lineN", { line });
  if (!onJump) return <>{label}</>;
  return (
    <button
      type="button"
      className="cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid"
      onClick={() => onJump(line)}
    >
      {label}
    </button>
  );
}

/** "Lines 3, 7:" with each number jumping to its line. */
export function LineRefs({
  lines,
  onJump,
}: {
  lines: Tuple<number>;
  onJump?: ((line: number) => void) | undefined;
}) {
  const t = useT();
  if (lines.length === 0) return null;
  return (
    <span className="text-muted-fg tabular-nums">
      {lines.length === 1 ? t("rosterImport.lineWord") : t("rosterImport.linesWord")}{" "}
      {lines.map((line, index) => (
        <Fragment key={line}>
          {index > 0 && ", "}
          <LineButton line={line} onJump={onJump}>
            {line}
          </LineButton>
        </Fragment>
      ))}
      :{" "}
    </span>
  );
}

const LINE_REFERENCE = /\b(lines?) (\d+)\b/gi;

export function WithLineRefs({
  text,
  onJump,
}: {
  text: string;
  onJump?: ((line: number) => void) | undefined;
}) {
  if (!onJump) return <>{text}</>;
  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(LINE_REFERENCE)) {
    parts.push(text.slice(from, match.index));
    parts.push(
      <LineButton key={match.index} line={Number(match[2])} onJump={onJump}>
        {match[0]}
      </LineButton>,
    );
    from = match.index + match[0].length;
  }
  parts.push(text.slice(from));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
