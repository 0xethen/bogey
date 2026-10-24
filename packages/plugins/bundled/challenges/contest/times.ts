// a solve's time on the scoreboard: 47m, or 47:05 when the contest counts seconds
export function solveTime(
  cell: { minutes: number | null; seconds?: number | null },
  unit: "minutes" | "seconds" | undefined,
): string | null {
  if (unit === "seconds" && cell.seconds != null) {
    return `${Math.floor(cell.seconds / 60)}:${String(cell.seconds % 60).padStart(2, "0")}`;
  }
  return cell.minutes === null ? null : `${cell.minutes}m`;
}
