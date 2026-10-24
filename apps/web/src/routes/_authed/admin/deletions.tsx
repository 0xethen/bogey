import { createFileRoute, Link } from "@tanstack/react-router";
import { IconUserOff } from "@tabler/icons-react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { deletionRequestsQueryOptions, resolveDeletionRequestFn } from "@bogey/db/queries/instance";
import { unwrap } from "@bogey/db/errors";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Button } from "@bogey/ui/components/button";
import { DisclosureRow, RowList } from "@bogey/ui/components/row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@bogey/ui/components/empty";
import { Screen } from "@bogey/ui/components/screen";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { msg, useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/deletions")({
  staticData: { title: msg("adminTab.deletions") },
  loader: ({ context }) => context.query.ensureQueryData(deletionRequestsQueryOptions()),
  component: RouteComponent,
});

function RouteComponent() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: requests } = useSuspenseQuery(deletionRequestsQueryOptions());
  const resolve = useMutation({
    mutationFn: async (change: { userId: string; decline: boolean }) =>
      unwrap(await resolveDeletionRequestFn({ data: change })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance"] }),
  });

  return (
    <Screen
      title={t("deletions.title")}
      description={
        <>
          {t("deletions.intro")}{" "}
          <Link to="/admin/settings/accounts" hash="accounts.deletionRequests" className="link">
            {t("deletions.turnOff")}...
          </Link>
        </>
      }
      width="narrow"
    >
      <ErrorAlert error={resolve.error} title={t("deletions.failed")} />
      {requests.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconUserOff />
            </EmptyMedia>
            <EmptyTitle>{t("deletions.noneTitle")}</EmptyTitle>
            <EmptyDescription>{t("deletions.none")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <RowList>
          {requests.map((request) => (
            <DisclosureRow
              key={request.userId}
              leading={<NameAvatar name={request.name} />}
              title={request.name}
              meta={
                <>
                  {request.email}, {t("deletions.asked")}{" "}
                  <RelativeTime value={request.requestedAt} />
                </>
              }
            >
              <div className="flex flex-col gap-3">
                {request.reason && <p className="text-sm whitespace-pre-line">{request.reason}</p>}
                <p className="text-sm text-muted-fg">
                  {request.orgs.length
                    ? t("deletions.memberOf", { orgs: request.orgs.join(", ") })
                    : t("deletions.noOrgs")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={resolve.isPending}
                    confirm={{
                      title: t("deletions.deleteTitle", { name: request.name }),
                      description: t("deletions.deleteBody"),
                      label: t("deletions.deleteLabel"),
                    }}
                    onClick={() => resolve.mutate({ userId: request.userId, decline: false })}
                  >
                    {t("deletions.deleteButton")}...
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolve.isPending}
                    onClick={() => resolve.mutate({ userId: request.userId, decline: true })}
                  >
                    {t("deletions.decline")}
                  </Button>
                </div>
              </div>
            </DisclosureRow>
          ))}
        </RowList>
      )}
    </Screen>
  );
}
