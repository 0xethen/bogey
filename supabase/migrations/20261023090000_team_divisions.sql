-- team_divisions: a team's division is the source of truth for its members; organizers set it per team

-- Each team takes its members' most common division (the team's own wins a tie). Teams whose members
-- disagreed are listed as notices; everyone on a team then carries the team's division.
do $$
declare
  r record;
begin
  for r in
    select t.id, t.event_id, t.name, count(distinct m.division_id) as divisions
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
    join public.event_members m on m.event_id = tm.event_id and m.user_id = tm.user_id
    group by t.id
    having count(distinct m.division_id) > 1
      or (count(distinct m.division_id) = 1 and t.division_id is distinct from min(m.division_id::text)::uuid)
  loop
    raise notice 'team % (%) in event %: members were in % divisions', r.name, r.id, r.event_id, r.divisions;
  end loop;
end;
$$;

with counts as (
  select tm.team_id, m.division_id,
    row_number() over (
      partition by tm.team_id
      order by count(*) desc, coalesce(m.division_id = t.division_id, false) desc, m.division_id
    ) as rank
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.event_members m on m.event_id = tm.event_id and m.user_id = tm.user_id
  where m.division_id is not null
  group by tm.team_id, m.division_id, t.division_id
)
update public.teams t set division_id = c.division_id
from counts c
where c.team_id = t.id and c.rank = 1 and t.division_id is distinct from c.division_id;

update public.event_members m set division_id = t.division_id
from public.team_members tm
join public.teams t on t.id = tm.team_id
where m.event_id = tm.event_id and m.user_id = tm.user_id
  and m.division_id is distinct from t.division_id;

create or replace function private.check_team_member()
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

grant execute on function public.set_teams_division(uuid, uuid[], uuid) to authenticated;

-- clone_event copies which divisions each submission form is for
create or replace function public.clone_event(
  p_source uuid, p_slug text, p_name text, p_starts_at timestamptz default null,
  p_include text[] default array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'],
  p_template boolean default false, p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.events;
  v_new public.events;
  v_shift interval;
  v_all constant text[] := array['details', 'windows', 'divisions', 'tracks', 'forms', 'judging',
    'agenda', 'pages', 'homepage', 'settings', 'onboarding', 'invites'];
  v_has boolean;
  r record;
  v_id uuid;
  v_forms jsonb := '{}';
  v_rounds jsonb := '{}';
  v_rubrics jsonb := '{}';
  v_divisions jsonb := '{}';
  v_slots jsonb := '{}';
  v_categories jsonb := '{}';
  v_sessions jsonb := '{}';
  v_reenter text[];
begin
  select * into v_src from public.events where id = p_source;
  if not found or not private.is_org_admin(v_src.org_id) then
    raise exception 'only org admins can copy events' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_include) i where i <> all (v_all)) then
    raise exception 'unknown section' using errcode = '22023';
  end if;
  if 'judging' = any (p_include) and not 'forms' = any (p_include) then
    raise exception 'judging is copied together with forms' using errcode = '22023';
  end if;
  v_shift := case
    when p_template or p_starts_at is null or v_src.starts_at is null then interval '0'
    else p_starts_at - v_src.starts_at
  end;
  if not p_template and p_ends_at is not null
    and p_ends_at <= v_src.starts_at + v_shift then
    raise exception 'the end has to be after the start' using errcode = '22023';
  end if;

  insert into public.events (org_id, slug, name, kind, timezone, starts_at, ends_at, short_name,
    location, website_url, team_size_min, team_size_max, is_template, created_by)
  select v_src.org_id, lower(p_slug), trim(p_name), v_src.kind, v_src.timezone,
    v_src.starts_at + v_shift,
    case when p_ends_at is not null and not p_template then p_ends_at else v_src.ends_at + v_shift end,
    case when 'details' = any (p_include) then v_src.short_name end,
    case when 'details' = any (p_include) then v_src.location end,
    case when 'details' = any (p_include) then v_src.website_url end,
    case when 'details' = any (p_include) then v_src.team_size_min else 1 end,
    case when 'details' = any (p_include) then v_src.team_size_max else 4 end,
    p_template, (select auth.uid())
  returning * into v_new;

  if 'windows' = any (p_include) then
    insert into public.event_windows (event_id, key, opens_at, closes_at, reminder_minutes, updated_by)
    select v_new.id, key, opens_at + v_shift, closes_at + v_shift, reminder_minutes, (select auth.uid())
    from public.event_windows where event_id = p_source;
  end if;

  if 'divisions' = any (p_include) then
    for r in select * from public.divisions where event_id = p_source order by sort, name loop
      insert into public.divisions (event_id, name, description, sort, selectable, switchable)
      values (v_new.id, r.name, r.description, r.sort, r.selectable, r.switchable)
      returning id into v_id;
      v_divisions := v_divisions || jsonb_build_object(r.id::text, v_id);
    end loop;
  end if;

  if 'forms' = any (p_include) then
    for r in select * from public.submission_forms where event_id = p_source order by sort, key loop
      insert into public.submission_forms (event_id, key, title, description_md, window_key, judged, sort)
      values (v_new.id, r.key, r.title, r.description_md, r.window_key, r.judged, r.sort)
      returning id into v_id;
      v_forms := v_forms || jsonb_build_object(r.id::text, v_id);
      insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort)
      select v_new.id, v_id, key, label, help, kind, required, options, config, sort
      from public.submission_items where form_id = r.id;
    end loop;
    insert into public.submission_form_divisions (event_id, form_id, division_id)
    select v_new.id, (v_forms ->> fd.form_id::text)::uuid, (v_divisions ->> fd.division_id::text)::uuid
    from public.submission_form_divisions fd
    where fd.event_id = p_source and v_divisions ? fd.division_id::text;
  end if;

  if 'tracks' = any (p_include) then
    insert into public.tracks (event_id, name, description_md, prize_md, sponsor_name, sponsor_logo_url,
      max_winners, opt_in, form_id, sort)
    select v_new.id, name, description_md, prize_md, sponsor_name, sponsor_logo_url, max_winners, opt_in,
      (v_forms ->> form_id::text)::uuid, sort
    from public.tracks where event_id = p_source;
  end if;

  if 'judging' = any (p_include) then
    for r in select * from public.judging_rounds where event_id = p_source order by form_id, ordinal loop
      insert into public.judging_rounds (event_id, form_id, ordinal, name, window_key)
      values (v_new.id, (v_forms ->> r.form_id::text)::uuid, r.ordinal, r.name, r.window_key)
      on conflict (form_id, ordinal) do update set name = excluded.name, window_key = excluded.window_key
      returning id into v_id;
      v_rounds := v_rounds || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.rubrics where event_id = p_source loop
      insert into public.rubrics (event_id, name, description_md, sort)
      values (v_new.id, r.name, r.description_md, r.sort) returning id into v_id;
      v_rubrics := v_rubrics || jsonb_build_object(r.id::text, v_id);
    end loop;
    insert into public.criteria (
      event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id, guidance)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid, (v_rubrics ->> rubric_id::text)::uuid, guidance
    from public.criteria where event_id = p_source;
    insert into public.rubric_divisions (event_id, rubric_id, division_id)
    select v_new.id, (v_rubrics ->> rd.rubric_id::text)::uuid, (v_divisions ->> rd.division_id::text)::uuid
    from public.rubric_divisions rd
    where rd.event_id = p_source and v_divisions ? rd.division_id::text;
  end if;

  if 'agenda' = any (p_include) then
    for r in select * from public.session_categories where event_id = p_source loop
      insert into public.session_categories (event_id, kind, label, sort)
      values (v_new.id, r.kind, r.label, r.sort) returning id into v_id;
      v_categories := v_categories || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.session_slots where event_id = p_source loop
      insert into public.session_slots (event_id, name, kind, starts_at, ends_at)
      values (v_new.id, r.name, r.kind, r.starts_at + v_shift, r.ends_at + v_shift)
      returning id into v_id;
      v_slots := v_slots || jsonb_build_object(r.id::text, v_id);
    end loop;
    for r in select * from public.event_sessions where event_id = p_source loop
      insert into public.event_sessions (event_id, slot_id, category_id, kind, name, description_md,
        page_md, location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.page_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
        r.host_note, r.capacity, r.required, r.takes_attendance, r.visibility, r.sort)
      returning id into v_id;
      v_sessions := v_sessions || jsonb_build_object(r.id::text, v_id);
    end loop;
    if not p_template then
      for r in
        select distinct h.user_id from public.session_hosts h
        join public.org_members om on om.org_id = v_src.org_id and om.user_id = h.user_id
        where h.event_id = p_source
      loop
        insert into public.event_members (event_id, user_id, role, added_by)
        values (v_new.id, r.user_id, 'staff', (select auth.uid()))
        on conflict do nothing;
      end loop;
      insert into public.session_hosts (event_id, session_id, user_id)
      select v_new.id, (v_sessions ->> h.session_id::text)::uuid, h.user_id
      from public.session_hosts h
      where h.event_id = p_source
        and exists (select 1 from public.event_members m where m.event_id = v_new.id and m.user_id = h.user_id);
    end if;
  end if;

  if 'pages' = any (p_include) then
    insert into public.event_pages (event_id, slug, title, body_md, window_key, audience, sort)
    select v_new.id, slug, title, body_md, window_key, audience, sort
    from public.event_pages where event_id = p_source;
  end if;

  insert into public.settings (scope, event_id, namespace, value, locked_keys, updated_by)
  select 'event', v_new.id, namespace, value, locked_keys, (select auth.uid())
  from public.settings
  where scope = 'event' and event_id = p_source
    and case namespace
      when 'home' then 'homepage' = any (p_include)
      when 'about' then 'details' = any (p_include)
      else 'settings' = any (p_include)
    end;

  if 'onboarding' = any (p_include) then
    insert into public.onboarding_forms (event_id, fields)
    select v_new.id, fields from public.onboarding_forms where event_id = p_source;
  end if;

  if 'invites' = any (p_include) then
    insert into public.invite_links (event_id, label, auto_approve, capacity, division_id, opens_at,
      closes_at, disabled_at, created_by)
    select v_new.id, label, auto_approve, capacity, (v_divisions ->> division_id::text)::uuid,
      opens_at + v_shift, closes_at + v_shift, now(), (select auth.uid())
    from public.invite_links where event_id = p_source;
  end if;

  select coalesce(array_agg(name order by name), '{}') into v_reenter
  from public.secrets where scope = 'event' and event_id = p_source;

  perform private.audit(v_new.id, 'event.cloned', 'event', v_new.id,
    jsonb_build_object('from', p_source, 'template', p_template, 'sections', to_jsonb(p_include)));
  return jsonb_build_object('id', v_new.id, 'slug', v_new.slug, 'reenter', to_jsonb(v_reenter));
end;
$$;
