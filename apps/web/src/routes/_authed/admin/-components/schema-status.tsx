import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconDatabase, IconSparkles } from "@tabler/icons-react";
import { releaseCheckQueryOptions } from "#/lib/release.ts";
import { Alert, AlertDescription, AlertTitle } from "@bogey/ui/components/alert";
import { useT } from "#/lib/translate.tsx";
import { UPGRADING } from "#/components/app/SecurityNotice.tsx";

export function schemaDrift(expected: Tuple<string>, applied: Tuple<string> | null) {
  if (applied === null) return { kind: "untracked" } as const;
  const missing = expected.filter((version) => !applied.includes(version));
  const unknown = applied.filter((version) => !expected.includes(version));
  if (missing.length) return { kind: "behind", count: missing.length } as const;
  if (unknown.length) return { kind: "ahead", count: unknown.length } as const;
  return { kind: "current" } as const;
}

type Drift = ReturnType<typeof schemaDrift>;

// the instance's alerts in one stack, or nothing when there are none
export function InstanceAlerts({ applied }: { applied: Tuple<string> | null }) {
  const drift = schemaDrift(__BOGEY_MIGRATIONS__, applied);
  const { data: release } = useQuery(releaseCheckQueryOptions());
  const newer = release?.newer && release.latest ? release : null;
  if (drift.kind === "current" && !newer) return null;
  return (
    <div className="flex flex-col gap-2">
      {drift.kind !== "current" && <SchemaStatus drift={drift} />}
      {newer && <ReleaseStatus latest={newer.latest!} current={newer.current} url={newer.url} />}
    </div>
  );
}

function SchemaStatus({ drift }: { drift: Exclude<Drift, { kind: "current" }> }) {
  const t = useT();
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

function ReleaseStatus({
  latest,
  current,
  url,
}: {
  latest: string;
  current: string;
  url?: string | null;
}) {
  const t = useT();
  return (
    <Alert>
      <IconSparkles />
      <AlertTitle>{t("schema.releaseOut", { version: latest })}</AlertTitle>
      <AlertDescription>
        {t("schema.runsSee", { version: current })}{" "}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer noopener" className="link">
            {t("schema.whatChanged")}
          </a>
        ) : (
          t("schema.changelog")
        )}{" "}
        {t("schema.and")}{" "}
        <a href={UPGRADING} target="_blank" rel="noreferrer noopener" className="link">
          {t("schema.howToUpgrade")}
        </a>
        .
      </AlertDescription>
    </Alert>
  );
}
