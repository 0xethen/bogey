import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export const LINK = "⁣";

/** A translated message with its `LINK` params swapped for `links`, in order. */
export function Linked({ text, links }: { text: string; links: Tuple<ReactNode> }) {
  const parts = text.split(LINK);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && links[index]}
    </Fragment>
  ));
}

/**
 * A link to a setting where it's changed: `hash` is its `#namespace.key` (or a form's
 * `#group.field`, or a section's id), which the page scrolls to and highlights.
 */
export function SettingLink({
  to,
  hash,
  children,
}: {
  to: string;
  hash?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} hash={hash} className="link">
      {children}
    </Link>
  );
}
