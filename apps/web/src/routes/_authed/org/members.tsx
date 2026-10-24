import { useCallback, useMemo } from "react";
import { Button } from "@bogey/ui/components/button";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  orgMembersQueryOptions,
  removeOrgMemberFn,
  setOrgRoleFn,
  type OrgMember,
  type OrgRole,
} from "@bogey/db/queries/org";
import { unwrap } from "@bogey/db/errors";
import { formatDate } from "@bogey/utils/time";
import { OptSelect } from "@bogey/ui/components/opt-select";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { Screen } from "@bogey/ui/components/screen";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { tagHoldersQueryOptions, tagsQueryOptions } from "@bogey/db/queries/tags";
import { msg, useT, type PlainKey } from "#/lib/translate.tsx";
import { TagPicker, TagsEditor } from "#/components/tags/tags.tsx";
import {
  prefetchSettingFields,
  SettingFields,
} from "#/components/settings/fields/setting-fields.tsx";
import { searchSection, searchSettings } from "#/components/settings/layout/search-entries.ts";

export const Route = createFileRoute("/_authed/org/members")({
  staticData: {
    title: msg("orgTab.members"),
    settings: (t) => [
      searchSection(t("tags.title"), { keywords: ["labels", "judge types"], id: "tags" }),
      ...searchSettings("tags", ["eventTags"], t),
    ],
  },
  loader: ({ context }) =>
    Promise.all([
      context.query.ensureQueryData(orgMembersQueryOptions(context.org.id)),
      context.query.ensureQueryData(tagsQueryOptions({ orgId: context.org.id })),
      context.query.ensureQueryData(tagHoldersQueryOptions({ orgId: context.org.id })),
      prefetchSettingFields(context.query, { scope: "org", orgId: context.org.id }, ["tags"]),
    ]),
  component: RouteComponent,
});

const ROLES: Tuple<{ value: OrgRole; label: PlainKey; description: PlainKey }> = [
  { value: "member", label: "orgRole.member", description: "orgRole.memberHelp" },
  { value: "admin", label: "orgRole.admin", description: "orgRole.adminHelp" },
  { value: "owner", label: "orgRole.owner", description: "orgRole.ownerHelp" },
];

const column = dataColumns<OrgMember>();

const search = { text: (member: OrgMember) => member.name };

function RouteComponent() {
  const t = useT();
  const { org, session } = Route.useRouteContext();
  const time = useTimeFormat();
  const queryClient = useQueryClient();
  const { data: members } = useSuspenseQuery(orgMembersQueryOptions(org.id));
  const { data: tags } = useSuspenseQuery(tagsQueryOptions({ orgId: org.id }));
  const { data: holders } = useSuspenseQuery(tagHoldersQueryOptions({ orgId: org.id }));
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
  const you = session.user.id;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: t("checkin.name"),
          enableHiding: false,
          cell: (info) => (
            <span className="flex items-center gap-2 font-medium">
              <NameAvatar name={info.getValue()} />
              {info.getValue()}
              {info.row.original.userId === you && (
                <span className="font-normal text-muted-fg"> {t("welcome.you")}</span>
              )}
            </span>
          ),
        }),
        column.accessor("role", {
          header: t("managePeople.roleColumn"),
          cell: (info) => (
            <OptSelect
              size="sm"
              ariaLabel={t("members.roleFor", { name: info.row.original.name })}
              value={info.getValue()}
              options={ROLES.map((role) => ({
                ...role,
                label: t(role.label),
                description: t(role.description),
              }))}
              disabled={setRole.isPending}
              onChange={(role) => setRole.mutate({ userId: info.row.original.userId, role })}
            />
          ),
        }),
        column.accessor("joinedAt", {
          header: t("adminPeople.joined"),
          cell: (info) => (
            <span className="text-muted-fg">{formatDate(info.getValue(), time)}</span>
          ),
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, time, you, setRole.isPending],
  );
  const detail = useCallback(
    (member: OrgMember) => {
      const mine = member.userId === you;
      return (
        <div className="flex flex-col items-start gap-3 py-2">
          {tags.length > 0 && (
            <TagPicker
              orgId={org.id}
              userId={member.userId}
              name={member.name}
              tags={tags}
              held={holders
                .filter((each) => each.userId === member.userId)
                .map((each) => each.tagId)}
              editableScopes={{ org: true, event: false }}
            />
          )}
          <Button
            variant="destructive"
            size="sm"
            disabled={remove.isPending}
            confirm={{
              title: mine
                ? t("members.leaveTitle", { org: org.name })
                : t("members.removeTitle", { name: member.name }),
              description: mine
                ? t("members.leaveBody")
                : t("members.removeBody", { name: member.name }),
              label: mine ? t("members.leave") : t("twoFactor.remove"),
            }}
            onClick={() => remove.mutate(member.userId)}
          >
            {mine ? `${t("members.leaveButton")}...` : `${t("members.removeButton")}...`}
          </Button>
        </div>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, you, tags, holders, org.id, org.name, remove.isPending],
  );

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
      <DataTable
        columns={columns}
        data={members}
        getRowId={(member) => member.userId}
        search={search}
        detail={detail}
        pageSize={25}
      />
      <Screen.Section id="tags" title={t("tags.title")} description={t("tags.orgIntro")}>
        <TagsEditor scope={{ orgId: org.id }} />
        <SettingFields
          scope={{ scope: "org", orgId: org.id }}
          namespace="tags"
          keys={["eventTags"]}
        />
      </Screen.Section>
    </Screen>
  );
}
