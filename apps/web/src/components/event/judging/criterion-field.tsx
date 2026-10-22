import { Field, FieldLabel } from "@bogey/ui/components/field";
import { Markdown } from "@bogey/ui/components/markdown";
import { ScoreGuide, type ScoreBand } from "@bogey/ui/components/score-guide";
import { ScoreInput } from "./score-input.tsx";
import { useT } from "#/lib/translate.tsx";

export interface CriterionShown {
  id: string;
  label: string;
  descriptionMd: string;
  minScore: number;
  maxScore: number;
  guidance?: Tuple<ScoreBand>;
}

export function CriterionField({
  criterion,
  value,
  disabled,
  onChange,
}: {
  criterion: CriterionShown;
  value: number | null;
  disabled?: boolean;
  onChange: (score: number) => void;
}) {
  const t = useT();
  const id = `score-${criterion.id}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {criterion.label || <span className="text-muted-fg">{t("judging.untitledCriterion")}</span>}
        <span className="font-normal text-muted-fg tabular-nums">
          {" "}
          {value ?? "–"} / {criterion.maxScore}
          {criterion.minScore > 0 && ` (${t("judging.from", { min: criterion.minScore })})`}
        </span>
      </FieldLabel>
      {criterion.descriptionMd && (
        <Markdown className="text-sm text-muted-fg">{criterion.descriptionMd}</Markdown>
      )}
      <ScoreInput
        id={id}
        label={criterion.label}
        value={value}
        min={criterion.minScore}
        max={criterion.maxScore}
        disabled={disabled}
        onChange={onChange}
      />
      {criterion.guidance && <ScoreGuide bands={criterion.guidance} score={value} />}
    </Field>
  );
}
