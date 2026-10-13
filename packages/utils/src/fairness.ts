import { isEmail, parseTable } from "./roster.ts";
import { sayEnglish, type Say } from "./messages.ts";

export interface ConflictLine {
  email: string;
  team: string;
  reason: string;
}

export function parseConflicts(
  text: string,
  say: Say = sayEnglish,
): {
  lines: ConflictLine[];
  problems: { line: number; message: string }[];
} {
  const rows = parseTable(text);
  const lines: ConflictLine[] = [];
  const problems: { line: number; message: string }[] = [];
  rows.forEach((row, index) => {
    const [email = "", team = "", reason = ""] = row.cells;
    if (index === 0 && !isEmail(email)) return;
    if (!isEmail(email))
      problems.push({
        line: row.line,
        message: say("conflicts.notEmail", '"{email}" isn\'t an email address', { email }),
      });
    else if (!team.trim()) {
      problems.push({ line: row.line, message: say("conflicts.nameTeam", "Name the team") });
    } else lines.push({ email: email.trim(), team: team.trim(), reason: reason.trim() });
  });
  return { lines, problems };
}

export interface JudgeSpread {
  judgeId: string;
  scores: number;
  meanPct: number;
  sdPct: number;
}

export type Calibration = "harsh" | "generous" | "flat" | null;

export function calibrationFlags(judges: Tuple<JudgeSpread>): Map<string, Calibration> {
  const flags = new Map<string, Calibration>();
  const means = judges.map((judge) => judge.meanPct);
  const average = means.reduce((sum, value) => sum + value, 0) / (means.length || 1);
  const spread = Math.sqrt(
    means.reduce((sum, value) => sum + (value - average) ** 2, 0) / (means.length || 1),
  );
  for (const judge of judges) {
    let flag: Calibration = null;
    if (judges.length >= 3 && spread > 0) {
      const z = (judge.meanPct - average) / spread;
      if (z <= -1.5) flag = "harsh";
      else if (z >= 1.5) flag = "generous";
    }
    if (flag === null && judge.scores >= 10 && judge.sdPct < 5) flag = "flat";
    flags.set(judge.judgeId, flag);
  }
  return flags;
}
