import { Button } from "@bogey/ui/components/button";
import { useTimeFormat } from "@bogey/ui/lib/time-format";
import { useState } from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  agendaQueryOptions,
  rosterQueryOptions,
  sessionCodeFn,
  sessionCodeQueryOptions,
  setAttendanceFn,
  type RosterEntry,
} from "@bogey/db/queries/sessions";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { formatTimeRange } from "@bogey/utils/time";
import { Badge } from "@bogey/ui/components/badge";
import { Checkbox } from "@bogey/ui/components/checkbox";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Input } from "@bogey/ui/components/input";
import { Screen } from "@bogey/ui/components/screen";
import { sessionTimes } from "#/components/event/agenda/agenda.tsx";
import { PluginSlot } from "#/components/plugins/plugin-slot.tsx";
import { useT } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/agenda/$sessionId")({
  loader: async ({ context, params }) => {
    const agenda = await context.query.ensureQueryData(agendaQueryOptions(context.event.id));
    const session = agenda.slots
      .flatMap((slot) => slot.sessions)
      .find((entry) => entry.id === params.sessionId);
    if (!session?.canTakeAttendance) throw notFound();
    await Promise.all([
      context.query.ensureQueryData(rosterQueryOptions(session.id)),
      context.query.ensureQueryData(sessionCodeQueryOptions(session.id)),
    ]);
    return { title: session.name };
  },
  component: RouteComponent,
});

function RouteComponent() {
  const time = useTimeFormat();
  const { event, session: viewer } = Route.useRouteContext();
  const { sessionId } = Route.useParams();
  const { data: agenda } = useSuspenseQuery(agendaQueryOptions(event.id));
  const slot = agenda.slots.find((entry) => entry.sessions.some((s) => s.id === sessionId));
  const session = slot?.sessions.find((entry) => entry.id === sessionId);
  if (!slot || !session) return null;
  const { start, end } = sessionTimes(session, slot);

  return (
    <Screen
      title={session.name}
      description={[formatTimeRange(start, end, time), session.location]
        .filter(Boolean)
        .join(" · ")}
      width="narrow"
    >
      {session.kind.includes(".") && (
        <PluginSlot pluginKey={session.kind.slice(0, session.kind.indexOf("."))} eventId={event.id}>
          {({ slots, settings }) => {
            const Panel = slots.sessionPanel;
            return Panel ? (
              <Panel
                eventId={event.id}
                settings={settings}
                session={viewer}
                sessionId={sessionId}
                kind={session.kind}
              />
            ) : null;
          }}
        </PluginSlot>
      )}
      <CheckInCode sessionId={sessionId} />
      <Roster sessionId={sessionId} forEveryone={slot.kind === "everyone"} />
    </Screen>
  );
}

function CheckInCode({ sessionId }: { sessionId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const options = sessionCodeQueryOptions(sessionId);
  const { data: code } = useSuspenseQuery(options);
  const rotate = useMutation({
    mutationFn: async () =>
      unwrap(await sessionCodeFn({ data: { sessionId, rotate: true } }).catch(requestFailure)),
    onSuccess: (next) => queryClient.setQueryData(options.queryKey, next),
  });

  return (
    <Screen.Section
      id="check-in-code"
      title={t("session.codeTitle")}
      description={t("session.codeHelp")}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border p-5">
        <p className="font-mono text-5xl font-semibold tracking-[0.3em] tabular-nums">{code}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={rotate.isPending}
          confirm={{
            title: t("session.replaceTitle"),
            description: t("session.replaceBody"),
            label: t("session.replaceLabel"),
          }}
          onClick={() => rotate.mutate()}
        >
          {t("session.newCode")}
        </Button>
      </div>
      <ErrorAlert error={rotate.error} title={t("session.replaceFailed")} />
    </Screen.Section>
  );
}

function Roster({ sessionId, forEveryone }: { sessionId: string; forEveryone: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const options = { ...rosterQueryOptions(sessionId), refetchInterval: 15_000 };
  const { data: roster } = useSuspenseQuery(options);
  const [search, setSearch] = useState("");
  const mark = useMutation({
    mutationFn: async (input: { userId: string; attended: boolean }) =>
      unwrap(await setAttendanceFn({ data: { sessionId, ...input } }).catch(requestFailure)),
    onMutate: async ({ userId, attended }) => {
      await queryClient.cancelQueries({ queryKey: options.queryKey });
      const previous = queryClient.getQueryData<RosterEntry[]>(options.queryKey);
      queryClient.setQueryData<RosterEntry[]>(options.queryKey, (rows) =>
        rows?.map((row) =>
          row.userId === userId
            ? {
                ...row,
                attendedAt: attended ? new Date().toISOString() : null,
                method: attended ? "roster" : null,
              }
            : row,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(options.queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: options.queryKey }),
  });

  const here = roster.filter((row) => row.attendedAt).length;
  const needle = search.trim().toLowerCase();
  const shown = needle ? roster.filter((row) => row.name.toLowerCase().includes(needle)) : roster;

  return (
    <Screen.Section
      id="roster"
      title={t("session.roster")}
      description={t("session.here", { here, total: roster.length })}
      actions={
        <Input
          type="search"
          aria-label={t("session.searchLabel")}
          placeholder={t("session.searchPlaceholder")}
          className="w-48"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      }
    >
      <ErrorAlert error={mark.error} title={t("session.markFailed")} />
      {roster.length === 0 ? (
        <p className="text-sm text-muted-fg">
          {forEveryone ? t("session.noParticipants") : t("session.noSignups")}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-fg">{t("session.noMatch", { search })}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {shown.map((row) => (
            <li key={row.userId}>
              <label className="flex items-center gap-3 px-2 py-2.5 text-sm">
                <Checkbox
                  checked={row.attendedAt !== null}
                  onCheckedChange={(checked) =>
                    mark.mutate({ userId: row.userId, attended: checked })
                  }
                />
                <span className="flex-1 font-medium">{row.name}</span>
                {row.method === "code" && <Badge variant="outline">{t("session.checkedIn")}</Badge>}
                {!row.signedUp && row.attendedAt && (
                  <Badge variant="secondary">{t("session.walkIn")}</Badge>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
    </Screen.Section>
  );
}
