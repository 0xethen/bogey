import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconHeart, IconHeartFilled } from "@tabler/icons-react";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  galleryEngagementQueryOptions,
  myLikesQueryOptions,
  setLikeFn,
} from "@bogey/db/queries/gallery";
import { Button } from "@bogey/ui/components/button";
import { useT } from "#/lib/translate.tsx";
import { useViewerSession } from "#/lib/viewer.ts";

export function LikeButton({
  eventId,
  submissionId,
  count,
}: {
  eventId: string;
  submissionId: string;
  count: number;
}) {
  const t = useT();
  const session = useViewerSession();
  const queryClient = useQueryClient();
  const mine = useQuery({ ...myLikesQueryOptions(eventId), enabled: !!session });
  const like = useMutation({
    mutationFn: async (liked: boolean) =>
      unwrap(await setLikeFn({ data: { submissionId, like: liked } }).catch(requestFailure)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myLikesQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({
          queryKey: galleryEngagementQueryOptions(eventId).queryKey,
        }),
      ]),
  });
  const liked = mine.data?.includes(submissionId) ?? false;
  const label = liked ? t("gallery.unlike") : t("gallery.like");
  return (
    <Button
      size="sm"
      variant="ghost"
      className={liked ? "text-danger" : "text-muted-fg"}
      aria-pressed={session ? liked : undefined}
      aria-label={session ? label : t("gallery.signInToLike")}
      disabled={like.isPending}
      {...(session
        ? { onClick: () => like.mutate(!liked) }
        : { nativeButton: false, render: <Link to="/auth/login" /> })}
    >
      {liked ? <IconHeartFilled /> : <IconHeart />}
      <span className="tabular-nums">{count}</span>
    </Button>
  );
}
