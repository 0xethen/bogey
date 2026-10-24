import { DemoNotice } from "#/components/event/judging/demo-notice.tsx";
import { TableNotice } from "#/components/event/judging/table-notice.tsx";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  chooseTeamOptionFn,
  myRegistrationQueryOptions,
  withdrawFn,
} from "@bogey/db/queries/registration";
import { unwrap } from "@bogey/db/errors";
import { myTeamQueryOptions } from "@bogey/db/queries/teams";
import { mySubmissionsQueryOptions } from "@bogey/db/queries/submissions";
import { isWindowOpen, windowByKey, type EventWindow } from "@bogey/db/queries/windows";
import type { Event } from "@bogey/db/queries/events";
import { useViewAs, type EventAccess } from "@bogey/db/permissions";
import { Button } from "@bogey/ui/components/button";
import { Steps, type Step } from "#/components/event/submission/steps.tsx";
import { ErrorAlert } from "@bogey/ui/components/error-alert";
import { DialogTrigger } from "@bogey/ui/components/dialog";
import {
  changeDivision,
  DivisionDialog,
  useMyDivision,
} from "#/components/event/team/divisions.tsx";
import { useEventRefresh } from "#/lib/refresh.ts";
import { useT } from "#/lib/translate.tsx";

export function NextSteps({
  event,
  access,
  windows,
  title,
}: {
  event: Event;
  access: EventAccess | null;
  windows: Tuple<EventWindow>;
  title?: string;
}) {
  const t = useT();
  const member = access?.role === "participant";
  const registration = useQuery(myRegistrationQueryOptions(event.id));
  const team = useQuery({
    ...myTeamQueryOptions(event.id),
    enabled: member && event.team_size_max > 1,
  });
  const submissions = useQuery({ ...mySubmissionsQueryOptions(event.id), enabled: member });
  const division = useMyDivision(event.id, member);
  const refresh = useEventRefresh(event.id);
  const previewing = useViewAs();
  const queryClient = useQueryClient();
  const chooseTeam = useMutation({
    mutationFn: async (team: string | null) =>
      unwrap(await chooseTeamOptionFn({ data: { eventId: event.id, team } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: myRegistrationQueryOptions(event.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: myTeamQueryOptions(event.id).queryKey }),
      ]),
  });
  const withdraw = useMutation({
    mutationFn: async () => unwrap(await withdrawFn({ data: event.id })),
    onSuccess: refresh,
  });
  if (!member && registration.isPending) return null;

  const params = { slug: event.slug };
  const registrationOpen = isWindowOpen(windowByKey(windows, "registration"));
  const teamsOpen = isWindowOpen(windowByKey(windows, "teams"));
  const status = registration.data?.registration?.status;

  const steps: Step[] = [
    {
      key: "register",
      title: member
        ? t("steps.registered")
        : status === "pending"
          ? t("steps.reviewTitle")
          : status === "waitlisted"
            ? t("steps.waitlistTitle")
            : t("steps.register"),
      done: member,
      description: member
        ? undefined
        : status === "pending"
          ? t("steps.reviewBody")
          : status === "waitlisted"
            ? t("steps.waitlistBody")
            : status === "rejected"
              ? t("steps.rejectedBody")
              : registrationOpen
                ? t("steps.registerOpen")
                : t("steps.registerClosed"),
      actions: previewing
        ? undefined
        : member || status === "pending" || status === "waitlisted"
          ? [
              <Button
                key="withdraw"
                size="sm"
                variant="destructive"
                disabled={withdraw.isPending}
                confirm={{
                  title: member
                    ? t("steps.leaveTitle", { event: event.name })
                    : t("steps.withdrawTitle"),
                  description: member ? t("steps.leaveBody") : t("steps.withdrawBody"),
                  label: member ? t("steps.leave") : t("steps.withdraw"),
                }}
                onClick={() => withdraw.mutate()}
              >
                {member ? `${t("steps.leaveButton")}...` : `${t("steps.withdrawButton")}...`}
              </Button>,
            ]
          : registrationOpen && status !== "rejected"
            ? [
                <Button
                  key="register"
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/events/$slug/register" params={params} />}
                >
                  {t("steps.register")}
                </Button>,
              ]
            : undefined,
    },
  ];

  if (member && division.loaded && division.divisions.length > 0) {
    const current = division.current;
    steps.push({
      key: "division",
      title: current ? t("steps.inDivision", { name: current.name }) : t("steps.pickDivision"),
      done: !!current,
      description: current
        ? division.canChange
          ? t("steps.divisionSwitch")
          : t("steps.divisionMoved")
        : division.canChange
          ? t("steps.divisionAbout")
          : t("steps.divisionPlaced"),
      actions:
        !previewing && division.canChange
          ? [
              <DialogTrigger
                key="division"
                handle={changeDivision}
                render={<Button size="sm" variant={current ? "outline" : "default"} />}
              >
                {current ? `${t("steps.change")}...` : `${t("steps.pickOne")}...`}
              </DialogTrigger>,
            ]
          : undefined,
    });
  }

  const teamOptions = registration.data?.registration?.team_options ?? [];
  if (event.team_size_max > 1 && member && !team.data && teamOptions.length > 0) {
    steps.push({
      key: "team",
      title:
        teamOptions.length === 1
          ? t("steps.areYouOn", { team: teamOptions[0] ?? "" })
          : t("steps.whichTeam"),
      done: false,
      description: teamOptions.length === 1 ? t("steps.teamListed") : t("steps.teamSpelled"),
      actions: previewing
        ? undefined
        : [
            ...teamOptions.map((option) => (
              <Button
                key={option}
                size="sm"
                disabled={chooseTeam.isPending}
                onClick={() => chooseTeam.mutate(option)}
              >
                {teamOptions.length === 1 ? t("steps.yesJoin") : option}
              </Button>
            )),
            <Button
              key="none"
              size="sm"
              variant="outline"
              disabled={chooseTeam.isPending}
              onClick={() => chooseTeam.mutate(null)}
            >
              {teamOptions.length === 1 ? t("steps.no") : t("steps.noneOfThese")}
            </Button>,
          ],
    });
  } else if (event.team_size_max > 1) {
    const onTeam = !!team.data;
    steps.push({
      key: "team",
      title: onTeam ? t("steps.onTeam", { name: team.data!.team.name }) : t("steps.joinTeam"),
      done: onTeam,
      description: onTeam
        ? undefined
        : teamsOpen
          ? t("steps.teamsOpen", { max: event.team_size_max })
          : t("steps.teamsClosed"),
      actions:
        member && !onTeam && teamsOpen
          ? [
              <Button
                key="team"
                size="sm"
                nativeButton={false}
                render={<Link to="/events/$slug/team" params={params} />}
              >
                {t("steps.goToTeam")}
              </Button>,
            ]
          : undefined,
    });
  }

  for (const { form, submission } of submissions.data?.forms ?? []) {
    const formOpen = isWindowOpen(windowByKey(windows, form.window_key));
    const done = submission?.status === "submitted";
    steps.push({
      key: `submit-${form.key}`,
      title: done
        ? t("steps.submitted", { form: form.title })
        : t("steps.submit", { form: form.title }),
      done,
      description: done
        ? undefined
        : formOpen
          ? submission
            ? t("steps.draftStarted")
            : t("steps.openNow")
          : t("steps.notOpen"),
      actions:
        formOpen && !done
          ? [
              <Button
                key="submit"
                size="sm"
                nativeButton={false}
                render={
                  <Link to="/events/$slug/submission" params={params} search={{ form: form.key }} />
                }
              >
                {submission ? t("steps.continue") : t("steps.start")}
              </Button>,
            ]
          : undefined,
    });
  }

  return (
    <>
      <TableNotice
        tables={(submissions.data?.forms ?? []).map((item) => item.submission?.table_label)}
      />
      {member && <DemoNotice event={event} />}
      <Steps title={title ?? t("steps.title")} steps={steps} />
      {member && division.divisions.length > 0 && (
        <DivisionDialog
          eventId={event.id}
          divisions={division.divisions}
          current={division.current?.id ?? null}
        />
      )}
      <ErrorAlert error={withdraw.error} title={t("steps.leaveFailed")} />
      <ErrorAlert error={chooseTeam.error} title={t("steps.pickFailed")} />
    </>
  );
}
