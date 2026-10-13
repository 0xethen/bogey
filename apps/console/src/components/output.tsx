import { Badge } from "@bogey/ui/components/badge";
import { Spinner } from "@bogey/ui/components/spinner";
import type { Run, RunStatus } from "#/lib/runs.tsx";

export const STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  ok: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

export function RunBadge({ run, onShow }: { run: Run | undefined; onShow: () => void }) {
  if (!run) return null;
  const button = <button type="button" title="Show the output" onClick={onShow} />;
  if (run.status === "running") {
    return (
      <Badge variant="secondary" render={button}>
        <Spinner data-icon="inline-start" />
        {STATUS_LABELS.running}
      </Badge>
    );
  }
  return (
    <Badge variant={run.status === "failed" ? "destructive" : "outline"} render={button}>
      {STATUS_LABELS[run.status]}
      {run.exitCode !== null && run.exitCode !== "0" && (
        <span className="font-mono opacity-70">{run.exitCode}</span>
      )}
    </Badge>
  );
}
