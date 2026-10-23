import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  manageSummaryQueryOptions,
  eventPeopleQueryOptions,
  type EventPeople,
  type Person,
} from "@bogey/db/queries/manage";
import { setDivisionFn } from "@bogey/db/queries/divisions";
import { setTeamMembershipFn, setTeamsDivisionFn } from "@bogey/db/queries/roster";
import { unwrap } from "@bogey/db/errors";

export function fromLink(people: EventPeople, linkId: string): EventPeople {
  const registrations = people.registrations.filter((row) => row.invite_link_id === linkId);
  const users = new Set(registrations.map((row) => row.user_id));
  return {
    ...people,
    registrations,
    members: people.members.filter((member) => users.has(member.userId)),
  };
}

export function usePeopleMutation<T, R>(eventId: string, run: (input: T) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: eventPeopleQueryOptions(eventId).queryKey }),
        queryClient.invalidateQueries({ queryKey: manageSummaryQueryOptions(eventId).queryKey }),
      ]),
  });
}

type Placed = Pick<Person, "userId" | "teamId" | "teamSize">;

// teams share one division: picked people move with their whole team, or leave a team they share
export function planDivisionMove(picked: Placed[], wholeTeams: boolean) {
  const pickedPerTeam = new Map<string, number>();
  for (const person of picked) {
    if (person.teamId)
      pickedPerTeam.set(person.teamId, (pickedPerTeam.get(person.teamId) ?? 0) + 1);
  }
  const teams = new Set<string>();
  const leave: string[] = [];
  const people: string[] = [];
  for (const person of picked) {
    if (!person.teamId) people.push(person.userId);
    else if (wholeTeams || (pickedPerTeam.get(person.teamId) ?? 0) >= person.teamSize)
      teams.add(person.teamId);
    else leave.push(person.userId);
  }
  return { teams: [...teams], leave, people };
}

/** Whether moving these people splits a team, so there's a choice to offer. */
export function splitsTeam(picked: Placed[]) {
  const plan = planDivisionMove(picked, false);
  return plan.leave.length > 0;
}

/** Runs a division change; resolves to how many changes failed. */
export async function moveDivision(
  eventId: string,
  picked: Placed[],
  divisionId: string | undefined,
  wholeTeams: boolean,
) {
  const plan = planDivisionMove(picked, wholeTeams);
  const place = async (userId: string) =>
    unwrap(await setDivisionFn({ data: { eventId, userId, divisionId } }));
  const results = await Promise.allSettled([
    ...(plan.teams.length > 0
      ? [setTeamsDivisionFn({ data: { eventId, teamIds: plan.teams, divisionId } }).then(unwrap)]
      : []),
    ...plan.leave.map(async (userId) => {
      unwrap(await setTeamMembershipFn({ data: { eventId, userId, teamId: null } }));
      await place(userId);
    }),
    ...plan.people.map(place),
  ]);
  return results.filter((result) => result.status === "rejected").length;
}
