import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setSubmissionRubricFn, type Criterion, type Rubric } from "@bogey/db/queries/judging";
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
  value: string | null;
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
  if (rubrics.length === 0) return null;
  const picked = rubrics.find((rubric) => rubric.id === value) ?? null;
  const id = `rubric-${submissionId}`;
  const own = picked && criteria ? criteria.filter((item) => item.rubric_id === picked.id) : [];
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("rubric.label")}</FieldLabel>
      {editable ? (
        <OptSelect
          id={id}
          value={picked?.id ?? NONE}
          disabled={pick.isPending}
          options={[
            { value: NONE, label: t("rubric.none") },
            ...rubrics.map((rubric) => ({ value: rubric.id, label: rubric.name })),
          ]}
          onChange={(next) => pick.mutate(next === NONE ? null : next)}
        />
      ) : (
        <p className="text-sm">{picked?.name ?? t("rubric.notPicked")}</p>
      )}
      {description && <FieldDescription>{description}</FieldDescription>}
      {picked?.description_md && (
        <Markdown className="text-sm text-muted-fg">{picked.description_md}</Markdown>
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
