import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  manageSummaryQueryOptions,
  eventPeopleQueryOptions,
  type EventPeople,
} from "@bogey/db/queries/manage";

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
