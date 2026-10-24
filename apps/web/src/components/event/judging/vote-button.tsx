import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconThumbUp, IconThumbUpFilled } from "@tabler/icons-react";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { myVotesQueryOptions, setVoteFn, voteCountsQueryOptions } from "@bogey/db/queries/votes";
import { eventWindowsQueryOptions, isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Button } from "@bogey/ui/components/button";
import { useViewerSession } from "#/lib/viewer.ts";
import { useT } from "#/lib/translate.tsx";

export function VoteButton({ eventId, submissionId }: { eventId: string; submissionId: string }) {
  const t = useT();
  const session = useViewerSession();
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQueryOptions({ eventId }, ["voting"]));
  const windows = useQuery(eventWindowsQueryOptions(eventId));
  const mine = useQuery({ ...myVotesQueryOptions(eventId), enabled: !!session });
  const counts = useQuery(voteCountsQueryOptions(eventId));
  const vote = useMutation({
    mutationFn: async (cast: boolean) =>
      unwrap(await setVoteFn({ data: { submissionId, vote: cast } }).catch(requestFailure)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myVotesQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: voteCountsQueryOptions(eventId).queryKey }),
      ]),
  });

  const enabled = settings.data?.voting.enabled === true;
  const open = windows.data ? isWindowOpen(windowByKey(windows.data, "voting")) : false;
  const count = counts.data?.find((row) => row.submissionId === submissionId)?.count;
  if (!enabled || (!open && count === undefined)) return null;

  const voted = mine.data?.includes(submissionId) ?? false;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {open &&
        (session ? (
          <Button
            size="sm"
            variant={voted ? "secondary" : "outline"}
            disabled={vote.isPending}
            onClick={() => vote.mutate(!voted)}
          >
            {voted ? <IconThumbUpFilled /> : <IconThumbUp />}
            {voted ? t("vote.voted") : t("vote.vote")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            render={<Link to="/auth/login" />}
            nativeButton={false}
          >
            <IconThumbUp />
            {t("vote.signIn")}
          </Button>
        ))}
      {count !== undefined && (
        <span className="text-sm text-muted-fg">{t("vote.count", { count })}</span>
      )}
      {vote.error && <span className="text-sm text-danger">{vote.error.message}</span>}
    </div>
  );
}
