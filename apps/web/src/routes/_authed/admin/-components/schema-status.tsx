import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconDatabase, IconSparkles } from "@tabler/icons-react";
import { releaseCheckQueryOptions } from "#/lib/release.ts";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { useT } from "#/lib/translate.tsx";

export function schemaDrift(expected: Tuple<string>, applied: Tuple<string> | null) {
  if (applied === null) return { kind: "untracked" } as const;
  const missing = expected.filter((version) => !applied.includes(version));
  const unknown = applied.filter((version) => !expected.includes(version));
  if (missing.length) return { kind: "behind", count: missing.length } as const;
  if (unknown.length) return { kind: "ahead", count: unknown.length } as const;
  return { kind: "current" } as const;
}

export function SchemaStatus({ applied }: { applied: Tuple<string> | null }) {
  const t = useT();
  const drift = schemaDrift(__BOGEY_MIGRATIONS__, applied);
  if (drift.kind === "current") return null;
  if (drift.kind === "untracked") {
    return (
      <Alert>
        <IconDatabase />
        <AlertTitle>{t("schema.untracked")}</AlertTitle>
        <AlertDescription>
          {t("schema.untrackedHelp")} <code>bogey db mark-applied --all --db-url ...</code>{" "}
          {t("schema.untrackedAfter")}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <IconAlertTriangle />
      <AlertTitle>
        {drift.kind === "behind" ? t("schema.behind", { count: drift.count }) : t("schema.ahead")}
      </AlertTitle>
      <AlertDescription>
        {drift.kind === "behind" ? (
          <>
            {t("schema.behindHelp")} <code>bogey db migrate</code>.
          </>
        ) : (
          <>{t("schema.aheadHelp")}</>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function ReleaseStatus() {
  const t = useT();
  const { data } = useQuery(releaseCheckQueryOptions());
  if (!data?.newer || !data.latest) return null;
  return (
    <Alert>
      <IconSparkles />
      <AlertTitle>{t("schema.releaseOut", { version: data.latest })}</AlertTitle>
      <AlertDescription>
        {t("schema.runs", { version: data.current })} <code>bogey upgrade</code>{" "}
        {t("schema.toUpdate")}{" "}
        {data.url ? (
          <a href={data.url} target="_blank" rel="noreferrer noopener" className="link">
            {t("schema.whatChanged")}
          </a>
        ) : (
          t("schema.changelog")
        )}
        .
      </AlertDescription>
    </Alert>
  );
}
