-- the jury edits CTF challenges too, on its own page (ctf_jury_challenges reads them whole), and
-- the first team to solve a challenge is its first solve

drop function if exists public.ctf_challenges_for_team(uuid);
drop function if exists public.ctf_scoreboard(uuid);

create or replace function public.ctf_save_challenge(p_event uuid, p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_kind text := p_data ->> 'flag_kind';
  v_case boolean := coalesce((p_data ->> 'case_sensitive')::boolean, true);
  v_flag text := p_data ->> 'flag';
  v_hint jsonb;
  v_ordinal smallint := 0;
begin
  if not private.plugin_enabled(p_event, 'challenges')
     or not (private.can_manage(p_event) or private.challenges_is_jury(p_event)) then
    raise exception 'only organizers and the jury can edit challenges' using errcode = '42501';
  end if;
  if v_id is null then
    if v_kind is null then
      raise exception 'a new challenge needs a flag' using errcode = '22023';
    end if;
    insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, visible, sort)
    values (p_event, p_data ->> 'title', coalesce(nullif(p_data ->> 'category', ''), 'misc'),
      coalesce(p_data ->> 'description_md', ''), coalesce(p_data ->> 'scoring', 'static'),
      coalesce((p_data ->> 'points_initial')::integer, 100),
      coalesce((p_data ->> 'points_min')::integer, (p_data ->> 'points_initial')::integer, 100),
      coalesce((p_data ->> 'decay')::integer, 20), coalesce((p_data ->> 'visible')::boolean, true),
      coalesce((select max(sort) + 1 from public.ctf_challenges where event_id = p_event), 0))
    returning id into v_id;
  else
    update public.ctf_challenges set
      title = coalesce(p_data ->> 'title', title),
      category = coalesce(nullif(p_data ->> 'category', ''), category),
      description_md = coalesce(p_data ->> 'description_md', description_md),
      scoring = coalesce(p_data ->> 'scoring', scoring),
      points_initial = coalesce((p_data ->> 'points_initial')::integer, points_initial),
      points_min = coalesce((p_data ->> 'points_min')::integer, points_min),
      decay = coalesce((p_data ->> 'decay')::integer, decay),
      visible = coalesce((p_data ->> 'visible')::boolean, visible)
    where id = v_id and event_id = p_event;
    if not found then
      raise exception 'that challenge is gone' using errcode = 'P0002';
    end if;
  end if;

  if v_kind is not null then
    if v_flag is null or btrim(v_flag) = '' then
      raise exception 'enter the flag' using errcode = '22023';
    end if;
    if v_kind = 'regex' then
      perform '' ~ v_flag;
      insert into public.ctf_flags (challenge_id, flag_kind, flag_regex, case_sensitive)
      values (v_id, 'regex', v_flag, v_case)
      on conflict (challenge_id) do update set flag_kind = 'regex', flag_regex = excluded.flag_regex,
        flag_hash = null, case_sensitive = excluded.case_sensitive;
    elsif v_kind = 'static' then
      insert into public.ctf_flags (challenge_id, flag_kind, flag_hash, case_sensitive)
      values (v_id, 'static', private.ctf_hash(v_id, v_flag, v_case), v_case)
      on conflict (challenge_id) do update set flag_kind = 'static', flag_hash = excluded.flag_hash,
        flag_regex = null, case_sensitive = excluded.case_sensitive;
    else
      raise exception 'flag_kind is static or regex' using errcode = '22023';
    end if;
  end if;

  if p_data ? 'hints' then
    delete from public.ctf_hints where challenge_id = v_id;
    for v_hint in select * from jsonb_array_elements(p_data -> 'hints') loop
      v_ordinal := v_ordinal + 1;
      insert into public.ctf_hints (event_id, challenge_id, ordinal, cost, content_md)
      values (p_event, v_id, v_ordinal, coalesce((v_hint ->> 'cost')::integer, 0), v_hint ->> 'content_md');
    end loop;
  end if;

  perform private.audit(p_event, 'challenges.ctf_challenge_saved', 'ctf_challenge', v_id,
    jsonb_build_object('title', p_data ->> 'title'));
  return v_id;
end;
$$;


create or replace function public.ctf_delete_challenge(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_title text;
begin
  select event_id, title into v_event, v_title from public.ctf_challenges where id = p_id;
  if v_event is null or not private.plugin_enabled(v_event, 'challenges') or not (private.can_manage(v_event) or private.challenges_is_jury(v_event)) then
    raise exception 'only organizers and the jury can delete challenges' using errcode = '42501';
  end if;
  delete from public.ctf_challenges where id = p_id;
  perform private.audit(v_event, 'challenges.ctf_challenge_deleted', 'ctf_challenge', p_id, jsonb_build_object('title', v_title));
end;
$$;


create function public.ctf_challenges_for_team(p_event uuid)
returns table (
  id uuid, title text, category text, description_md text, points integer, solves integer,
  solved boolean, first_solve text, hints jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team uuid := private.my_team(p_event);
  v_manager boolean := private.can_manage(p_event) or private.challenges_is_jury(p_event);
begin
  if not private.plugin_enabled(p_event, 'challenges') then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not v_manager and (v_team is null or not private.window_open(p_event, 'challenges.contest')) then
    raise exception 'the CTF isn''t open' using errcode = '42501';
  end if;
  return query
  select c.id, c.title, c.category, c.description_md, private.ctf_value(c.id),
    (select count(*)::integer from public.ctf_solves s where s.challenge_id = c.id),
    exists (select 1 from public.ctf_solves s where s.challenge_id = c.id and s.team_id = v_team),
    (select t.name from public.ctf_solves s join public.teams t on t.id = s.team_id
     where s.challenge_id = c.id order by s.solved_at limit 1),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordinal', h.ordinal, 'cost', h.cost,
        'content_md', case when u.ordinal is not null or h.cost = 0 or v_manager then h.content_md end)
        order by h.ordinal)
      from public.ctf_hints h
      left join public.ctf_hint_unlocks u on u.challenge_id = h.challenge_id and u.ordinal = h.ordinal and u.team_id = v_team
      where h.challenge_id = c.id), '[]')
  from public.ctf_challenges c
  where c.event_id = p_event and (c.visible or v_manager)
  order by c.category, private.ctf_value(c.id), c.sort;
end;
$$;

revoke execute on function public.ctf_challenges_for_team(uuid) from public, anon;
grant execute on function public.ctf_challenges_for_team(uuid) to authenticated;

create function public.ctf_scoreboard(p_event uuid)
returns table (rank integer, team_name text, score integer, solves integer, first_solves integer, last_solve_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_asof timestamptz;
begin
  if not private.plugin_enabled(p_event, 'challenges') or not private.can_view_event(p_event) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not private.can_manage(p_event) and not private.window_open(p_event, 'challenges.scoreboard') then
    raise exception 'the scoreboard isn''t open' using errcode = '42501';
  end if;
  v_asof := private.ctf_asof(p_event);
  return query
  with solved as (
    select s.team_id, s.solved_at, private.ctf_value(s.challenge_id, v_asof) as points,
      row_number() over (partition by s.challenge_id order by s.solved_at) as place
    from public.ctf_solves s
    where s.event_id = p_event and s.solved_at <= v_asof
  ), won as (
    select team_id, sum(points)::integer as points, count(*)::integer as n,
      count(*) filter (where place = 1)::integer as firsts, max(solved_at) as last_at
    from solved group by team_id
  ), spent as (
    select u.team_id, sum(u.cost)::integer as cost
    from public.ctf_hint_unlocks u
    where u.event_id = p_event and u.unlocked_at <= v_asof group by u.team_id
  )
  select (rank() over (order by w.points - coalesce(sp.cost, 0) desc, w.last_at))::integer,
    case when private.hides_team_names(p_event) then 'Team' else t.name end,
    w.points - coalesce(sp.cost, 0), w.n, w.firsts, w.last_at
  from won w
  join public.teams t on t.id = w.team_id
  left join spent sp on sp.team_id = w.team_id
  order by 1, w.last_at;
end;
$$;

revoke execute on function public.ctf_scoreboard(uuid) from public, anon;
grant execute on function public.ctf_scoreboard(uuid) to authenticated;

-- everything the editor needs, flags aside (they're stored hashed)
create or replace function public.ctf_jury_challenges(p_event uuid)
returns table (
  id uuid, title text, category text, description_md text, scoring text, points_initial integer,
  points_min integer, decay integer, visible boolean, flag_kind text, case_sensitive boolean,
  points integer, solves integer, hints jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.plugin_enabled(p_event, 'challenges')
     or not (private.can_manage(p_event) or private.challenges_is_jury(p_event)) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
  select c.id, c.title, c.category, c.description_md, c.scoring, c.points_initial, c.points_min,
    c.decay, c.visible, f.flag_kind, coalesce(f.case_sensitive, true), private.ctf_value(c.id),
    (select count(*)::integer from public.ctf_solves s where s.challenge_id = c.id),
    coalesce((
      select jsonb_agg(jsonb_build_object('ordinal', h.ordinal, 'cost', h.cost, 'content_md', h.content_md)
        order by h.ordinal)
      from public.ctf_hints h where h.challenge_id = c.id), '[]')
  from public.ctf_challenges c
  left join public.ctf_flags f on f.challenge_id = c.id
  where c.event_id = p_event
  order by c.category, c.sort;
end;
$$;
revoke execute on function public.ctf_jury_challenges(uuid) from public, anon;
grant execute on function public.ctf_jury_challenges(uuid) to authenticated;
