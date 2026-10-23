import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconShieldExclamation, IconX } from "@tabler/icons-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { Button } from "@bogey/ui/components/button";
import { releaseCheckQueryOptions } from "#/lib/release.ts";
import { useT } from "#/lib/translate.tsx";

export const UPGRADING = "https://github.com/0xethen/bogey/wiki/self-hosting-upgrading";

const DISMISSED_KEY = "bogey.securityNotice.dismissed";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function storedDismissed(): string {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseDismissed(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: Tuple<string>) {
  try {
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch {}
  for (const listener of listeners) listener();
}

/**
 * Instance admins see this on every page while the running Bogey has a published advisory.
 * Dismissing it hides the advisories it showed, in this browser; a new one brings it back.
 */
export function SecurityNotice({ platformAdmin }: { platformAdmin: boolean }) {
  const t = useT();
  const { data } = useQuery({ ...releaseCheckQueryOptions(), enabled: platformAdmin });
  // Null on the server, so the server and the first render agree.
  const stored = useSyncExternalStore(subscribe, storedDismissed, () => null);

  if (!platformAdmin || !data || stored === null) return null;
  const dismissed = parseDismissed(stored);
  const advisories = data.advisories.filter((advisory) => !dismissed.includes(advisory.id));
  if (!advisories.length) return null;

  const dismiss = () => {
    // Only the advisories still out, so the list doesn't grow forever.
    saveDismissed(data.advisories.map((advisory) => advisory.id));
  };

  return (
    <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
      <IconShieldExclamation />
      <AlertTitle>
        {t("securityNotice.title", { version: data.current, count: advisories.length })}
      </AlertTitle>
      <AlertDescription>
        <ul className="list-disc ps-5">
          {advisories.map((advisory) => (
            <li key={advisory.id}>
              <a href={advisory.url} target="_blank" rel="noreferrer noopener" className="link">
                {advisory.summary}
              </a>
              {advisory.severity && ` (${t(`securityNotice.severity.${advisory.severity}`)})`}
              {advisory.patched &&
                `. ${t("securityNotice.fixedIn", { version: advisory.patched })}`}
            </li>
          ))}
        </ul>
        <p>
          {data.latest
            ? t("securityNotice.upgradeTo", { version: data.latest })
            : t("securityNotice.upgrade")}{" "}
          <a href={UPGRADING} target="_blank" rel="noreferrer noopener" className="link">
            {t("securityNotice.howTo")}
          </a>
        </p>
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("securityNotice.dismiss")}
          tooltip={t("securityNotice.dismiss")}
          onClick={dismiss}
        >
          <IconX />
        </Button>
      </AlertAction>
    </Alert>
  );
}
