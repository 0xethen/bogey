-- division_choices: divisions participants see while they can't pick them (divisions.visible), and a
-- team's division stays the choice of the teammate who made it (teams.division_chosen_by)

alter table public.divisions add column visible boolean not null default false;
alter table public.teams add column division_chosen_by uuid references public.profiles on delete set null;
create index teams_division_chosen_by_fk_idx on public.teams (division_chosen_by);

create or replace function private.guard_team_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and (new.event_id, new.invite_code, new.division_id, new.division_chosen_by, new.locked_at, new.created_by)
       is distinct from (old.event_id, old.invite_code, old.division_id, old.division_chosen_by, old.locked_at, old.created_by) then
    raise exception 'captains can only rename their team' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.choose_division(p_event uuid, p_division uuid)
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
  perform private.require_network(p_event, 'teams');
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
  -- a solo team's choice is the team's
  update public.teams t set division_chosen_by = (select auth.uid())
  from public.team_members tm
  where tm.team_id = t.id and tm.event_id = p_event and tm.user_id = (select auth.uid());
  perform private.audit(p_event, 'division.chosen', 'division', p_division,
    jsonb_build_object('from', v_current));
end;
$$;

create or replace function public.choose_team_division(p_event uuid, p_division uuid)
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
  perform private.require_network(p_event, 'teams');
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
  if v_team.division_chosen_by is distinct from (select auth.uid()) and exists (
    select 1 from public.team_members where team_id = v_team.id and user_id = v_team.division_chosen_by
  ) then
    raise exception 'a teammate already chose your team''s division; ask them or an organizer'
      using errcode = '42501';
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
  update public.teams set division_id = p_division, division_chosen_by = (select auth.uid())
  where id = v_team.id;
  update public.event_members set division_id = p_division
  where event_id = p_event
    and user_id in (select user_id from public.team_members where team_id = v_team.id);
  perform private.audit(p_event, 'division.chosen', 'division', p_division,
    jsonb_build_object('from', v_team.division_id, 'team', v_team.id));
end;
$$;

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
      insert into public.divisions (event_id, name, description, sort, selectable, switchable, visible)
      values (v_new.id, r.name, r.description, r.sort, r.selectable, r.switchable, r.visible)
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
      insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort,
        division_ids, tag_ids)
      select v_new.id, v_id, key, label, help, kind, required, options, config, sort,
        array(select (v_divisions ->> d::text)::uuid from unnest(division_ids) d where v_divisions ? d::text),
        tag_ids
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
    -- divisions follow to their copies; the audience trigger drops whatever doesn't exist here
    insert into public.onboarding_forms (event_id, fields)
    select v_new.id, coalesce((
      select jsonb_agg(case when jsonb_typeof(q -> 'divisionIds') = 'array'
        then jsonb_set(q, '{divisionIds}', coalesce((
          select jsonb_agg(v_divisions -> d) from jsonb_array_elements_text(q -> 'divisionIds') d
          where v_divisions ? d), '[]'))
        else q end order by n)
      from jsonb_array_elements(f.fields) with ordinality as x(q, n)), '[]')
    from public.onboarding_forms f where f.event_id = p_source;
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
