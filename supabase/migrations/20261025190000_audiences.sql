-- audiences: registration questions and submission items can be for chosen divisions and tags only

-- An item with neither reaches everyone; otherwise teams in one of the divisions, or with a member
-- holding one of the tags.
alter table public.submission_items
  add column division_ids uuid[] not null default '{}' check (cardinality(division_ids) <= 50),
  add column tag_ids uuid[] not null default '{}' check (cardinality(tag_ids) <= 50);

create function private.uuid_list(p_ids jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct v::uuid), '{}')
  from jsonb_array_elements_text(case when jsonb_typeof(p_ids) = 'array' then p_ids else '[]' end) v
  where v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- empty divisions and tags mean everyone; otherwise either one is enough
create function private.audience_reaches(p_divisions uuid[], p_tags uuid[], p_division uuid, p_held uuid[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (cardinality(p_divisions) = 0 and cardinality(p_tags) = 0)
      or p_division = any (p_divisions)
      or coalesce(p_held, '{}') && p_tags,
    false);
$$;

create function private.known_divisions(p_event uuid, p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(d.id order by d.sort, d.name), '{}')
  from public.divisions d
  where d.event_id = p_event and d.id = any (p_ids);
$$;

-- the org's tags and the event's own
create function private.known_tags(p_event uuid, p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id order by t.sort, t.name), '{}')
  from public.tags t
  where t.org_id = private.event_org(p_event)
    and (t.event_id is null or t.event_id = p_event)
    and t.id = any (p_ids);
$$;

create function private.with_audience(p_question jsonb, p_divisions uuid[], p_tags uuid[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select (p_question - 'divisionIds' - 'tagIds')
    || case when cardinality(p_divisions) > 0
      then jsonb_build_object('divisionIds', to_jsonb(p_divisions)) else '{}' end
    || case when cardinality(p_tags) > 0 then jsonb_build_object('tagIds', to_jsonb(p_tags)) else '{}' end;
$$;

-- the questions someone in this division with these tags is asked
create function private.fields_for(p_fields jsonb, p_division uuid, p_held uuid[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(q order by n), '[]')
  from jsonb_array_elements(coalesce(p_fields, '[]')) with ordinality as x(q, n)
  where private.audience_reaches(
    private.uuid_list(q -> 'divisionIds'), private.uuid_list(q -> 'tagIds'), p_division, p_held);
$$;

-- a registrant's division: their membership's, else their registration's
create function private.registrant_division(p_event uuid, p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select m.division_id from public.event_members m where m.event_id = p_event and m.user_id = p_user),
    (select r.division_id from public.registrations r
      where r.event_id = p_event
        and (r.user_id = p_user
          or lower(r.email::text) = (select lower(u.email::text) from auth.users u where u.id = p_user))
      order by r.user_id is not distinct from p_user desc
      limit 1));
$$;

-- every tag a team's members hold in its event
create function private.team_tags(p_team uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct held), '{}')
  from public.team_members tm
  cross join lateral unnest(private.held_tags(tm.event_id, tm.user_id)) held
  where tm.team_id = p_team;
$$;
revoke execute on function private.registrant_division(uuid, uuid) from anon, authenticated;
revoke execute on function private.team_tags(uuid) from anon, authenticated;

-- Saved audiences keep only divisions and tags that exist here, so deleting one drops it from them.
create function private.clean_onboarding_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.fields) is distinct from 'array' then
    return new;
  end if;
  select coalesce(jsonb_agg(
    case when jsonb_typeof(q) = 'object' then private.with_audience(q,
      private.known_divisions(new.event_id, private.uuid_list(q -> 'divisionIds')),
      private.known_tags(new.event_id, private.uuid_list(q -> 'tagIds')))
    else q end order by n), '[]')
  into new.fields
  from jsonb_array_elements(new.fields) with ordinality as x(q, n);
  return new;
end;
$$;
create trigger onboarding_forms_audience before insert or update of fields on public.onboarding_forms
  for each row execute function private.clean_onboarding_audience();

create function private.clean_item_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.division_ids := private.known_divisions(new.event_id, new.division_ids);
  new.tag_ids := private.known_tags(new.event_id, new.tag_ids);
  return new;
end;
$$;
create trigger submission_items_audience before insert or update of division_ids, tag_ids
  on public.submission_items
  for each row execute function private.clean_item_audience();

create function private.forget_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'divisions' then
    update public.submission_items set division_ids = division_ids
    where event_id = old.event_id and old.id = any (division_ids);
    update public.onboarding_forms set fields = fields
    where event_id = old.event_id
      and jsonb_path_exists(fields, '$[*].divisionIds[*] ? (@ == $id)', jsonb_build_object('id', old.id));
  else
    update public.submission_items set tag_ids = tag_ids where old.id = any (tag_ids);
    update public.onboarding_forms set fields = fields
    where jsonb_path_exists(fields, '$[*].tagIds[*] ? (@ == $id)', jsonb_build_object('id', old.id));
  end if;
  return null;
end;
$$;
create trigger divisions_forget_audience after delete on public.divisions
  for each row execute function private.forget_audience();
create trigger tags_forget_audience after delete on public.tags
  for each row execute function private.forget_audience();

-- the registration questions the caller is asked
create function public.my_onboarding_form(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.can_view_event(p_event) then private.fields_for(
    (select f.fields from public.onboarding_forms f where f.event_id = p_event),
    private.registrant_division(p_event, (select auth.uid())),
    private.held_tags(p_event, (select auth.uid())))
  else '[]' end;
$$;
grant execute on function public.my_onboarding_form(uuid) to authenticated;

-- the tags that count for submission items: a team's members', or the caller's own without a team
create function public.audience_tags(p_event uuid, p_team uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_team is not null
      and exists (select 1 from public.teams t where t.id = p_team and t.event_id = p_event)
      and (private.is_team_member(p_team) or private.can_manage(p_event))
      then private.team_tags(p_team)
    else private.held_tags(p_event, (select auth.uid()))
  end;
$$;
grant execute on function public.audience_tags(uuid, uuid) to authenticated;

create or replace function private.submission_problems(p_submission uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when s.title = '' then 'Title' end,
    case when (select count(*) from public.team_members tm where tm.team_id = s.team_id) < e.team_size_min
      then format('At least %s team members', e.team_size_min) end
  ], null) || coalesce((
    select array_agg(i.label order by i.sort)
    from public.submission_items i
    where i.form_id = s.form_id and i.required and i.kind <> 'file'
      and private.audience_reaches(i.division_ids, i.tag_ids, team.division_id, team.tags)
      and coalesce(s.answers ->> i.key, '') in ('', 'false')
  ), '{}') || coalesce((
    select array_agg(i.label order by i.sort)
    from public.submission_items i
    where i.form_id = s.form_id and i.required and i.kind = 'file'
      and private.audience_reaches(i.division_ids, i.tag_ids, team.division_id, team.tags)
      and not exists (
        select 1 from public.submission_files sf where sf.submission_id = s.id and sf.item_key = i.key
      )
  ), '{}')
  from public.submissions s
  join public.events e on e.id = s.event_id
  left join lateral (
    select t.division_id, private.team_tags(t.id) as tags from public.teams t where t.id = s.team_id
  ) team on true
  where s.id = p_submission;
$$;

create or replace function public.register_for_event(
  p_event uuid, p_answers jsonb default '{}', p_token text default null, p_full_name text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email extensions.citext;
  v_link public.invite_links;
  v_form public.onboarding_forms;
  v_mode text := private.event_setting(p_event, 'registration') ->> 'mode';
  v_status public.registration_status;
  v_answers jsonb;
  v_row public.registrations;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;

  if p_token is not null then
    select * into v_link from public.invite_links where token = p_token and event_id = p_event;
    if v_link.id is null or not (select is_open from public.invite_link_view(p_token)) then
      raise exception 'this invite link is closed' using errcode = 'P0001';
    end if;
    v_status := case when v_link.auto_approve then 'approved' else 'pending' end;
  else
    if not private.can_view_event(p_event) or not private.window_open(p_event, 'registration') then
      raise exception 'registration is closed' using errcode = 'P0001';
    end if;
    if v_mode = 'invite' then
      raise exception 'this event is invite-only' using errcode = 'P0001';
    end if;
    v_status := case when v_mode = 'open' then 'approved' else 'pending' end;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text, 0));
  if private.event_full(p_event) and not exists (
    select 1 from public.registrations where event_id = p_event and email = v_email and status = 'approved'
  ) then
    v_status := 'waitlisted';
  end if;

  select * into v_form from public.onboarding_forms where event_id = p_event;
  v_answers := private.clean_registration_answers(p_event,
    private.fields_for(v_form.fields,
      coalesce(private.registrant_division(p_event, v_uid), v_link.division_id),
      private.held_tags(p_event, v_uid)),
    p_answers, v_uid);

  insert into public.registrations (
    event_id, email, full_name, user_id, source, invite_link_id, division_id,
    answers, form_version, status
  )
  values (
    p_event, v_email, p_full_name, v_uid,
    (case when v_link.id is null then 'self' else 'link' end)::public.registration_source,
    v_link.id, v_link.division_id, v_answers, v_form.version, v_status
  )
  on conflict (event_id, email) do update set
    answers = excluded.answers,
    form_version = excluded.form_version,
    status = case
      when public.registrations.status in ('rejected', 'approved') then public.registrations.status
      else excluded.status
    end
  returning * into v_row;

  return v_row;
end;
$$;


create or replace function public.invite_link_view(p_token text)
returns table (
  event_id uuid, event_name text, event_slug extensions.citext, org_name text,
  label text, is_open boolean, form jsonb, starts_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.slug, o.name, l.label,
    l.disabled_at is null
      and (l.opens_at is null or l.opens_at <= now())
      and (l.closes_at is null or now() < l.closes_at)
      and (l.capacity is null or (
        select count(*) from public.registrations r where r.invite_link_id = l.id
      ) < l.capacity),
    private.fields_for(f.fields,
      coalesce(private.registrant_division(e.id, (select auth.uid())), l.division_id),
      private.held_tags(e.id, (select auth.uid()))),
    (e.starts_at at time zone e.timezone)::date
  from public.invite_links l
  join public.events e on e.id = l.event_id
  join public.orgs o on o.id = e.org_id
  left join public.onboarding_forms f on f.event_id = e.id
  where l.token = p_token and e.visibility <> 'draft' and o.status <> 'suspended';
$$;


create or replace function public.check_in_walk_in(
  p_event uuid, p_email text, p_name text default '', p_answers jsonb default '{}',
  p_check_in boolean default true
)
returns table (registered boolean, checked_in boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
  v_fields jsonb;
begin
  if not private.has_permission(p_event, 'people.checkin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not coalesce((private.event_setting(p_event, 'checkin') ->> 'allowWalkIns')::boolean, false) then
    raise exception 'this event doesn''t take walk-ins' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that isn''t an email address' using errcode = '22023';
  end if;

  select fields into v_fields from public.onboarding_forms where event_id = p_event;
  insert into public.registrations (event_id, email, full_name, source, role, status, reviewed_by, reviewed_at, answers)
  values (p_event, v_email, nullif(btrim(p_name), ''), 'import', 'participant', 'approved', (select auth.uid()), now(),
    case when p_answers = '{}'::jsonb then '{}'::jsonb
      else private.clean_registration_answers(p_event, private.fields_for(v_fields, null, '{}'), p_answers, (select auth.uid())) end)
  on conflict (event_id, email) do update set status = 'approved',
    answers = case when p_answers = '{}'::jsonb then public.registrations.answers else excluded.answers end
    where public.registrations.status in ('pending', 'rejected', 'withdrawn', 'waitlisted')
      or p_answers <> '{}'::jsonb;
  perform private.audit(p_event, 'checkin.walk_in', 'registration', null, '{}');

  select u.id into v_user from auth.users u where lower(u.email) = v_email;
  if p_check_in and v_user is not null and exists (
    select 1 from public.event_members m where m.event_id = p_event and m.user_id = v_user and m.status = 'active'
  ) then
    perform public.check_in(p_event, v_user, null, 'desk');
    return query select true, true;
    return;
  end if;
  return query select true, false;
end;
$$;


create or replace function public.save_submission_form(p_event uuid, p_form jsonb, p_items jsonb)
returns public.submission_forms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.submission_forms;
  v_id uuid := nullif(p_form ->> 'id', '')::uuid;
  v_kind text;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can edit submission forms' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.submission_forms (event_id, key, title, description_md, window_key, judged, sort)
    values (p_event, p_form ->> 'key', p_form ->> 'title', coalesce(p_form ->> 'description_md', ''),
      coalesce(p_form ->> 'window_key', 'submissions'), coalesce((p_form ->> 'judged')::boolean, true),
      coalesce((select max(sort) + 1 from public.submission_forms where event_id = p_event), 0))
    returning * into v_form;
  else
    update public.submission_forms set
      title = p_form ->> 'title',
      description_md = coalesce(p_form ->> 'description_md', ''),
      window_key = coalesce(p_form ->> 'window_key', window_key),
      judged = coalesce((p_form ->> 'judged')::boolean, judged)
    where id = v_id and event_id = p_event
    returning * into v_form;
    if v_form.id is null then
      raise exception 'that form is gone' using errcode = 'P0002';
    end if;
  end if;

  if jsonb_typeof(p_form -> 'division_ids') = 'array' then
    delete from public.submission_form_divisions
    where form_id = v_form.id
      and division_id::text not in (select jsonb_array_elements_text(p_form -> 'division_ids'));
    insert into public.submission_form_divisions (event_id, form_id, division_id)
    select p_event, v_form.id, d.id
    from public.divisions d
    where d.event_id = p_event
      and d.id::text in (select jsonb_array_elements_text(p_form -> 'division_ids'))
    on conflict do nothing;
  end if;

  for v_kind in
    select distinct item ->> 'kind' from jsonb_array_elements(p_items) item
    where (item ->> 'kind') like '%.%'
  loop
    if not private.plugin_enabled(p_event, split_part(v_kind, '.', 1)) then
      raise exception 'turn on the % extension to use its item types', split_part(v_kind, '.', 1)
        using errcode = '22023';
    end if;
  end loop;

  delete from public.submission_items
  where form_id = v_form.id
    and key not in (select item ->> 'key' from jsonb_array_elements(p_items) item);

  insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort,
    division_ids, tag_ids)
  select p_event, v_form.id, item ->> 'key', item ->> 'label', nullif(item ->> 'help', ''),
    item ->> 'kind', coalesce((item ->> 'required')::boolean, false),
    case when jsonb_typeof(item -> 'options') = 'array' then item -> 'options' end,
    coalesce(item -> 'config', '{}'), (ordinality - 1)::smallint,
    private.uuid_list(item -> 'division_ids'), private.uuid_list(item -> 'tag_ids')
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (form_id, key) do update set
    label = excluded.label, help = excluded.help, kind = excluded.kind, required = excluded.required,
    options = excluded.options, config = excluded.config, sort = excluded.sort,
    division_ids = excluded.division_ids, tag_ids = excluded.tag_ids;

  perform private.audit(p_event, 'form.saved', 'submission_form', v_form.id,
    jsonb_build_object('title', v_form.title, 'items', jsonb_array_length(p_items)));
  return v_form;
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

