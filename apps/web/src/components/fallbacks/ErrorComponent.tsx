import { useOffline } from "#/lib/connection.ts";
import { useState, type ReactNode } from "react";
import { useCanGoBack, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import {
  BogeyRequestError,
  VERBOSE_ERRORS,
  describeCause,
  errorCode,
  requestErrorCode,
  // userMessage,
  type BogeyErrorCode,
} from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "@bogey/ui/components/code-block";
import { Screen } from "@bogey/ui/components/screen";
import { useT, type PlainKey } from "#/lib/translate.tsx";
import { FallbackMessage } from "./FallbackMessage.tsx";

type WebErrorCode = "offline" | "outdated";
type Kind = BogeyErrorCode | WebErrorCode;

function Glyph({ className = "size-5", children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

const ICON_ALERT = (
  <Glyph>
    <path d="M12 9v4" />
    <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
    <path d="M12 16h.01" />
  </Glyph>
);

const ICON_OFFLINE = (
  <Glyph>
    <path d="M9.58 5.548c.24 -.11 .492 -.207 .752 -.286c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 .957 -.383 1.824 -1.003 2.454m-2.997 1.033h-11.343c-2.572 -.004 -4.657 -2.011 -4.657 -4.487c0 -2.475 2.085 -4.482 4.657 -4.482c.13 -.582 .37 -1.128 .7 -1.62" />
    <path d="M3 3l18 18" />
  </Glyph>
);

const ICON_LOCK = (
  <Glyph>
    <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
    <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
    <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
  </Glyph>
);

const ICON_RELOAD = (
  <Glyph>
    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
  </Glyph>
);

const ICON_MISSING = (
  <Glyph>
    <path d="M15 20l-6 -3l-6 3v-13l6 -3l6 3l6 -3v7.5" />
    <path d="M9 4v13" />
    <path d="M15 7v5.5" />
    <path d="M19 22v.01" />
    <path d="M19 19a2.003 2.003 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
  </Glyph>
);

const COPY = {
  offline: { title: "error.offline", description: "error.offlineHelp", icon: ICON_OFFLINE },
  outdated: { title: "error.outdated", description: "error.outdatedHelp", icon: ICON_RELOAD },
  unavailable: {
    title: "error.unavailable",
    description: "error.unavailableHelp",
    icon: ICON_OFFLINE,
  },
  forbidden: { title: "error.forbidden", description: "error.forbiddenHelp", icon: ICON_LOCK },
  not_found: { title: "error.notFound", description: "error.notFoundHelp", icon: ICON_MISSING },
  conflict: { title: "error.conflict", description: "error.conflictHelp", icon: ICON_ALERT },
  invalid: { title: "error.invalid", description: "error.invalidHelp", icon: ICON_ALERT },
  unknown: { title: "error.unknown", description: "error.unknownHelp", icon: ICON_ALERT },
} as const satisfies Record<Kind, { title: PlainKey; description: PlainKey; icon: ReactNode }>;

const STALE_CHUNK = /dynamically imported module|importing a module script failed|chunk/i;

function kindOf(error: unknown, offline: boolean): Kind {
  if (offline) return "offline";
  const code = requestErrorCode(error);
  if (code) return code;
  if (error instanceof Error && STALE_CHUNK.test(error.message)) return "outdated";
  return "unknown";
}

export function ErrorComponent({ error, reset }: ErrorComponentProps) {
  const t = useT();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const [retrying, setRetrying] = useState(false);
  const kind = kindOf(error, useOffline());
  const copy = COPY[kind];
  const message = error instanceof BogeyRequestError ? error.message : t(copy.description);
  // const userMsg = userMessage(error, kind);

  const retry = async () => {
    if (kind === "outdated") {
      window.location.reload();
      return;
    }
    setRetrying(true);
    reset();
    await router.invalidate().finally(() => setRetrying(false));
  };

  return (
    <Screen.Fallback icon={copy.icon} title={t(copy.title)} description={message}>
      <FallbackMessage />
      <Screen.Actions>
        <Button onClick={retry} disabled={retrying}>
          {kind === "outdated"
            ? t("error.reload")
            : retrying
              ? `${t("error.trying")}...`
              : t("error.tryAgain")}
        </Button>
        {canGoBack ? (
          <Button variant="outline" onClick={() => router.history.back()}>
            {t("notFound.back")}
          </Button>
        ) : (
          <Button variant="outline" nativeButton={false} render={<a href="/" />}>
            {t("notFound.home")}
          </Button>
        )}
      </Screen.Actions>
      {VERBOSE_ERRORS && <ErrorDetails error={error} />}
    </Screen.Fallback>
  );
}

function ErrorDetails({ error }: { error: unknown }) {
  const t = useT();
  const text = detailsText(error);

  return (
    <details className="w-full text-left" open={import.meta.env.DEV}>
      <summary className="py-1 rounded-pill transition-colors text-center text-sm text-muted-fg hover:bg-muted">
        {t("error.details")}
      </summary>
      <CodeBlock size="sm" className="mt-2">
        <CodeBlockActions>
          <CodeBlockCopyButton value={text} aria-label={t("error.copyDetails")} />
        </CodeBlockActions>
        <CodeBlockContent wrap className="max-h-64">
          {text}
        </CodeBlockContent>
      </CodeBlock>
    </details>
  );
}

function detailsText(error: unknown): string {
  if (!(error instanceof BogeyRequestError)) return describeCause(error);
  const sections = [`${errorCode(error)}: ${error.message}`];
  sections.push(
    error.detail
      ? `Server:\n${error.detail}`
      : "Server: no cause recorded. The server may have verbose errors off, or this failure didn't come from the database.",
  );
  if (error.stack) sections.push(`Client:\n${error.stack}`);
  return sections.join("\n\n");
}
