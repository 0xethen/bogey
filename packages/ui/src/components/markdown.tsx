import { useState, type ComponentProps } from "react";
import { useUiText } from "../lib/ui-text.ts";
import { Markdown as MarkdownRenderer, type MarkdownComponents } from "@tanstack/markdown/react";

import { cn } from "@bogey/ui/lib/utils";
import { highlightMarkdownCode, markdownHighlightCss } from "@bogey/ui/lib/highlight";
import { SPOILER_TAG, spoilerExtension } from "@bogey/ui/lib/spoiler";
import { useMarkdownPreferences } from "@bogey/ui/lib/markdown-preferences";
import { featuresExtension, underlineExtension } from "@bogey/ui/lib/markdown-features";
import { markdownFeatures, type MarkdownFeatureSet } from "@bogey/utils/markdown";

export function markdownExtensions(set?: MarkdownFeatureSet) {
  return [spoilerExtension(), underlineExtension(), featuresExtension(markdownFeatures(set))];
}

const REVEALED = "rounded-sm bg-muted px-0.5";
const HIDDEN =
  "cursor-pointer rounded-sm bg-fg px-0.5 text-transparent select-none **:text-transparent";

function Spoiler({ children }: ComponentProps<"span">) {
  const t = useUiText();
  const { spoilers } = useMarkdownPreferences();
  const [shown, setShown] = useState(false);
  const [held, setHeld] = useState(false);

  if (spoilers === "visible") return <span className={REVEALED}>{children}</span>;

  if (spoilers === "click") {
    if (shown) return <span className={REVEALED}>{children}</span>;
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={t("ui.spoilerSelect")}
        title={t("ui.reveal")}
        className={HIDDEN}
        onClick={() => setShown(true)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setShown(true);
        }}
      >
        <span aria-hidden>{children}</span>
      </span>
    );
  }

  const release = () => setHeld(false);
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t("ui.spoilerHold")}
      title={t("ui.holdToReveal")}
      className={held ? cn(REVEALED, "cursor-pointer") : HIDDEN}
      onPointerDown={() => setHeld(true)}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onBlur={release}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setHeld(true);
      }}
      onKeyUp={release}
    >
      <span aria-hidden={!held}>{children}</span>
    </span>
  );
}

export function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;

  const hasProtocol = /^[a-z][a-z0-9+.-]*:/i.test(href);
  const allowed = !hasProtocol || /^(https?:|mailto:)/i.test(href);

  return allowed ? href : undefined;
}

export function isExternalHref(href: string | undefined): boolean {
  return /^https?:\/\//i.test(href ?? "");
}

const components = {
  a(props) {
    const external = isExternalHref(props.href);

    return (
      <a
        {...props}
        href={sanitizeHref(props.href)}
        rel={external ? "nofollow noopener noreferrer" : props.rel}
        target={external ? "_blank" : props.target}
      />
    );
  },
  img(props) {
    return <img {...props} loading="lazy" referrerPolicy="no-referrer" />;
  },
  [SPOILER_TAG]: Spoiler,
} satisfies MarkdownComponents;

export function Markdown({
  children,
  className,
  features = "full",
}: {
  children: string | null | undefined;
  className?: string;
  /** What the field that wrote this accepts; anything else shows as plain text. */
  features?: MarkdownFeatureSet;
}) {
  const { codeLineNumbers } = useMarkdownPreferences();
  if (!children?.trim()) return null;

  return (
    <div className={cn("typeset text-sm", className)}>
      <style>{markdownHighlightCss}</style>
      <MarkdownRenderer
        components={components}
        extensions={markdownExtensions(features)}
        highlighter={highlightMarkdownCode}
        codeLineNumbers={codeLineNumbers}
      >
        {children}
      </MarkdownRenderer>
    </div>
  );
}
