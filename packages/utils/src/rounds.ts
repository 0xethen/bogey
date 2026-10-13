export interface RoundInfo {
  id: string;
  formId: string;
  ordinal: number;
  name: string;
}

export interface RoundEntry {
  roundId: string;
  submissionId: string;
}

export function activeRound<R extends RoundInfo>(
  rounds: Tuple<R>,
  entries: Tuple<RoundEntry>,
  submission: { id: string; formId: string },
): R | undefined {
  const advancedInto = new Set(
    entries.filter((entry) => entry.submissionId === submission.id).map((entry) => entry.roundId),
  );
  return rounds
    .filter((round) => round.formId === submission.formId)
    .filter((round) => round.ordinal === 1 || advancedInto.has(round.id))
    .sort((a, b) => b.ordinal - a.ordinal)[0];
}
