import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconTrash } from "@tabler/icons-react";
import { isOrgAdmin } from "@bogey/db/auth";
import { requestFailure, unwrap } from "@bogey/db/errors";
import {
  deleteCommentFn,
  galleryEngagementQueryOptions,
  galleryThreadQueryOptions,
  postCommentFn,
} from "@bogey/db/queries/gallery";
import { Button } from "@bogey/ui/components/button";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Textarea } from "@bogey/ui/components/textarea";
import { useT } from "#/lib/translate.tsx";
import { useViewerSession } from "#/lib/viewer.ts";

export function Comments({ eventId, submissionId }: { eventId: string; submissionId: string }) {
  const t = useT();
  const session = useViewerSession();
  const queryClient = useQueryClient();
  const thread = useQuery(galleryThreadQueryOptions(submissionId));
  const [draft, setDraft] = useState("");
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: galleryThreadQueryOptions(submissionId).queryKey }),
      queryClient.invalidateQueries({ queryKey: galleryEngagementQueryOptions(eventId).queryKey }),
    ]);
  const post = useMutation({
    mutationFn: async (body: string) =>
      unwrap(await postCommentFn({ data: { submissionId, body } }).catch(requestFailure)),
    onSuccess: () => setDraft(""),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await deleteCommentFn({ data: id }).catch(requestFailure)),
    onSettled: refresh,
  });
  const comments = thread.data ?? [];

  return (
    <section aria-labelledby="comments-heading" className="flex flex-col gap-3">
      <h2 id="comments-heading" className="font-heading text-lg font-medium">
        {t("gallery.comments")}
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("gallery.noComments")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex flex-col gap-0.5 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-medium">{comment.authorName}</span>
                <span className="text-xs text-muted-fg">
                  <RelativeTime value={comment.createdAt} />
                </span>
                {session && (comment.authorId === session.user.id || isOrgAdmin(session)) && (
                  <Button
                    size="icon-2xs"
                    variant="ghost"
                    aria-label={t("gallery.deleteComment")}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(comment.id)}
                  >
                    <IconTrash />
                  </Button>
                )}
              </span>
              <p className="whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <ErrorAlert error={post.error ?? remove.error} title={t("gallery.commentFailed")} />
      {session ? (
        <form
          className="flex flex-col items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) post.mutate(draft);
          }}
        >
          <Textarea
            value={draft}
            maxLength={1000}
            rows={3}
            aria-label={t("gallery.commentLabel")}
            placeholder={`${t("gallery.commentPlaceholder")}...`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={post.isPending || !draft.trim()}>
            {t("gallery.postComment")}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-muted-fg">
          <Link to="/auth/login" className="link">
            {t("gallery.signInToComment")}
          </Link>
        </p>
      )}
    </section>
  );
}
