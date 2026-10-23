create table public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  invite_code text not null unique default encode(extensions.gen_random_bytes(5), 'hex'),
  division_id uuid,
  locked_at timestamptz,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name),
  unique (event_id, id),
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete set null (division_id)
);

create trigger teams_touch before update on public.teams
  for each row execute function private.touch_updated_at();

create function private.guard_team_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and (new.event_id, new.invite_code, new.division_id, new.locked_at, new.created_by)
       is distinct from (old.event_id, old.invite_code, old.division_id, old.locked_at, old.created_by) then
    raise exception 'captains can only rename their team' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger teams_guard_update before update on public.teams
  for each row execute function private.guard_team_update();

create table public.team_members (
  event_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  role public.team_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (event_id, user_id),
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_members on delete cascade
);
create index team_members_user_id_idx on public.team_members (user_id);

create function private.check_team_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_max smallint;
  v_member public.event_members;
begin
  select * into v_team from public.teams where id = new.team_id for update;
  select team_size_max into v_max from public.events where id = new.event_id;
  select * into v_member from public.event_members where event_id = new.event_id and user_id = new.user_id;

  if v_member.role <> 'participant' or v_member.status <> 'active' then
    raise exception 'only active participants can be on a team' using errcode = '23514';
  end if;
  if v_team.division_id is not null and v_member.division_id is not null
     and v_team.division_id <> v_member.division_id and not private.can_manage(new.event_id) then
    raise exception 'this team competes in a different division' using errcode = '23514';
  end if;
  if (select count(*) from public.team_members where team_id = new.team_id) >= v_max then
    raise exception 'this team is full' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger team_members_check before insert on public.team_members
  for each row execute function private.check_team_member();

-- A team's division is the source of truth for its members; people without a team keep their own.
create function private.sync_team_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_members m set division_id = new.division_id
  from public.team_members tm
  where tm.team_id = new.id and m.event_id = tm.event_id and m.user_id = tm.user_id
    and m.division_id is distinct from new.division_id;
  return new;
end;
$$;

create trigger teams_sync_division after update of division_id on public.teams
  for each row execute function private.sync_team_division();

-- joining a team takes its division; a team without one takes the first joiner's
create function private.team_member_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_mine uuid;
begin
  select division_id into v_team from public.teams where id = new.team_id;
  select division_id into v_mine from public.event_members
  where event_id = new.event_id and user_id = new.user_id;
  if v_team is null and v_mine is not null then
    update public.teams set division_id = v_mine where id = new.team_id;
  elsif v_team is distinct from v_mine then
    update public.event_members set division_id = v_team
    where event_id = new.event_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger team_members_division after insert on public.team_members
  for each row execute function private.team_member_division();

-- a member on a team always carries the team's division
create function private.keep_team_division()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select t.* into v_team from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.event_id = new.event_id and tm.user_id = new.user_id;
  -- skipped while a deleted division is being cleared from the team too
  if v_team.id is not null and (v_team.division_id is null
     or exists (select 1 from public.divisions where id = v_team.division_id)) then
    new.division_id := v_team.division_id;
  end if;
  return new;
end;
$$;

create trigger event_members_team_division before update of division_id on public.event_members
  for each row execute function private.keep_team_division();

create function private.ensure_solo_team()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
  v_name text;
begin
  if new.role <> 'participant' or new.status <> 'active'
     or (select team_size_max from public.events where id = new.event_id) <> 1
     or exists (select 1 from public.team_members where event_id = new.event_id and user_id = new.user_id) then
    return new;
  end if;

  select display_name into v_name from public.profiles where id = new.user_id;
  v_name := left(v_name, 50);
  if exists (select 1 from public.teams where event_id = new.event_id and name = v_name) then
    v_name := v_name || ' ' || left(new.user_id::text, 6);
  end if;

  insert into public.teams (event_id, name, division_id, created_by)
  values (new.event_id, v_name, new.division_id, new.user_id)
  returning id into v_team;
  insert into public.team_members (event_id, team_id, user_id, role)
  values (new.event_id, v_team, new.user_id, 'captain');
  return new;
end;
$$;

create trigger event_members_solo_team after insert or update of role, status on public.event_members
  for each row execute function private.ensure_solo_team();

create function private.leave_team_on_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'removed' or new.role <> 'participant' then
    delete from public.team_members where event_id = new.event_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

create trigger event_members_leave_team after update of role, status on public.event_members
  for each row execute function private.leave_team_on_removal();

create function private.after_team_member_leaves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.team_members where team_id = old.team_id) then
    delete from public.teams where id = old.team_id;
  elsif old.role = 'captain' then
    update public.team_members set role = 'captain'
    where (team_id, user_id) = (
      select team_id, user_id from public.team_members
      where team_id = old.team_id order by joined_at limit 1
    );
  end if;
  return old;
end;
$$;

create trigger team_members_after_leave after delete on public.team_members
  for each row execute function private.after_team_member_leaves();

create function private.apply_team_hint(p_event uuid, p_user uuid, p_hint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid;
begin
  if exists (select 1 from public.team_members where event_id = p_event and user_id = p_user) then
    return;
  end if;
  select id into v_team from public.teams where event_id = p_event and lower(name) = lower(trim(p_hint));
  if v_team is null then
    insert into public.teams (event_id, name, created_by)
    values (p_event, left(trim(p_hint), 60), p_user)
    returning id into v_team;
  end if;
  begin
    insert into public.team_members (event_id, team_id, user_id, role)
    values (p_event, v_team, p_user,
      case when exists (select 1 from public.team_members where team_id = v_team) then 'member' else 'captain' end::public.team_role);
  exception when check_violation then
    perform private.audit(p_event, 'team.hint_skipped', 'team', v_team,
      jsonb_build_object('user', p_user, 'reason', sqlerrm));
  end;
end;
$$;

create function public.set_team_membership(p_event uuid, p_user uuid, p_team uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from uuid;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can move people between teams' using errcode = '42501';
  end if;
  select team_id into v_from from public.team_members where event_id = p_event and user_id = p_user;
  if v_from is not distinct from p_team then
    return;
  end if;
  delete from public.team_members where event_id = p_event and user_id = p_user;
  if p_team is not null then
    insert into public.team_members (event_id, team_id, user_id, role)
    values (p_event, p_team, p_user,
      case when exists (select 1 from public.team_members where team_id = p_team) then 'member' else 'captain' end::public.team_role);
  end if;
  perform private.audit(p_event, 'team.member_moved', 'team', coalesce(p_team, v_from),
    jsonb_build_object('user', p_user, 'from', v_from, 'to', p_team));
end;
$$;
grant execute on function public.set_team_membership(uuid, uuid, uuid) to authenticated;


create function private.assert_can_change_teams(p_event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'event.compete') then
    raise exception 'only participants can join teams' using errcode = '42501';
  end if;
  perform private.require_network(p_event);
  if not private.check_in_ok(p_event) then
    raise exception 'check in at the desk first' using errcode = 'P0001';
  end if;
  if not private.window_open(p_event, 'teams') then
    raise exception 'teams are locked right now' using errcode = 'P0001';
  end if;
end;
$$;

-- Whether a participant may take themself (or, disbanding, everyone) off their team. Leaving is how people
-- would make team after team or enter twice, so it stops at a locked team, a submitted project, switching
-- turned off, and the event's limit on how often one person leaves; organizers can always move anyone.
create function private.assert_can_break_up(p_event uuid, p_team uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'teams');
  v_limit integer := coalesce((v_settings ->> 'leaveLimit')::integer, 0);
begin
  if (select locked_at from public.teams where id = p_team) is not null then
    raise exception 'this team is locked; ask an organizer' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.submissions where team_id = p_team and status = 'submitted') then
    raise exception 'your team has submitted a project; ask an organizer' using errcode = 'P0001';
  end if;
  if coalesce((v_settings ->> 'switching')::boolean, true) = false then
    raise exception 'switching teams is turned off; ask an organizer' using errcode = 'P0001';
  end if;
  if v_limit > 0 and (
    select teams_left from public.event_members where event_id = p_event and user_id = (select auth.uid())
  ) >= v_limit then
    raise exception 'you''ve left a team as many times as this event allows; ask an organizer'
      using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.assert_can_break_up(uuid, uuid) from anon, authenticated;

-- A captain replaces the invite code, so someone who left (or a code that got around) can't get back in.
create function public.new_team_code(p_event uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
  v_code text;
begin
  perform private.assert_can_change_teams(p_event);
  if v_team is null or not exists (
    select 1 from public.team_members where team_id = v_team and user_id = (select auth.uid()) and role = 'captain'
  ) then
    raise exception 'only your team''s captain can change its code' using errcode = '42501';
  end if;
  if (select locked_at from public.teams where id = v_team) is not null then
    raise exception 'this team is locked' using errcode = 'P0001';
  end if;
  update public.teams set invite_code = encode(extensions.gen_random_bytes(5), 'hex')
  where id = v_team returning invite_code into v_code;
  perform private.audit(p_event, 'team.code_changed', 'team', v_team, '{}');
  return v_code;
end;
$$;

create function public.create_team(p_event uuid, p_name text)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  perform private.assert_can_change_teams(p_event);
  if private.my_team(p_event) is not null then
    raise exception 'you are already on a team' using errcode = 'P0001';
  end if;
  if private.event_setting(p_event, 'teams') ->> 'creation' = 'organizers' then
    raise exception 'organizers set up the teams for this event; join one with its code, or ask an organizer'
      using errcode = '42501';
  end if;

  insert into public.teams (event_id, name, division_id, created_by)
  values (
    p_event, trim(p_name),
    (select division_id from public.event_members where event_id = p_event and user_id = (select auth.uid())),
    (select auth.uid())
  )
  returning * into v_team;
  insert into public.team_members (event_id, team_id, user_id, role)
  values (p_event, v_team.id, (select auth.uid()), 'captain');

  perform private.audit(p_event, 'team.created', 'team', v_team.id, jsonb_build_object('name', v_team.name));
  return v_team;
end;
$$;

create function public.join_team(p_invite_code text)
returns public.teams
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where invite_code = lower(trim(p_invite_code));
  if v_team.id is null then
    raise exception 'no team has that code' using errcode = 'P0002';
  end if;
  perform private.assert_can_change_teams(v_team.event_id);
  if v_team.locked_at is not null then
    raise exception 'this team is locked' using errcode = 'P0001';
  end if;
  if private.my_team(v_team.event_id) is not null then
    raise exception 'leave your current team first' using errcode = 'P0001';
  end if;

  insert into public.team_members (event_id, team_id, user_id)
  values (v_team.event_id, v_team.id, (select auth.uid()));
  perform private.audit(v_team.event_id, 'team.joined', 'team', v_team.id, '{}');
  perform private.notify(
    array(select user_id from public.team_members where team_id = v_team.id and user_id <> (select auth.uid())),
    v_team.event_id, 'team.joined',
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'Someone') || ' joined ' || v_team.name,
    null, '/events/' || (select slug from public.events where id = v_team.event_id) || '/team',
    jsonb_build_object('team', v_team.name,
      'member', coalesce((select display_name from public.profiles where id = (select auth.uid())), 'Someone')));
  return v_team;
end;
$$;

create function public.team_preview(p_invite_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where invite_code = lower(trim(p_invite_code));
  if v_team.id is null or private.event_role(v_team.event_id) is null then
    raise exception 'no team has that code' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', v_team.id,
    'name', v_team.name,
    'locked', v_team.locked_at is not null,
    'size_max', (select team_size_max from public.events where id = v_team.event_id),
    'members', coalesce((
      select jsonb_agg(p.display_name order by tm.role = 'captain' desc, tm.joined_at)
      from public.team_members tm join public.profiles p on p.id = tm.user_id
      where tm.team_id = v_team.id
    ), '[]'::jsonb)
  );
end;
$$;

create function public.leave_team(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_team uuid := private.my_team(p_event);
  v_name text;
begin
  perform private.assert_can_change_teams(p_event);
  if v_team is null then
    return;
  end if;
  if (select team_size_max from public.events where id = p_event) = 1 then
    raise exception 'solo entries can''t be left' using errcode = 'P0001';
  end if;
  perform private.assert_can_break_up(p_event, v_team);
  select name into v_name from public.teams where id = v_team;
  delete from public.team_members where team_id = v_team and user_id = v_uid;
  update public.event_members set teams_left = teams_left + 1 where event_id = p_event and user_id = v_uid;
  perform private.audit(p_event, 'team.left', 'team', v_team, '{}');
  perform private.notify(
    array(select user_id from public.team_members where team_id = v_team),
    p_event, 'team.left',
    coalesce((select display_name from public.profiles where id = v_uid), 'Someone') || ' left ' || v_name,
    null, '/events/' || (select slug from public.events where id = p_event) || '/team',
    jsonb_build_object('team', v_name));
end;
$$;

create function public.disband_team(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
  v_who text := coalesce(private.event_setting(p_event, 'teams') ->> 'disband', 'none');
  v_captain boolean;
begin
  perform private.assert_can_change_teams(p_event);
  if v_team is null then
    return;
  end if;
  if (select team_size_max from public.events where id = p_event) = 1 then
    raise exception 'solo entries can''t be disbanded' using errcode = 'P0001';
  end if;
  select role = 'captain' into v_captain from public.team_members
  where team_id = v_team and user_id = (select auth.uid());
  if v_who = 'none' or (v_who = 'captain' and not v_captain) then
    raise exception 'you can''t disband this team' using errcode = '42501';
  end if;
  perform private.assert_can_break_up(p_event, v_team);
  perform private.audit(p_event, 'team.disbanded', 'team', v_team,
    jsonb_build_object('name', (select name from public.teams where id = v_team)));
  update public.event_members set teams_left = teams_left + 1
  where event_id = p_event and user_id = (select auth.uid());
  delete from public.teams where id = v_team;
end;
$$;

create function private.move_to_division(p_event uuid, p_user uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
begin
  select t.* into v_team from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.event_id = p_event and tm.user_id = p_user;
  if v_team.id is not null and v_team.division_id is distinct from p_division then
    if exists (select 1 from public.team_members where team_id = v_team.id and user_id <> p_user) then
      raise exception 'their team competes in another division; move the team or leave it first'
        using errcode = '23514';
    end if;
    update public.teams set division_id = p_division where id = v_team.id;
  end if;
  update public.event_members set division_id = p_division
  where event_id = p_event and user_id = p_user;
end;
$$;

create function public.choose_division(p_event uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_target public.divisions;
begin
  if not private.has_permission(p_event, 'event.compete') then
    raise exception 'only participants choose a division' using errcode = '42501';
  end if;
  perform private.require_network(p_event);
  select * into v_target from public.divisions where id = p_division and event_id = p_event;
  if v_target.id is null then
    raise exception 'no such division' using errcode = 'P0002';
  end if;
  select division_id into v_current from public.event_members
  where event_id = p_event and user_id = (select auth.uid());
  if v_current is not distinct from p_division then
    return;
  end if;
  if not v_target.selectable then
    raise exception 'organizers place people in %', v_target.name using errcode = '42501';
  end if;
  if v_current is not null and not (select switchable from public.divisions where id = v_current) then
    raise exception 'you can''t switch out of your division; ask an organizer' using errcode = '42501';
  end if;
  perform private.move_to_division(p_event, (select auth.uid()), p_division);
  perform private.audit(p_event, 'division.chosen', 'division', p_division,
    jsonb_build_object('from', v_current));
end;
$$;

-- Moves the caller's whole team (and its members) to another division, within the same rules as
-- choose_division: the target is one participants pick, and nobody is in a division that can't be left.
create function public.choose_team_division(p_event uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_target public.divisions;
begin
  if not private.has_permission(p_event, 'event.compete') then
    raise exception 'only participants choose a division' using errcode = '42501';
  end if;
  perform private.require_network(p_event);
  select t.* into v_team from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where tm.event_id = p_event and tm.user_id = (select auth.uid());
  if v_team.id is null then
    perform public.choose_division(p_event, p_division);
    return;
  end if;
  select * into v_target from public.divisions where id = p_division and event_id = p_event;
  if v_target.id is null then
    raise exception 'no such division' using errcode = 'P0002';
  end if;
  if v_team.division_id is not distinct from p_division then
    return;
  end if;
  if v_team.locked_at is not null then
    raise exception 'your team is locked; ask an organizer' using errcode = '42501';
  end if;
  if not v_target.selectable then
    raise exception 'organizers place teams in %', v_target.name using errcode = '42501';
  end if;
  if exists (
    select 1 from public.divisions d
    where not d.switchable and d.id <> p_division
      and (d.id = v_team.division_id or d.id in (
        select m.division_id from public.event_members m
        join public.team_members tm on tm.user_id = m.user_id and tm.team_id = v_team.id
        where m.event_id = p_event))
  ) then
    raise exception 'your team can''t switch out of its division; ask an organizer' using errcode = '42501';
  end if;
  update public.teams set division_id = p_division where id = v_team.id;
  update public.event_members set division_id = p_division
  where event_id = p_event
    and user_id in (select user_id from public.team_members where team_id = v_team.id);
  perform private.audit(p_event, 'division.chosen', 'division', p_division,
    jsonb_build_object('from', v_team.division_id, 'team', v_team.id));
end;
$$;

create function public.set_division(p_event uuid, p_user uuid, p_division uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers place people in divisions' using errcode = '42501';
  end if;
  if p_division is not null
     and not exists (select 1 from public.divisions where id = p_division and event_id = p_event) then
    raise exception 'no such division' using errcode = 'P0002';
  end if;
  select division_id into v_current from public.event_members
  where event_id = p_event and user_id = p_user;
  if v_current is not distinct from p_division then
    return;
  end if;
  perform private.move_to_division(p_event, p_user, p_division);
  perform private.audit(p_event, 'division.assigned', 'division', p_division,
    jsonb_build_object('user', p_user, 'from', v_current));
end;
$$;

-- Organizers place whole teams in a division (or none); their members follow.
create function public.set_teams_division(p_event uuid, p_teams uuid[], p_division uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_moved integer := 0;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers place teams in divisions' using errcode = '42501';
  end if;
  if cardinality(p_teams) > 1000 then
    raise exception 'send up to 1000 teams' using errcode = '22023';
  end if;
  if p_division is not null
     and not exists (select 1 from public.divisions where id = p_division and event_id = p_event) then
    raise exception 'no such division' using errcode = 'P0002';
  end if;
  for v_team in
    select * from public.teams
    where event_id = p_event and id = any (p_teams) and division_id is distinct from p_division
    for update
  loop
    update public.teams set division_id = p_division where id = v_team.id;
    perform private.audit(p_event, 'division.assigned', 'division', p_division,
      jsonb_build_object('team', v_team.id, 'from', v_team.division_id));
    v_moved := v_moved + 1;
  end loop;
  return v_moved;
end;
$$;

grant execute on function
  public.create_team(uuid, text),
  public.set_teams_division(uuid, uuid[], uuid),
  public.join_team(text),
  public.team_preview(text),
  public.leave_team(uuid),
  public.disband_team(uuid),
  public.new_team_code(uuid),
  public.choose_division(uuid, uuid),
  public.choose_team_division(uuid, uuid),
  public.set_division(uuid, uuid, uuid)
to authenticated;

create index team_members_event_id_team_id_fk_idx on public.team_members (event_id, team_id);
create index teams_event_id_division_id_fk_idx on public.teams (event_id, division_id);
create index teams_created_by_fk_idx on public.teams (created_by);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create function private.hides_team_names(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.event_role(p_event) = 'judge'
      and not private.can_manage(p_event)
      and (private.event_setting(p_event, 'judging') ->> 'blind')::boolean,
    false
  );
$$;
grant execute on function private.hides_team_names(uuid) to anon, authenticated;

create policy teams_select on public.teams for select to anon, authenticated
  using (
    (select private.can_manage(event_id))
    or (
      (select private.has_permission(event_id, 'event.view'))
      and not (select private.hides_team_names(event_id))
    )
    or (
      (select private.is_public_event(event_id))
      and (select private.window_open(event_id, 'gallery'))
      and not (select private.hides_team_names(event_id))
    )
  );
create policy teams_manage_insert on public.teams for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy teams_update on public.teams for update to authenticated
  using (
    ((select private.can_manage(event_id)))
    or
    (
      locked_at is null
      and (select private.window_open(event_id, 'teams'))
      and (select private.network_allowed(event_id))
      and exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid()) and tm.role = 'captain'
      )
    )
  )
  with check (
    ((select private.can_manage(event_id)))
    or
    (
      locked_at is null
      and (select private.window_open(event_id, 'teams'))
      and exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid()) and tm.role = 'captain'
      )
    )
  );
create policy teams_manage_delete on public.teams for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy team_members_select on public.team_members for select to authenticated
  using (
    (select private.is_team_member(team_id))
    or (select private.has_permission(event_id, 'people.view'))
  );
create policy team_members_manage_insert on public.team_members for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy team_members_manage_update on public.team_members for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy team_members_manage_delete on public.team_members for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy event_members_select on public.event_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.has_permission(event_id, 'people.view'))
    or exists (
      select 1 from public.team_members mine
      join public.team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = event_members.user_id
        and mine.event_id = event_members.event_id
    )
  );

alter publication supabase_realtime add table public.team_members;

create function private.team_board_on(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.event_setting(p_event, 'teams') ->> 'board')::boolean, false)
    and exists (select 1 from public.events e where e.id = p_event and e.team_size_max > 1);
$$;

create function private.team_labels(p_labels text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(q.l order by q.o), '{}') from (
    select left(lower(btrim(t.x)), 30) as l, min(t.o) as o
    from unnest(coalesce(p_labels, '{}')) with ordinality as t(x, o)
    where btrim(t.x) <> ''
    group by 1 order by min(t.o) limit 12) q;
$$;

create table public.team_seekers (
  event_id uuid not null,
  user_id uuid not null,
  skills text[] not null default '{}' check (cardinality(skills) <= 12),
  interests text[] not null default '{}' check (cardinality(interests) <= 12),
  timezone text check (length(timezone) <= 60),
  blurb text not null default '' check (length(blurb) <= 500),
  looking boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade
);
create index team_seekers_event_id_looking_idx on public.team_seekers (event_id) where looking;
alter table public.team_seekers enable row level security;
create policy team_seekers_select on public.team_seekers for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage(event_id)));

create table public.team_openings (
  event_id uuid not null,
  team_id uuid not null primary key,
  blurb text not null default '' check (length(blurb) <= 500),
  wanted text[] not null default '{}' check (cardinality(wanted) <= 12),
  open boolean not null default true,
  updated_at timestamptz not null default now(),
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index team_openings_event_id_team_id_fk_idx on public.team_openings (event_id, team_id);
alter table public.team_openings enable row level security;
create policy team_openings_select on public.team_openings for select to authenticated
  using ((select private.event_role(event_id)) is not null);

create table public.team_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  direction text not null check (direction in ('request', 'invite')),
  message text not null default '' check (length(message) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade
);
create unique index team_requests_pending_idx on public.team_requests (team_id, user_id) where status = 'pending';
create index team_requests_event_id_team_id_fk_idx on public.team_requests (event_id, team_id);
create index team_requests_event_id_user_id_fk_idx on public.team_requests (event_id, user_id);
create index team_requests_created_by_fk_idx on public.team_requests (created_by);
alter table public.team_requests enable row level security;
create policy team_requests_select on public.team_requests for select to authenticated
  using ((select private.can_manage(event_id)) or user_id = (select auth.uid()) or (select private.is_team_member(team_id)));

create function private.assert_team_board(p_event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.team_board_on(p_event) or not private.has_permission(p_event, 'event.compete') then
    raise exception 'only participants can use the team board' using errcode = '42501';
  end if;
end;
$$;

create function public.save_team_seeker(
  p_event uuid, p_skills text[], p_interests text[], p_timezone text, p_blurb text, p_looking boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_team_board(p_event);
  insert into public.team_seekers (event_id, user_id, skills, interests, timezone, blurb, looking)
  values (p_event, (select auth.uid()), private.team_labels(p_skills), private.team_labels(p_interests),
    nullif(btrim(p_timezone), ''), coalesce(btrim(p_blurb), ''), coalesce(p_looking, true))
  on conflict (event_id, user_id) do update set skills = excluded.skills, interests = excluded.interests,
    timezone = excluded.timezone, blurb = excluded.blurb, looking = excluded.looking, updated_at = now();
end;
$$;
revoke execute on function public.save_team_seeker(uuid, text[], text[], text, text, boolean) from public, anon;
grant execute on function public.save_team_seeker(uuid, text[], text[], text, text, boolean) to authenticated;

create function public.team_board_people(p_event uuid)
returns table (user_id uuid, display_name text, skills text[], interests text[], timezone text, blurb text, looking boolean, mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.team_board_on(p_event) or private.event_role(p_event) is null then
    raise exception 'the team board is off' using errcode = '42501';
  end if;
  return query
  select t.user_id, p.display_name, t.skills, t.interests, t.timezone, t.blurb, t.looking,
    t.user_id = (select auth.uid())
  from public.team_seekers t
  join public.profiles p on p.id = t.user_id
  join public.event_members m on m.event_id = t.event_id and m.user_id = t.user_id and m.role = 'participant' and m.status = 'active'
  where t.event_id = p_event
    and (t.user_id = (select auth.uid()) or (t.looking
      and not exists (select 1 from public.team_members tm where tm.event_id = p_event and tm.user_id = t.user_id)))
  order by t.updated_at desc;
end;
$$;
revoke execute on function public.team_board_people(uuid) from public, anon;
grant execute on function public.team_board_people(uuid) to authenticated;

create function public.save_team_opening(p_event uuid, p_blurb text, p_wanted text[], p_open boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
begin
  perform private.assert_team_board(p_event);
  if v_team is null then
    raise exception 'join or start a team first' using errcode = '22023';
  end if;
  insert into public.team_openings (event_id, team_id, blurb, wanted, open)
  values (p_event, v_team, coalesce(btrim(p_blurb), ''), private.team_labels(p_wanted), coalesce(p_open, true))
  on conflict (team_id) do update set blurb = excluded.blurb, wanted = excluded.wanted, open = excluded.open, updated_at = now();
end;
$$;
revoke execute on function public.save_team_opening(uuid, text, text[], boolean) from public, anon;
grant execute on function public.save_team_opening(uuid, text, text[], boolean) to authenticated;

create function public.team_board_openings(p_event uuid)
returns table (team_id uuid, team_name text, blurb text, wanted text[], open boolean, members integer, max_members integer, requested boolean, mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_mine uuid := private.my_team(p_event);
begin
  if not private.team_board_on(p_event) or private.event_role(p_event) is null then
    raise exception 'the team board is off' using errcode = '42501';
  end if;
  select e.team_size_max into v_max from public.events e where e.id = p_event;
  return query
  select o.team_id, t.name, o.blurb, o.wanted, o.open,
    (select count(*)::integer from public.team_members tm where tm.team_id = o.team_id), v_max::integer,
    exists (select 1 from public.team_requests r where r.team_id = o.team_id and r.user_id = (select auth.uid()) and r.status = 'pending'),
    o.team_id is not distinct from v_mine
  from public.team_openings o
  join public.teams t on t.id = o.team_id
  where o.event_id = p_event
    and (o.team_id is not distinct from v_mine or (o.open and t.locked_at is null
      and (select count(*) from public.team_members tm where tm.team_id = o.team_id) < v_max))
  order by o.updated_at desc;
end;
$$;
revoke execute on function public.team_board_openings(uuid) from public, anon;
grant execute on function public.team_board_openings(uuid) to authenticated;

create function public.request_to_join_team(p_event uuid, p_team uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_me uuid := (select auth.uid());
begin
  perform private.assert_team_board(p_event);
  if private.my_team(p_event) is not null then
    raise exception 'leave your team first' using errcode = '22023';
  end if;
  if not exists (select 1 from public.team_openings where team_id = p_team and event_id = p_event and open) then
    raise exception 'that team isn''t looking' using errcode = '22023';
  end if;
  insert into public.team_requests (event_id, team_id, user_id, direction, message, created_by)
  values (p_event, p_team, v_me, 'request', left(coalesce(btrim(p_message), ''), 500), v_me)
  returning id into v_id;
  perform private.notify(
    array(select tm.user_id from public.team_members tm where tm.team_id = p_team and tm.role = 'captain'),
    p_event, 'team.request',
    coalesce((select display_name from public.profiles where id = v_me), 'Someone') || ' wants to join your team',
    left(coalesce(btrim(p_message), ''), 500),
    '/events/' || (select slug from public.events where id = p_event) || '/team');
  return v_id;
end;
$$;
revoke execute on function public.request_to_join_team(uuid, uuid, text) from public, anon;
grant execute on function public.request_to_join_team(uuid, uuid, text) to authenticated;

create function public.invite_to_team(p_event uuid, p_user uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
  v_id uuid;
begin
  perform private.assert_team_board(p_event);
  if v_team is null then
    raise exception 'join or start a team first' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.team_seekers t where t.event_id = p_event and t.user_id = p_user and t.looking
      and not exists (select 1 from public.team_members tm where tm.event_id = p_event and tm.user_id = p_user)
  ) then
    raise exception 'that person isn''t looking for a team' using errcode = '22023';
  end if;
  insert into public.team_requests (event_id, team_id, user_id, direction, message, created_by)
  values (p_event, v_team, p_user, 'invite', left(coalesce(btrim(p_message), ''), 500), (select auth.uid()))
  returning id into v_id;
  perform private.notify(array[p_user], p_event, 'team.invited',
    (select t.name from public.teams t where t.id = v_team) || ' invited you to their team',
    left(coalesce(btrim(p_message), ''), 500),
    '/events/' || (select slug from public.events where id = p_event) || '/team');
  return v_id;
end;
$$;
revoke execute on function public.invite_to_team(uuid, uuid, text) from public, anon;
grant execute on function public.invite_to_team(uuid, uuid, text) to authenticated;

create function public.team_requests_inbox(p_event uuid)
returns table (id uuid, direction text, team_id uuid, team_name text, user_id uuid, user_name text, message text, status text, created_at timestamptz, decide boolean, sent boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
begin
  if not private.team_board_on(p_event) or private.event_role(p_event) is null then
    raise exception 'the team board is off' using errcode = '42501';
  end if;
  return query
  select r.id, r.direction, r.team_id, t.name, r.user_id, p.display_name, r.message, r.status, r.created_at,
    r.status = 'pending' and case r.direction
      when 'invite' then r.user_id = v_me
      else exists (select 1 from public.team_members tm where tm.team_id = r.team_id and tm.user_id = v_me and tm.role = 'captain')
    end,
    r.created_by = v_me
  from public.team_requests r
  join public.teams t on t.id = r.team_id
  join public.profiles p on p.id = r.user_id
  where r.event_id = p_event and (r.user_id = v_me or exists (select 1 from public.team_members tm where tm.team_id = r.team_id and tm.user_id = v_me))
  order by r.status = 'pending' desc, r.created_at desc
  limit 100;
end;
$$;
revoke execute on function public.team_requests_inbox(uuid) from public, anon;
grant execute on function public.team_requests_inbox(uuid) to authenticated;

create function public.answer_team_request(p_request uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.team_requests;
  v_me uuid := (select auth.uid());
  v_team public.teams;
begin
  select * into v_req from public.team_requests where id = p_request and status = 'pending';
  if v_req.id is null or not private.team_board_on(v_req.event_id) then
    raise exception 'that request is gone' using errcode = 'P0002';
  end if;
  if not (case v_req.direction
    when 'invite' then v_req.user_id = v_me
    else exists (select 1 from public.team_members tm where tm.team_id = v_req.team_id and tm.user_id = v_me and tm.role = 'captain')
  end) then
    raise exception 'that isn''t yours to answer' using errcode = '42501';
  end if;
  if p_accept then
    perform private.assert_can_change_teams(v_req.event_id);
    select * into v_team from public.teams where id = v_req.team_id;
    if v_team.locked_at is not null then
      raise exception 'this team is locked' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.team_members tm where tm.event_id = v_req.event_id and tm.user_id = v_req.user_id) then
      raise exception 'they are already on a team' using errcode = 'P0001';
    end if;
    insert into public.team_members (event_id, team_id, user_id) values (v_req.event_id, v_req.team_id, v_req.user_id);
    update public.team_requests set status = 'withdrawn', decided_at = now()
    where event_id = v_req.event_id and user_id = v_req.user_id and status = 'pending' and id <> p_request;
    perform private.audit(v_req.event_id, 'team.request_accepted', 'team', v_req.team_id,
      jsonb_build_object('user', v_req.user_id, 'direction', v_req.direction));
  end if;
  update public.team_requests set status = case when p_accept then 'accepted' else 'declined' end, decided_at = now()
  where id = p_request;
  perform private.notify(array[v_req.created_by], v_req.event_id, 'team.answered',
    case when p_accept then
      case v_req.direction when 'invite' then 'Your invitation was accepted' else 'Your request to join was accepted' end
    else
      case v_req.direction when 'invite' then 'Your invitation was declined' else 'Your request to join was declined' end
    end,
    '', '/events/' || (select slug from public.events where id = v_req.event_id) || '/team');
end;
$$;
revoke execute on function public.answer_team_request(uuid, boolean) from public, anon;
grant execute on function public.answer_team_request(uuid, boolean) to authenticated;

create function public.withdraw_team_request(p_request uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.team_requests set status = 'withdrawn', decided_at = now()
  where id = p_request and status = 'pending' and created_by = (select auth.uid());
  if not found then
    raise exception 'that request is gone' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.withdraw_team_request(uuid) from public, anon;
grant execute on function public.withdraw_team_request(uuid) to authenticated;

create function public.team_matching_overview(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can match teams' using errcode = '42501';
  end if;
  select * into v_event from public.events where id = p_event;
  return jsonb_build_object(
    'min', v_event.team_size_min, 'max', v_event.team_size_max,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.user_id, 'name', p.display_name,
        'skills', coalesce(t.skills, '{}'), 'interests', coalesce(t.interests, '{}'), 'timezone', t.timezone,
        'division', m.division_id) order by p.display_name)
      from public.event_members m
      join public.profiles p on p.id = m.user_id
      left join public.team_seekers t on t.event_id = m.event_id and t.user_id = m.user_id
      where m.event_id = p_event and m.role = 'participant' and m.status = 'active'
        and not exists (select 1 from public.team_members tm where tm.event_id = p_event and tm.user_id = m.user_id)), '[]'),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'locked', t.locked_at is not null,
        'division', t.division_id,
        'members', (select count(*) from public.team_members tm where tm.team_id = t.id),
        'skills', coalesce((select array_agg(distinct s) from public.team_members tm
           join public.team_seekers ts on ts.event_id = tm.event_id and ts.user_id = tm.user_id, unnest(ts.skills) s
           where tm.team_id = t.id), '{}')))
      from public.teams t where t.event_id = p_event), '[]'));
end;
$$;
revoke execute on function public.team_matching_overview(uuid) from public, anon;
grant execute on function public.team_matching_overview(uuid) to authenticated;

create function public.apply_team_matching(p_event uuid, p_groups jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group jsonb;
  v_team uuid;
  v_user uuid;
  v_moved integer := 0;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can match teams' using errcode = '42501';
  end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) > 500 then
    raise exception 'send up to 500 groups' using errcode = '22023';
  end if;
  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_team := nullif(v_group ->> 'team', '')::uuid;
    if v_team is null then
      insert into public.teams (event_id, name, created_by)
      values (p_event, left(btrim(v_group ->> 'name'), 60), (select auth.uid()))
      returning id into v_team;
    elsif not exists (select 1 from public.teams where id = v_team and event_id = p_event) then
      raise exception 'that team isn''t in this event' using errcode = '22023';
    end if;
    for v_user in select (jsonb_array_elements_text(v_group -> 'members'))::uuid loop
      perform public.set_team_membership(p_event, v_user, v_team);
      v_moved := v_moved + 1;
    end loop;
  end loop;
  perform private.audit(p_event, 'team.matched', 'event', p_event, jsonb_build_object('people', v_moved));
  return v_moved;
end;
$$;
revoke execute on function public.apply_team_matching(uuid, jsonb) from public, anon;
grant execute on function public.apply_team_matching(uuid, jsonb) to authenticated;
