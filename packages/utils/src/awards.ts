export const AWARD_KINDS = ["overall", "division", "track", "popular", "special"] as const;
export type AwardKind = (typeof AWARD_KINDS)[number];

export interface RankedEntry {
  submissionId: string;
  formId: string;
  formTitle: string;
  score: number | null;
  rank: number;
  divisionRank: number;
  divisionId: string | null;
}

export interface AwardDraft {
  kind: AwardKind;
  label: string;
  place: number | null;
  submissionId: string;
  formId: string | null;
  trackId: string | null;
  divisionId: string | null;
  note: string;
}

export function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export interface AwardInputs {
  rows: Tuple<RankedEntry>;
  divisions: Tuple<{ id: string; name: string }>;
  prizes: Tuple<{ id: string; name: string; maxWinners: number }>;
  entries: Tuple<{ trackId: string; submissionId: string }>;
  votes?: Tuple<{ submissionId: string; count: number }>;
  overallPlaces?: number;
}

function blank(
  kind: AwardKind,
  label: string,
  submissionId: string,
  rest: Partial<AwardDraft> = {},
): AwardDraft {
  return {
    kind,
    label,
    place: null,
    submissionId,
    formId: null,
    trackId: null,
    divisionId: null,
    note: "",
    ...rest,
  };
}

export function proposeAwards(inputs: AwardInputs): AwardDraft[] {
  const places = inputs.overallPlaces ?? 3;
  const scored = inputs.rows.filter((row) => row.score !== null);
  const forms = new Set(scored.map((row) => row.formId));
  const several = forms.size > 1;
  const out: AwardDraft[] = [];

  for (const row of scored) {
    if (row.rank > places) continue;
    out.push(
      blank(
        "overall",
        `${ordinal(row.rank)} place${several ? `, ${row.formTitle}` : ""}`,
        row.submissionId,
        { place: row.rank, formId: row.formId },
      ),
    );
  }
  out.sort(
    (a, b) => (a.formId ?? "").localeCompare(b.formId ?? "") || (a.place ?? 0) - (b.place ?? 0),
  );

  const divisionNames = new Map(inputs.divisions.map((division) => [division.id, division.name]));
  for (const row of scored) {
    const name = row.divisionId ? divisionNames.get(row.divisionId) : undefined;
    if (!row.divisionId || !name || row.divisionRank !== 1) continue;
    out.push(
      blank("division", `${name} winner${several ? `, ${row.formTitle}` : ""}`, row.submissionId, {
        place: 1,
        formId: row.formId,
        divisionId: row.divisionId,
      }),
    );
  }

  const byId = new Map(scored.map((row) => [row.submissionId, row]));
  for (const prize of inputs.prizes) {
    const entered = inputs.entries
      .filter((entry) => entry.trackId === prize.id)
      .flatMap((entry) => byId.get(entry.submissionId) ?? [])
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, prize.maxWinners);
    entered.forEach((row, index) => {
      out.push(
        blank(
          "track",
          prize.maxWinners > 1 ? `${ordinal(index + 1)} in ${prize.name}` : prize.name,
          row.submissionId,
          { place: index + 1, trackId: prize.id, formId: row.formId },
        ),
      );
    });
  }

  const top = Math.max(0, ...(inputs.votes ?? []).map((vote) => vote.count));
  if (top > 0) {
    for (const vote of inputs.votes ?? []) {
      if (vote.count === top)
        out.push(blank("popular", "Popular vote", vote.submissionId, { place: 1 }));
    }
  }
  return out;
}
