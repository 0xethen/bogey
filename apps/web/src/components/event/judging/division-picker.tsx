import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { setSubmissionDivisionFn } from "@bogey/db/queries/judging";
import { formReaches, type SubmissionForm } from "@bogey/db/queries/submissions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Field, FieldDescription, FieldLabel } from "@bogey/ui/components/field";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { useT } from "#/lib/translate.tsx";

const NONE = "none";

/** Moves a project's team to another division from its score sheet. */
export function DivisionPicker({
  eventId,
  submissionId,
  form,
  value,
  editable,
  onMoved,
}: {
  eventId: string;
  submissionId: string;
  /** The judged entry's form; only divisions it's open to are offered. */
  form: Pick<SubmissionForm, "divisionIds"> | undefined;
  value: string | null;
  editable: boolean;
  onMoved?: () => Promise<unknown>;
}) {
  const t = useT();
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));
  const move = useMutation({
    mutationFn: async (divisionId: string) =>
      unwrap(
        await setSubmissionDivisionFn({ data: { submissionId, divisionId } }).catch(requestFailure),
      ),
    onSuccess: () => onMoved?.(),
  });
  if (divisions.length === 0) return null;
  const current = divisions.find((division) => division.id === value);
  const offered = divisions.filter(
    (division) => division.id === value || !form || formReaches(form, division.id),
  );
  const id = `division-${submissionId}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("judging.factDivision")}</FieldLabel>
      {editable && offered.some((division) => division.id !== value) ? (
        <OptSelect
          id={id}
          value={value ?? NONE}
          disabled={move.isPending}
          options={[
            ...(current ? [] : [{ value: NONE, label: t("judging.divisionNone") }]),
            ...offered.map((division) => ({ value: division.id, label: division.name })),
          ]}
          onChange={(next) => {
            if (next !== NONE && next !== value) move.mutate(next);
          }}
        />
      ) : (
        <p className="text-sm">{current?.name ?? t("judging.divisionNone")}</p>
      )}
      <FieldDescription>{t("judging.divisionHelp")}</FieldDescription>
      <ErrorAlert error={move.error} title={t("judging.divisionFailed")} />
    </Field>
  );
}
