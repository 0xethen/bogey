import { Button } from "@bogey/ui/components/button";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  orgMembersQueryOptions,
  removeOrgMemberFn,
  setOrgRoleFn,
  type OrgRole,
} from "@bogey/db/queries/org";
import { unwrap } from "@bogey/db/errors";
import { formatDate } from "@bogey/utils/time";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Screen } from "@bogey/ui/components/screen";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/org/members")({
  staticData: { title: msg("orgTab.members") },
  loader: ({ context }) => context.query.ensureQueryData(orgMembersQueryOptions(context.org.id)),
  component: RouteComponent,
});

const ROLES: Tuple<{ value: OrgRole; label: PlainKey; description: PlainKey }> = [
  { value: "member", label: "orgRole.member", description: "orgRole.memberHelp" },
  { value: "admin", label: "orgRole.admin", description: "orgRole.adminHelp" },
  { value: "owner", label: "orgRole.owner", description: "orgRole.ownerHelp" },
];

function RouteComponent() {
  const t = useT();
  const { org, session } = Route.useRouteContext();
  const time = useTimeFormat();
  const queryClient = useQueryClient();
  const { data: members } = useSuspenseQuery(orgMembersQueryOptions(org.id));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: orgMembersQueryOptions(org.id).queryKey });

  const setRole = useMutation({
    mutationFn: async (input: { userId: string; role: OrgRole }) =>
      unwrap(await setOrgRoleFn({ data: { orgId: org.id, ...input } })),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) =>
      unwrap(await removeOrgMemberFn({ data: { orgId: org.id, userId } })),
    onSettled: refresh,
  });
  const error = setRole.error ?? remove.error;

  return (
    <Screen
      title={t("orgTab.members")}
      description={
        <>
          {t("members.intro")}{" "}
          <Link to="/events" className="link">
            {t("members.anEvent")}
          </Link>
          .
        </>
      }
    >
      <ErrorAlert error={error} title={t("members.failed")} />
      <DisclosureList>
        {members.map((member) => {
          const you = member.userId === session.user.id;
          return (
            <DisclosureRow
              key={member.userId}
              leading={<NameAvatar name={member.name} />}
              title={
                <>
                  {member.name}
                  {you && <span className="font-normal text-muted-fg"> {t("welcome.you")}</span>}
                </>
              }
              meta={t("members.joined", { date: formatDate(member.joinedAt, time) })}
              actions={
                <OptSelect
                  size="sm"
                  ariaLabel={t("members.roleFor", { name: member.name })}
                  value={member.role}
                  options={ROLES.map((role) => ({
                    ...role,
                    label: t(role.label),
                    description: t(role.description),
                  }))}
                  disabled={setRole.isPending}
                  onChange={(role) => setRole.mutate({ userId: member.userId, role })}
                />
              }
            >
              <div className="pl-11">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={remove.isPending}
                  confirm={{
                    title: you
                      ? t("members.leaveTitle", { org: org.name })
                      : t("members.removeTitle", { name: member.name }),
                    description: you
                      ? t("members.leaveBody")
                      : t("members.removeBody", { name: member.name }),
                    label: you ? t("members.leave") : t("twoFactor.remove"),
                  }}
                  onClick={() => remove.mutate(member.userId)}
                >
                  {you ? t("members.leaveButton") : t("members.removeButton")}
                </Button>
              </div>
            </DisclosureRow>
          );
        })}
      </DisclosureList>
    </Screen>
  );
}
