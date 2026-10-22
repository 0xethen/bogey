import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  rubricOf,
  setSubmissionRubricFn,
  type Criterion,
  type ProjectRubric,
  type Rubric,
} from "@bogey/db/queries/judging";
import { unwrap } from "@bogey/db/errors";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { Markdown } from "@bogey/ui/components/markdown";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { useT } from "#/lib/translate.tsx";

const NONE = "none";

/** Picks the rubric a project is judged on; one pick per project, shared by its judges and team. */
export function RubricPicker({
  submissionId,
  rubrics,
  value,
  editable,
  criteria,
  description,
  onPicked,
}: {
  submissionId: string;
  rubrics: Tuple<Rubric>;
  value: ProjectRubric;
  editable: boolean;
  /** Lists the picked rubric's own criteria under it when given. */
  criteria?: Tuple<Criterion>;
  description?: string;
  onPicked?: () => Promise<unknown>;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const pick = useMutation({
    mutationFn: async (rubricId: string | null) =>
      unwrap(await setSubmissionRubricFn({ data: { submissionId, rubricId } })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["submission-rubric", submissionId] }),
        onPicked?.(),
      ]);
    },
  });
  // rubrics meant for other divisions aren't offered, but a pick made before stays visible
  const offered = rubrics.filter(
    (rubric) => value.allowed.includes(rubric.id) || rubric.id === value.picked,
  );
  if (offered.length === 0) return null;
  const current = rubrics.find((rubric) => rubric.id === rubricOf(value)) ?? null;
  const fallback = rubrics.find((rubric) => rubric.id === value.fallback) ?? null;
  const choices = offered.filter((rubric) => rubric.id !== fallback?.id);
  const id = `rubric-${submissionId}`;
  const own = current && criteria ? criteria.filter((item) => item.rubric_id === current.id) : [];
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("rubric.label")}</FieldLabel>
      {editable && choices.length > 0 ? (
        <OptSelect
          id={id}
          value={value.picked && value.picked !== fallback?.id ? value.picked : NONE}
          disabled={pick.isPending}
          options={[
            {
              value: NONE,
              label: fallback
                ? t("rubric.divisionDefault", { name: fallback.name })
                : t("rubric.none"),
            },
            ...choices.map((rubric) => ({ value: rubric.id, label: rubric.name })),
          ]}
          onChange={(next) => pick.mutate(next === NONE ? null : next)}
        />
      ) : (
        <p className="text-sm">{current?.name ?? t("rubric.notPicked")}</p>
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
      {current?.description_md && (
        <Markdown className="text-sm text-muted-fg">{current.description_md}</Markdown>
      )}
      {own.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-muted-fg">
          {own.map((criterion) => (
            <li key={criterion.id}>{criterion.label}</li>
          ))}
        </ul>
      )}
      <ErrorAlert error={pick.error} title={t("rubric.failed")} />
    </Field>
  );
}
