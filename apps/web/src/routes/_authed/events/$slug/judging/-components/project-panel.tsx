import { useSuspenseQuery } from "@tanstack/react-query";
import { judgeProjectQueryOptions, type JudgeQueueItem } from "@bogey/db/queries/judging";
import { submissionFormsQueryOptions, type SubmissionForm } from "@bogey/db/queries/submissions";
import { Badge } from "@bogey/ui/components/badge";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { Facts, type Fact } from "@bogey/ui/components/facts";
import { formatDateTime, formatTime } from "@bogey/utils/time";
import { IconExternalLink } from "@tabler/icons-react";
import { SubmissionAnswers } from "#/components/event/submission/submission-answers.tsx";
import { useViewerTimeFormat } from "#/lib/time.ts";
import { useT } from "#/lib/translate.tsx";

const LINK_KINDS = new Set(["url", "video", "drive"]);

/** Everything a judge knows about a project: its facts, links and every form its team submitted. */
export function ProjectPanel({
  eventId,
  timeZone,
  submissionId,
  item,
  blind,
}: {
  eventId: string;
  timeZone: string;
  submissionId: string;
  item: JudgeQueueItem | undefined;
  blind: boolean;
}) {
  const t = useT();
  const time = useViewerTimeFormat();
  const { data: project } = useSuspenseQuery(judgeProjectQueryOptions(submissionId));
  const { data: forms } = useSuspenseQuery(submissionFormsQueryOptions(eventId));
  if (!project) return null;
  const formOf = new Map(forms.map((form) => [form.id, form]));
  const judged = project.submissions.find((entry) => entry.id === submissionId);

  const facts: Fact[] = [
    { label: t("judging.factTeam"), value: project.teamName },
    ...(project.divisionName
      ? [{ label: t("judging.factDivision"), value: project.divisionName }]
      : []),
    ...(judged?.table_label ? [{ label: t("judging.factTable"), value: judged.table_label }] : []),
    ...(item?.demo
      ? [
          {
            label: t("judging.factDemo"),
            value: [
              t("judging.demoSlot", { panel: item.demo.panelName, slot: item.demo.position + 1 }),
              item.demo.location,
              item.demo.startsAt
                ? formatTime(item.demo.startsAt, { ...time, timeZone })
                : undefined,
            ]
              .filter(Boolean)
              .join(" · "),
          },
        ]
      : []),
    ...(item ? [{ label: t("judging.factRound"), value: item.roundName }] : []),
    ...(judged?.submitted_at
      ? [
          {
            label: t("judging.factSubmitted"),
            value: formatDateTime(judged.submitted_at, { ...time, timeZone }),
          },
        ]
      : []),
  ];

  const links = project.submissions.flatMap((entry) => {
    const form = formOf.get(entry.form_id);
    const answers =
      entry.answers && typeof entry.answers === "object" && !Array.isArray(entry.answers)
        ? entry.answers
        : {};
    return (form?.items ?? []).flatMap((field) => {
      const value = answers[field.key];
      if (!LINK_KINDS.has(field.kind) || typeof value !== "string" || !value) return [];
      if (blind && field.namesPeople) return [];
      return [{ key: `${entry.id}:${field.key}`, label: field.label, href: value }];
    });
  });

  return (
    <div className="flex flex-col gap-6">
      <Facts facts={facts} />
      {links.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("judging.links")}</h2>
          <ul className="flex flex-wrap gap-2">
            {links.map((link) => (
              <li key={link.key}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-pill border border-border px-3 py-1 text-sm hover:bg-muted"
                >
                  {link.label}
                  <IconExternalLink className="size-3.5 text-muted-fg" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{t("judging.entries")}</h2>
        <RowList>
          {project.submissions.map((entry) => {
            const form: SubmissionForm | undefined = formOf.get(entry.form_id);
            return (
              <DisclosureRow
                key={entry.id}
                defaultOpen
                title={
                  <>
                    {form?.title ?? t("judging.formRemoved")}
                    {entry.id === submissionId && project.submissions.length > 1 && (
                      <Badge variant="secondary" className="ml-2">
                        {t("judging.judgedEntry")}
                      </Badge>
                    )}
                  </>
                }
                meta={entry.title || undefined}
              >
                {form ? (
                  <SubmissionAnswers
                    form={form}
                    submission={entry}
                    files={entry.files}
                    blind={blind}
                  />
                ) : (
                  <p className="text-sm text-muted-fg">{t("judging.formRemoved")}</p>
                )}
              </DisclosureRow>
            );
          })}
        </RowList>
      </section>
    </div>
  );
}
