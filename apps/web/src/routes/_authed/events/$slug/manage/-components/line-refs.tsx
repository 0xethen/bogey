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
