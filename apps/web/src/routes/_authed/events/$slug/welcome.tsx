import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { updateProfileFn } from "@bogey/db/queries/profile";
import { leaveTeamFn, myTeamQueryOptions, invalidateMine } from "@bogey/db/queries/teams";
import { isWindowOpen, windowByKey } from "@bogey/db/queries/windows";
import {
  completeIdentitySetupFn,
  identitySetupPendingQueryOptions,
  isPending,
  NOTHING_NEEDED,
} from "@bogey/db/queries/identity-setup";
import { eventDivisionsQueryOptions } from "@bogey/db/queries/divisions";
import { settingsQueryOptions } from "@bogey/db/queries/settings";
import { ChooseDivision } from "#/components/event/team/divisions.tsx";
import { requestFailure, unwrap } from "@bogey/db/errors";
import { Badge } from "@bogey/ui/components/badge";
import { Button } from "@bogey/ui/components/button";
import { Roster } from "#/components/event/team/roster.tsx";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { Stepper } from "#/components/event/submission/stepper.tsx";
import { Screen } from "@bogey/ui/components/screen";
import {
  appFormOptions,
  errorVisibility,
  rewardEarlyPunishLate,
  useAppForm,
} from "@bogey/ui/lib/form";
import { StartOrJoinTeam } from "#/components/event/team/team-forms.tsx";
import { mayStart } from "#/lib/messaging.ts";
import { useSessionRefresh } from "#/lib/refresh.ts";
import { msg, useT, type T } from "#/lib/translate.tsx";

export const Route = createFileRoute("/_authed/events/$slug/welcome")({
  staticData: { title: msg("welcome.title"), command: false },
  beforeLoad: async ({ context, params }) => {
    const needs = await context.query.query({
      ...identitySetupPendingQueryOptions(context.event.id),
      staleTime: "static",
    });
    if (!isPending(needs)) throw Route.redirect({ to: "/events/$slug", params, replace: true });
    return { needs };
  },
  loader: ({ context }) =>
    Promise.all([
      context.needs.division
        ? context.query.query({
            ...eventDivisionsQueryOptions(context.event.id),
            staleTime: "static",
          })
        : null,
      context.query.query({
        ...settingsQueryOptions({ eventId: context.event.id }, ["teams"]),
        staleTime: "static",
      }),
    ]),
  component: RouteComponent,
});

const nameSchema = (t: T) =>
  z.object({
    displayName: z
      .string()
      .trim()
      .min(1, t("form.enterName"))
      .max(80, t("form.maxLength", { max: 80 }))
      .meta({ label: t("welcome.nameLabel") })
      .describe(t("welcome.nameHelp")),
  });

const STEP_ORDER = ["name", "division", "team", "done"] as const;
type StepKey = (typeof STEP_ORDER)[number];

const stepStorageKey = (eventId: string, userId: string) => `welcome-step:${eventId}:${userId}`;

function readSavedStep(storageKey: string): StepKey | null {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return STEP_ORDER.find((key) => key === saved) ?? null;
  } catch {
    return null;
  }
}

function saveStep(storageKey: string, key: StepKey) {
  try {
    window.localStorage.setItem(storageKey, key);
  } catch {}
}

function RouteComponent() {
  const t = useT();
  const { event, windows, needs, session, chat, access } = Route.useRouteContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const teamEvent = event.team_size_max > 1;
  const steps = [
    { key: "name", title: t("welcome.stepName"), shown: needs.identity },
    { key: "division", title: t("welcome.stepDivision"), shown: needs.division },
    { key: "team", title: t("welcome.stepTeam"), shown: needs.identity && teamEvent },
    { key: "done", title: t("welcome.stepReady"), shown: true },
  ] as const satisfies Tuple<{ key: StepKey; title: string; shown: boolean }>;
  const visibleSteps = steps.filter((candidate) => candidate.shown);
  const storageKey = stepStorageKey(event.id, session.user.id);
  const [current, setCurrent] = useState<number | null>(null);
  useEffect(() => {
    const saved = readSavedStep(storageKey);
    const resume = saved
      ? visibleSteps.findIndex((s) => STEP_ORDER.indexOf(s.key) >= STEP_ORDER.indexOf(saved))
      : 0;
    setCurrent(resume < 0 ? 0 : resume);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  const next = () =>
    setCurrent((index) => {
      const target = Math.min((index ?? 0) + 1, visibleSteps.length - 1);
      const key = visibleSteps[target]?.key;
      if (key) saveStep(storageKey, key);
      return target;
    });
  const step = current === null ? undefined : visibleSteps[current]?.key;

  const finish = useMutation({
    mutationFn: async () => unwrap(await completeIdentitySetupFn({ data: event.id })),
    onSuccess: async () => {
      queryClient.setQueryData(identitySetupPendingQueryOptions(event.id).queryKey, NOTHING_NEEDED);
      await navigate({ to: "/events/$slug", params: { slug: event.slug }, replace: true });
    },
  });

  return (
    <Screen
      title={t("welcome.heading", { event: event.name })}
      description={t("welcome.intro")}
      width="narrow"
    >
      {current !== null && <Stepper steps={visibleSteps} current={current} />}

      {step === "name" && <NameStep onDone={next} />}
      {step === "division" && <DivisionStep onDone={next} />}
      {step === "team" && (
        <TeamStep
          teamsOpen={isWindowOpen(windowByKey(windows, "teams"))}
          canMessage={mayStart(access, chat, "organizers")}
          onDone={next}
        />
      )}
      {step === "done" && (
        <section className="flex flex-col gap-4">
          <p className="text-sm">{t("welcome.ready")}</p>
          <ErrorAlert error={finish.error} title={t("welcome.finishFailed")} />
          <div>
            <Button disabled={finish.isPending} onClick={() => finish.mutate()}>
              {finish.isPending ? `${t("welcome.opening")}...` : t("welcome.goToEvent")}
            </Button>
          </div>
        </section>
      )}
    </Screen>
  );
}

function NameStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const schema = useMemo(() => nameSchema(t), [t]);
  const { session } = Route.useRouteContext();
  const refreshSession = useSessionRefresh();
  const form = useAppForm({
    ...appFormOptions.strictSchema(schema, {
      defaultValues: { displayName: session.profile?.display_name ?? "" },
      errorVisibility,
      validators: [rewardEarlyPunishLate(schema)],
    }),
    onSubmit: async ({ value, createValidationError }) => {
      if (value.displayName.trim() !== session.profile?.display_name) {
        const result = await updateProfileFn({ data: { displayName: value.displayName } }).catch(
          requestFailure,
        );
        if (!result.ok) return createValidationError(result.error.message);
        await refreshSession();
      }
      onDone();
      return undefined;
    },
  });

  return (
    <form.AppForm>
      <form.Form className="flex flex-col gap-4">
        <form.Field name="displayName">
          {(field) => <field.TextField required autoComplete="name" />}
        </form.Field>
        <form.FormAlert title={t("profile.nameFailed")} />
        <div>
          <form.Submit pending={`${t("common.saving")}...`}>{t("common.continue")}</form.Submit>
        </div>
      </form.Form>
    </form.AppForm>
  );
}

function DivisionStep({ onDone }: { onDone: () => void }) {
  const t = useT();
  const { event } = Route.useRouteContext();
  const eventId = event.id;
  const { data: divisions } = useSuspenseQuery(eventDivisionsQueryOptions(eventId));
  return (
    <ChooseDivision
      eventId={eventId}
      divisions={divisions}
      current={null}
      submitLabel={t("common.continue")}
      onDone={onDone}
    />
  );
}

function TeamStep({
  teamsOpen,
  canMessage,
  onDone,
}: {
  teamsOpen: boolean;
  canMessage: boolean;
  onDone: () => void;
}) {
  const t = useT();
  const { session, event } = Route.useRouteContext();
  const eventId = event.id;
  const queryClient = useQueryClient();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions({ eventId }, ["teams"]));
  const switching = settings.teams.switching;
  const team = useQuery(myTeamQueryOptions(eventId));
  const leave = useMutation({
    mutationFn: async () => unwrap(await leaveTeamFn({ data: eventId })),
    onSettled: () => invalidateMine(queryClient, eventId),
  });
  if (team.isPending) return null;

  if (team.data) {
    const mine = team.data;
    return (
      <section className="flex flex-col gap-4">
        <p className="text-sm">
          {t("welcome.youreOn")} <span className="font-medium">{mine.team.name}</span>.{" "}
          {t("welcome.isItYours")}
        </p>
        <Roster
          capacity={event.team_size_max}
          members={mine.members.map((member) => ({
            key: member.userId,
            name: member.name,
            note: member.userId === session.user.id ? t("welcome.you") : undefined,
            badge:
              member.role === "captain" ? (
                <Badge variant="secondary">{t("welcome.captain")}</Badge>
              ) : undefined,
          }))}
        />
        <ErrorAlert error={leave.error} title={t("welcome.leaveFailed")} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={onDone}>{t("welcome.yesMine")}</Button>
          {teamsOpen && switching && (
            <Button
              variant="ghost"
              disabled={leave.isPending}
              confirm={{
                title: t("welcome.leaveTitle", { team: mine.team.name }),
                description: t("welcome.leaveBody"),
                label: t("welcome.leave"),
              }}
              onClick={() => leave.mutate()}
            >
              {t("welcome.notMine")}...
            </Button>
          )}
          {teamsOpen && !switching && settings.teams.askOrganizer && canMessage && (
            <Button
              variant="ghost"
              render={<Route.Link to="/events/$slug/messages" params={{ slug: event.slug }} />}
            >
              {t("welcome.messageOrganizers")}
            </Button>
          )}
        </div>
        {!teamsOpen && <p className="text-sm text-muted-fg">{t("welcome.teamsLocked")}</p>}
        {teamsOpen && !switching && !(settings.teams.askOrganizer && canMessage) && (
          <p className="text-sm text-muted-fg">{t("welcome.switchingOff")}</p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      {teamsOpen ? (
        <StartOrJoinTeam onDone={onDone} />
      ) : (
        <p className="text-sm text-muted-fg">{t("welcome.teamsNotOpen")}</p>
      )}
      <div>
        <Button variant="ghost" onClick={onDone}>
          {teamsOpen ? t("welcome.skip") : t("common.continue")}
        </Button>
      </div>
    </section>
  );
}
