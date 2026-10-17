import { Button } from "@bogey/ui/components/button";
import { useMemo, useState } from "react";
import { useDebouncedCallback } from "@tanstack/react-pacer/debouncer";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { createFileRoute } from "@tanstack/react-router";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  instanceAdminsQueryOptions,
  instancePeopleQueryOptions,
  instanceAuditQueryOptions,
  setPasswordLoginFn,
  setPlatformAdminFn,
  type InstancePerson,
} from "@bogey/db/queries/instance";
import { unwrap } from "@bogey/db/errors";
import { formatDate, type FormatOptions } from "@bogey/utils/time";
import { NameAvatar } from "@bogey/ui/components/avatar";
import { RelativeTime } from "@bogey/ui/components/relative-time";
import { Badge } from "@bogey/ui/components/badge";
import { DataTable, dataColumns } from "@bogey/ui/components/data-table";
import { DisclosureList, DisclosureRow } from "@bogey/ui/components/disclosure-row";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@bogey/ui/components/input-group";
import { Screen } from "@bogey/ui/components/screen";
import { Spinner } from "@bogey/ui/components/spinner";
import { IconSearch } from "@tabler/icons-react";
import { useSessionRefresh } from "#/lib/refresh.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/admin/people")({
  staticData: { title: msg("adminTab.people") },
  validateSearch: z.object({ q: z.string().max(100).optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ q: search.q ?? "" }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.query.ensureQueryData(instanceAdminsQueryOptions()),
      context.query.ensureQueryData(instancePeopleQueryOptions(deps.q)),
      context.query.ensureQueryData(instanceAuditQueryOptions()),
    ]),
  component: RouteComponent,
  pendingComponent: () => <Screen.Skeleton width="wide" layout="table" />,
});

function RouteComponent() {
  const t = useT();
  const { session } = Route.useRouteContext();
  const { q = "" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const queryClient = useQueryClient();
  const refreshSession = useSessionRefresh();
  const time = useTimeFormat();
  const { data: admins } = useSuspenseQuery(instanceAdminsQueryOptions());
  const people = useQuery({ ...instancePeopleQueryOptions(q), placeholderData: keepPreviousData });

  const [search, setSearch] = useState(q);
  const applySearch = useDebouncedCallback(
    (value: string) => void navigate({ search: { q: value.trim() || undefined }, replace: true }),
    { wait: 250 },
  );

  const setAdmin = useMutation({
    mutationFn: async (change: { email: string; admin: boolean }) =>
      unwrap(await setPlatformAdminFn({ data: change })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance"] }),
    onSuccess: (_, change) =>
      !change.admin && change.email === session.user.email ? refreshSession() : undefined,
  });

  const columns = useMemo(
    () =>
      peopleColumns({
        time,
        t,
        you: session.user.id,
        lastAdmin: admins.length <= 1,
        pending: setAdmin.isPending,
        onChange: (change) => setAdmin.mutate(change),
      }),
    [time, t, session.user.id, admins.length, setAdmin],
  );

  return (
    <Screen title={t("adminTab.people")} description={t("adminPeople.intro")} width="wide">
      <ErrorAlert error={setAdmin.error} title={t("adminPeople.failed")} />

      <Screen.Section
        id="platform-admins"
        title={t("adminPeople.admins", { count: admins.length })}
      >
        <DisclosureList>
          {admins.map((admin) => (
            <DisclosureRow
              key={admin.userId}
              leading={<NameAvatar name={admin.name} />}
              title={
                <>
                  {admin.name}
                  {admin.userId === session.user.id && (
                    <span className="font-normal text-muted-fg"> {t("welcome.you")}</span>
                  )}
                </>
              }
              meta={`${admin.email}, ${t("adminPeople.since", { date: formatDate(admin.since, time) })}${admin.grantedBy ? `, ${t("adminPeople.addedBy", { name: admin.grantedBy })}` : ""}`}
            />
          ))}
        </DisclosureList>
      </Screen.Section>

      <Screen.Section
        id="everyone"
        title={t("adminPeople.everyone")}
        description={t("adminPeople.everyoneHelp")}
      >
        <InputGroup className="max-w-sm">
          <InputGroupAddon>{people.isFetching ? <Spinner /> : <IconSearch />}</InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={t("adminPeople.search")}
            placeholder={t("checkin.searchPlaceholder")}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              applySearch(event.currentTarget.value);
            }}
          />
        </InputGroup>
        <ErrorAlert
          error={people.error instanceof Error ? people.error : null}
          title={t("adminPeople.loadFailed")}
        />
        <DataTable
          columns={columns}
          data={people.data ?? EMPTY}
          getRowId={(person) => person.id}
          empty={q ? t("session.noMatch", { search: q }) : t("adminPeople.empty")}
        />
        {people.data?.length === 200 && (
          <p className="text-sm text-muted-fg">{t("adminPeople.first200")}</p>
        )}
      </Screen.Section>

      <InstanceChanges />
    </Screen>
  );
}

const EMPTY: InstancePerson[] = [];

const column = dataColumns<InstancePerson>();

function peopleColumns(options: {
  t: T;
  time: FormatOptions;
  you: string;
  lastAdmin: boolean;
  pending: boolean;
  onChange: (change: { email: string; admin: boolean }) => void;
}) {
  const { t } = options;
  return column.columns([
    column.accessor("name", {
      header: t("checkin.name"),
      cell: (info) => (
        <span className="flex items-center gap-2 font-medium">
          {info.getValue()}
          {info.row.original.admin && <Badge variant="outline">{t("adminPeople.admin")}</Badge>}
        </span>
      ),
    }),
    column.accessor("email", {
      header: t("checkin.email"),
      cell: (info) => <span className="break-all text-muted-fg">{info.getValue()}</span>,
    }),
    column.accessor((person) => person.orgs.join(", "), {
      id: "orgs",
      header: t("adminTab.orgs"),
      cell: (info) => (
        <span className="text-muted-fg">{info.getValue() || t("adminOrgs.none")}</span>
      ),
    }),
    column.accessor("joinedAt", {
      header: t("adminPeople.joined"),
      sortFn: "datetime",
      cell: (info) => (
        <time dateTime={info.getValue()} className="whitespace-nowrap text-muted-fg tabular-nums">
          {formatDate(info.getValue(), options.time)}
        </time>
      ),
    }),
    column.display({
      id: "password",
      header: t("adminPeople.password"),
      cell: (info) => <PasswordLogin person={info.row.original} />,
    }),
    column.display({
      id: "actions",
      header: () => <span className="sr-only">{t("adminPeople.actions")}</span>,
      cell: (info) => {
        const person = info.row.original;
        const you = person.id === options.you;
        if (person.admin && options.lastAdmin) return null;
        return (
          <div className="-my-1.5 flex justify-end">
            {person.admin ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={options.pending}
                confirm={{
                  title: you
                    ? t("adminPeople.removeSelfTitle")
                    : t("adminPeople.removeTitle", { name: person.name }),
                  description: you ? t("adminPeople.removeSelfBody") : t("adminPeople.removeBody"),
                  label: t("twoFactor.remove"),
                }}
                onClick={() => options.onChange({ email: person.email, admin: false })}
              >
                {t("adminPeople.removeButton")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={options.pending}
                confirm={{
                  title: t("adminPeople.makeTitle", { name: person.name }),
                  description: t("adminPeople.makeBody"),
                  label: t("adminPeople.makeLabel"),
                  variant: "default",
                }}
                onClick={() => options.onChange({ email: person.email, admin: true })}
              >
                {t("adminPeople.makeButton")}
              </Button>
            )}
          </div>
        );
      },
    }),
  ]);
}

// someone sets their own password once this is on; turning it off clears it and signs them out
function PasswordLogin({ person }: { person: InstancePerson }) {
  const t = useT();
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: async (enabled: boolean) =>
      unwrap(await setPasswordLoginFn({ data: { userId: person.id, enabled } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["instance"] }),
  });
  return (
    <div className="-my-1.5 flex flex-col gap-1">
      {/* TODO: fix spacing with+without button */}
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap text-muted-fg">
          {person.admin
            ? t("adminPeople.passwordAdmin")
            : person.passwordLogin
              ? t("adminPeople.passwordOn")
              : t("adminPeople.passwordOff")}
        </span>
        {!person.admin &&
          (person.passwordLogin ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={change.isPending}
              confirm={{
                title: t("adminPeople.passwordOffTitle", { name: person.name }),
                description: t("adminPeople.passwordOffBody"),
                label: t("adminPeople.passwordTurnOff"),
              }}
              onClick={() => change.mutate(false)}
            >
              {t("adminPeople.passwordTurnOff")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={change.isPending}
              confirm={{
                title: t("adminPeople.passwordOnTitle", { name: person.name }),
                description: t("adminPeople.passwordOnBody"),
                label: t("adminPeople.passwordAllow"),
                variant: "default",
              }}
              onClick={() => change.mutate(true)}
            >
              {t("adminPeople.passwordAllow")}
            </Button>
          ))}
      </div>
      <ErrorAlert error={change.error} title={t("adminPeople.passwordFailed")} />
    </div>
  );
}

const CHANGE_LABELS = {
  "platform.admin_added": "adminPeople.changeAdminAdded",
  "platform.admin_removed": "adminPeople.changeAdminRemoved",
  "platform.password_on": "adminPeople.changePasswordOn",
  "platform.password_off": "adminPeople.changePasswordOff",
} as const;

function isKnownChange(action: string): action is keyof typeof CHANGE_LABELS {
  return action in CHANGE_LABELS;
}

function InstanceChanges() {
  const t = useT();
  const { data: changes } = useSuspenseQuery(instanceAuditQueryOptions());
  return (
    <Screen.Section
      id="changes"
      title={t("adminPeople.changes")}
      description={t("adminPeople.changesHelp")}
    >
      {changes.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("adminPeople.noChanges")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {changes.map((change) => (
            <li key={change.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
              <span>
                {t(
                  isKnownChange(change.action)
                    ? CHANGE_LABELS[change.action]
                    : "adminPeople.changeOther",
                  {
                    actor: change.actor ?? t("adminPeople.someone"),
                    target: change.target ?? t("adminPeople.someone"),
                    action: change.action,
                  },
                )}
              </span>
              <span className="text-muted-fg">
                <RelativeTime value={change.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Screen.Section>
  );
}
