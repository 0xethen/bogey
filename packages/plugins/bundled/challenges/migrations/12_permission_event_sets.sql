-- permission_event_sets: the organizer checks ask for the caller's managed events once per statement, not once per row
drop policy ctf_challenges_select on public.ctf_challenges;
create policy ctf_challenges_select on public.ctf_challenges for select to authenticated
  using (event_id = any ((select private.events_where('event.manage'))::uuid[]));

drop policy ctf_hints_select on public.ctf_hints;
create policy ctf_hints_select on public.ctf_hints for select to authenticated
  using (event_id = any ((select private.events_where('event.manage'))::uuid[]));

drop policy ctf_hint_unlocks_select on public.ctf_hint_unlocks;
create policy ctf_hint_unlocks_select on public.ctf_hint_unlocks for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (select private.is_team_member(team_id)));

drop policy ctf_solves_select on public.ctf_solves;
create policy ctf_solves_select on public.ctf_solves for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (select private.is_team_member(team_id)));

drop policy ctf_attempts_select on public.ctf_attempts;
create policy ctf_attempts_select on public.ctf_attempts for select to authenticated
  using (event_id = any ((select private.events_where('event.manage'))::uuid[]));
