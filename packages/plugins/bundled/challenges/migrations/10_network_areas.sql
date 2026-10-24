-- network_areas: an event's network limit can apply to the contest ("challenges.contest")
create function private.challenges_require_network()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.require_network(new.event_id, 'challenges.contest');
  return new;
end;
$$;

create trigger challenges_solutions_network before insert on public.challenges_solutions
  for each row execute function private.challenges_require_network();

create or replace function private.ctf_assert_player(p_event uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
begin
  if not private.plugin_enabled(p_event, 'challenges') or not private.has_permission(p_event, 'event.compete') or v_team is null then
    raise exception 'join a team to play' using errcode = '42501';
  end if;
  if not private.window_open(p_event, 'challenges.contest') then
    raise exception 'the CTF isn''t open' using errcode = '42501';
  end if;
  perform private.require_network(p_event, 'challenges.contest');
  return v_team;
end;
$$;
