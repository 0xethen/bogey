create type public.slot_kind as enum ('everyone', 'choose');
create type public.session_visibility as enum ('everyone', 'staff');
create type public.attendance_method as enum ('roster', 'code');

create table public.session_slots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  name text check (name is null or length(name) between 1 and 80),
  kind public.slot_kind not null default 'everyone',
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, id),
  check (ends_at is null or ends_at > starts_at)
);
create index session_slots_event_idx on public.session_slots (event_id, starts_at);

create trigger session_slots_touch before update on public.session_slots
  for each row execute function private.touch_updated_at();

create table public.session_categories (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  kind text not null default 'session'
    check (kind ~ '^[a-z][a-z0-9_-]{0,39}(\.[a-z][a-z0-9_-]{0,39})?$'),
  label text not null check (length(label) between 1 and 40),
  sort smallint not null default 0,
  unique (event_id, kind, label),
  unique (event_id, id)
);

create table public.event_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  slot_id uuid not null,
  category_id uuid,
  kind text not null default 'session'
    check (kind ~ '^[a-z][a-z0-9_-]{0,39}(\.[a-z][a-z0-9_-]{0,39})?$'),
  name text not null check (length(name) between 1 and 120),
  description_md text not null default '' check (length(description_md) <= 20000),
  location text check (length(location) <= 200),
  starts_at timestamptz,
  ends_at timestamptz,
  host_note text check (length(host_note) <= 200),
  capacity integer check (capacity > 0),
  required boolean not null default false,
  takes_attendance boolean not null default false,
  visibility public.session_visibility not null default 'everyone',
  sort smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, id),
  unique (slot_id, id),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  foreign key (event_id, slot_id) references public.session_slots (event_id, id) on delete cascade,
  foreign key (event_id, category_id) references public.session_categories (event_id, id)
    on delete set null (category_id)
);
create index event_sessions_event_idx on public.event_sessions (event_id);

create trigger event_sessions_touch before update on public.event_sessions
  for each row execute function private.touch_updated_at();

create table public.session_hosts (
  event_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  primary key (session_id, user_id),
  foreign key (event_id, session_id) references public.event_sessions (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_members on delete cascade
);

create table public.session_signups (
  event_id uuid not null,
  slot_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (slot_id, user_id),
  foreign key (slot_id, session_id) references public.event_sessions (slot_id, id)
    on delete cascade on update cascade,
  foreign key (event_id, slot_id) references public.session_slots (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_members on delete cascade
);
create index session_signups_session_idx on public.session_signups (session_id);

create table public.session_attendance (
  event_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  method public.attendance_method not null,
  marked_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_id, user_id),
  foreign key (event_id, session_id) references public.event_sessions (event_id, id) on delete cascade,
  foreign key (event_id, user_id) references public.event_members on delete cascade
);

create table public.session_codes (
  event_id uuid not null,
  session_id uuid primary key,
  code text not null check (code ~ '^[A-Z2-9]{6}$'),
  created_at timestamptz not null default now(),
  unique (event_id, code),
  foreign key (event_id, session_id) references public.event_sessions (event_id, id) on delete cascade
);

create function private.hosts_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.session_hosts
    where session_id = p_session and user_id = (select auth.uid())
  );
$$;

create function private.takes_attendance(p_event uuid, p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission(p_event, 'sessions.attendance') or private.hosts_session(p_session);
$$;

create function private.can_see_session(p_event uuid, p_session uuid, p_visibility public.session_visibility)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.section_open(p_event, 'agenda')
    and (p_visibility = 'everyone' or private.takes_attendance(p_event, p_session));
$$;

create function private.check_session_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
begin
  if tg_op = 'UPDATE' and new.session_id = old.session_id then
    return new;
  end if;
  select capacity into v_capacity from public.event_sessions where id = new.session_id for update;
  if v_capacity is not null
     and (select count(*) from public.session_signups where session_id = new.session_id) >= v_capacity then
    raise exception 'this session is full' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger session_signups_capacity before insert or update of session_id on public.session_signups
  for each row execute function private.check_session_capacity();

create function private.apply_session_picks(p_event uuid, p_user uuid, p_sessions uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
begin
  for v_session in
    select s.id, s.slot_id from public.event_sessions s
    join public.session_slots sl on sl.id = s.slot_id
    where s.event_id = p_event and s.id = any(p_sessions) and sl.kind = 'choose'
  loop
    begin
      insert into public.session_signups (event_id, slot_id, session_id, user_id)
      values (p_event, v_session.slot_id, v_session.id, p_user)
      on conflict (slot_id, user_id) do nothing;
    exception when check_violation then
      perform private.audit(p_event, 'session.pick_skipped', 'session', v_session.id,
        jsonb_build_object('user', p_user, 'reason', sqlerrm));
    end;
  end loop;
end;
$$;

create function public.event_agenda(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member boolean := private.has_permission(p_event, 'event.view');
begin
  if not private.can_view_event(p_event) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if not private.section_open(p_event, 'agenda') then
    return jsonb_build_object('signups_open', false, 'categories', '[]'::jsonb, 'slots', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'signups_open', private.window_open(p_event, 'sessions'),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'label', c.label) order by c.kind, c.sort, c.label)
      from public.session_categories c where c.event_id = p_event
    ), '[]'),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sl.id, 'name', sl.name, 'kind', sl.kind,
        'starts_at', sl.starts_at, 'ends_at', sl.ends_at,
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'kind', s.kind, 'name', s.name, 'description_md', s.description_md,
            'location', s.location, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
            'host_note', s.host_note, 'capacity', s.capacity, 'required', s.required,
            'takes_attendance', s.takes_attendance, 'visibility', s.visibility,
            'category', (select c.label from public.session_categories c where c.id = s.category_id),
            'hosts', coalesce((
              select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.display_name) order by p.display_name)
              from public.session_hosts h join public.profiles p on p.id = h.user_id
              where h.session_id = s.id and v_member
            ), '[]'),
            'taken', (select count(*) from public.session_signups g where g.session_id = s.id),
            'mine', exists (
              select 1 from public.session_signups g where g.session_id = s.id and g.user_id = v_uid
            ),
            'attended', exists (
              select 1 from public.session_attendance a where a.session_id = s.id and a.user_id = v_uid
            ),
            'can_take_attendance', s.takes_attendance and private.takes_attendance(p_event, s.id)
          ) order by coalesce(s.starts_at, sl.starts_at), s.sort, s.name)
          from public.event_sessions s
          where s.slot_id = sl.id and private.can_see_session(p_event, s.id, s.visibility)
        ), '[]')
      ) order by sl.starts_at, sl.name)
      from public.session_slots sl where sl.event_id = p_event
    ), '[]')
  );
end;
$$;

create function public.save_agenda(p_event uuid, p_agenda jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.write_agenda(p_event, p_agenda);
end;
$$;

create function private.write_agenda(p_event uuid, p_agenda jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
  v_slot jsonb;
  v_slot_id uuid;
  v_session jsonb;
  v_session_id uuid;
  v_keep_slots uuid[] := '{}';
  v_keep_sessions uuid[] := '{}';
  v_kind text;
begin
  for v_kind in
    select distinct sess ->> 'kind'
    from jsonb_array_elements(coalesce(p_agenda -> 'slots', '[]')) sl,
      jsonb_array_elements(coalesce(sl -> 'sessions', '[]')) sess
    where (sess ->> 'kind') like '%.%'
  loop
    if not private.plugin_enabled(p_event, split_part(v_kind, '.', 1))
      and not exists (select 1 from public.event_sessions where event_id = p_event and kind = v_kind) then
      raise exception 'turn on the % extension to use its session types', split_part(v_kind, '.', 1)
        using errcode = '22023';
    end if;
  end loop;

  delete from public.session_categories c
  where c.event_id = p_event
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_agenda -> 'categories', '[]')) as l
      where l ->> 'kind' = c.kind and l ->> 'label' = c.label
    );
  insert into public.session_categories (event_id, kind, label, sort)
  select p_event, l.value ->> 'kind', l.value ->> 'label', (l.ordinality - 1)::smallint
  from jsonb_array_elements(coalesce(p_agenda -> 'categories', '[]')) with ordinality as l(value, ordinality)
  on conflict (event_id, kind, label) do update set sort = excluded.sort;

  for v_slot in select * from jsonb_array_elements(coalesce(p_agenda -> 'slots', '[]')) loop
    v_slot_id := coalesce((v_slot ->> 'id')::uuid, gen_random_uuid());
    insert into public.session_slots (id, event_id, name, kind, starts_at, ends_at)
    values (v_slot_id, p_event, nullif(v_slot ->> 'name', ''), (v_slot ->> 'kind')::public.slot_kind,
      (v_slot ->> 'starts_at')::timestamptz, (v_slot ->> 'ends_at')::timestamptz)
    on conflict (id) do update set
      name = excluded.name, kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at
    where public.session_slots.event_id = p_event;
    v_keep_slots := v_keep_slots || v_slot_id;

    for v_session in
      select value from jsonb_array_elements(coalesce(v_slot -> 'sessions', '[]')) with ordinality
      order by ordinality
    loop
      v_session_id := coalesce((v_session ->> 'id')::uuid, gen_random_uuid());
      insert into public.event_sessions (id, event_id, slot_id, category_id, kind, name, description_md,
        location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_session_id, p_event, v_slot_id,
        (select c.id from public.session_categories c
          where c.event_id = p_event and c.kind = coalesce(v_session ->> 'kind', 'session')
            and c.label = v_session ->> 'category'),
        coalesce(v_session ->> 'kind', 'session'), v_session ->> 'name',
        coalesce(v_session ->> 'description_md', ''), nullif(v_session ->> 'location', ''),
        (v_session ->> 'starts_at')::timestamptz, (v_session ->> 'ends_at')::timestamptz,
        nullif(v_session ->> 'host_note', ''), (v_session ->> 'capacity')::integer,
        coalesce((v_session ->> 'required')::boolean, false),
        coalesce((v_session ->> 'takes_attendance')::boolean, false),
        coalesce(v_session ->> 'visibility', 'everyone')::public.session_visibility,
        cardinality(v_keep_sessions)::smallint)
      on conflict (id) do update set
        slot_id = excluded.slot_id, category_id = excluded.category_id, kind = excluded.kind,
        name = excluded.name, description_md = excluded.description_md, location = excluded.location,
        starts_at = excluded.starts_at, ends_at = excluded.ends_at, host_note = excluded.host_note,
        capacity = excluded.capacity, required = excluded.required,
        takes_attendance = excluded.takes_attendance, visibility = excluded.visibility, sort = excluded.sort
      where public.event_sessions.event_id = p_event;
      v_keep_sessions := v_keep_sessions || v_session_id;

      delete from public.session_hosts
      where session_id = v_session_id
        and user_id not in (
          select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_session -> 'hosts', '[]'))
        );
      insert into public.session_hosts (event_id, session_id, user_id)
      select p_event, v_session_id, (value #>> '{}')::uuid
      from jsonb_array_elements(coalesce(v_session -> 'hosts', '[]'))
      on conflict do nothing;
    end loop;
  end loop;

  delete from public.event_sessions where event_id = p_event and id <> all (v_keep_sessions);
  get diagnostics v_removed = row_count;
  delete from public.session_slots where event_id = p_event and id <> all (v_keep_slots);
  delete from public.session_signups g using public.session_slots sl
  where g.slot_id = sl.id and sl.event_id = p_event and sl.kind = 'everyone';

  perform private.audit(p_event, 'sessions.agenda_saved', 'event', p_event, jsonb_build_object(
    'slots', cardinality(v_keep_slots), 'sessions', cardinality(v_keep_sessions), 'removed', v_removed));
  return v_removed;
end;
$$;

create function public.choose_session(p_session uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.event_sessions;
  v_kind public.slot_kind;
begin
  select * into v_session from public.event_sessions where id = p_session;
  if v_session.id is null
     or not private.has_permission(v_session.event_id, 'event.view')
     or not private.can_see_session(v_session.event_id, v_session.id, v_session.visibility) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  perform private.require_network(v_session.event_id);
  select kind into v_kind from public.session_slots where id = v_session.slot_id;
  if v_kind <> 'choose' then
    raise exception 'everyone attends this one; there''s nothing to pick' using errcode = '22023';
  end if;
  if not private.window_open(v_session.event_id, 'sessions') then
    raise exception 'session sign-ups are closed' using errcode = '42501';
  end if;

  insert into public.session_signups (event_id, slot_id, session_id, user_id)
  values (v_session.event_id, v_session.slot_id, v_session.id, v_uid)
  on conflict (slot_id, user_id) do update set session_id = excluded.session_id, created_at = now();
  perform private.audit(v_session.event_id, 'session.signed_up', 'session', v_session.id, '{}');
end;
$$;

create function public.leave_session_slot(p_slot uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_session uuid;
begin
  select event_id, session_id into v_event, v_session
  from public.session_signups where slot_id = p_slot and user_id = (select auth.uid());
  if v_event is null then
    return;
  end if;
  perform private.require_network(v_event);
  if not private.window_open(v_event, 'sessions') then
    raise exception 'session sign-ups are closed' using errcode = '42501';
  end if;
  delete from public.session_signups where slot_id = p_slot and user_id = (select auth.uid());
  perform private.audit(v_event, 'session.left', 'session', v_session, '{}');
end;
$$;

create function public.session_roster(p_session uuid)
returns table (user_id uuid, display_name text, signed_up boolean, attended_at timestamptz,
  method public.attendance_method)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_kind public.slot_kind;
begin
  select s.event_id, sl.kind into v_event, v_kind
  from public.event_sessions s join public.session_slots sl on sl.id = s.slot_id
  where s.id = p_session;
  if v_event is null or not private.takes_attendance(v_event, p_session) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with expected as (
    select g.user_id, true as signed_up from public.session_signups g where g.session_id = p_session
    union
    select m.user_id, false from public.event_members m
    where v_kind = 'everyone' and m.event_id = v_event and m.role = 'participant' and m.status = 'active'
    union
    select a.user_id, false from public.session_attendance a where a.session_id = p_session
  )
  select e.user_id, p.display_name, bool_or(e.signed_up), a.created_at, a.method
  from expected e
  join public.profiles p on p.id = e.user_id
  left join public.session_attendance a on a.session_id = p_session and a.user_id = e.user_id
  group by e.user_id, p.display_name, a.created_at, a.method
  order by p.display_name;
end;
$$;

create function public.set_attendance(p_session uuid, p_user uuid, p_attended boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.event_sessions where id = p_session;
  if v_event is null or not private.takes_attendance(v_event, p_session) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_attended then
    insert into public.session_attendance (event_id, session_id, user_id, method, marked_by)
    values (v_event, p_session, p_user, 'roster', (select auth.uid()))
    on conflict do nothing;
  else
    delete from public.session_attendance where session_id = p_session and user_id = p_user;
  end if;
  perform private.audit(v_event, 'session.attendance_marked', 'session', p_session,
    jsonb_build_object('user', p_user, 'attended', p_attended));
end;
$$;

create function public.session_code(p_session uuid, p_rotate boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_code text;
begin
  select event_id into v_event from public.event_sessions where id = p_session and takes_attendance;
  if v_event is null or not private.takes_attendance(v_event, p_session) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not p_rotate then
    select code into v_code from public.session_codes where session_id = p_session;
    if v_code is not null then
      return v_code;
    end if;
  end if;
  loop
    select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::integer, 1), '')
    into v_code from generate_series(1, 6);
    begin
      insert into public.session_codes (event_id, session_id, code) values (v_event, p_session, v_code)
      on conflict (session_id) do update set code = excluded.code, created_at = now();
      exit;
    exception when unique_violation then
    end;
  end loop;
  if p_rotate then
    perform private.audit(v_event, 'session.code_rotated', 'session', p_session, '{}');
  end if;
  return v_code;
end;
$$;

create function public.check_in_session(p_event uuid, p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session public.event_sessions;
  v_starts timestamptz;
  v_ends timestamptz;
  v_picked uuid;
begin
  if not private.has_permission(p_event, 'event.view') then
    raise exception 'not a member of this event' using errcode = '42501';
  end if;
  perform private.require_network(p_event);
  select s.* into v_session
  from public.session_codes c join public.event_sessions s on s.id = c.session_id
  where c.event_id = p_event and c.code = upper(trim(p_code)) and s.takes_attendance;
  if v_session.id is null then
    raise exception 'that code doesn''t match a session' using errcode = 'P0002';
  end if;

  select coalesce(v_session.starts_at, sl.starts_at), coalesce(v_session.ends_at, sl.ends_at)
  into v_starts, v_ends from public.session_slots sl where sl.id = v_session.slot_id;
  if now() < v_starts - interval '30 minutes' or now() > coalesce(v_ends, v_starts + interval '2 hours') + interval '30 minutes' then
    raise exception 'check-in for % is closed', v_session.name using errcode = '42501';
  end if;

  select session_id into v_picked from public.session_signups
  where slot_id = v_session.slot_id and user_id = v_uid;
  if v_picked is not null and v_picked <> v_session.id then
    raise exception 'you signed up for a different session at this time' using errcode = '22023';
  end if;

  insert into public.session_attendance (event_id, session_id, user_id, method, marked_by)
  values (p_event, v_session.id, v_uid, 'code', v_uid)
  on conflict do nothing;
  perform private.audit(p_event, 'session.checked_in', 'session', v_session.id, '{}');
  return v_session.name;
end;
$$;

create function public.event_attendance(p_event uuid)
returns table (user_id uuid, display_name text, session_id uuid, expected boolean, attended_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'sessions.attendance') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  with expected as (
    select m.user_id, s.id as session_id
    from public.event_members m
    join public.event_sessions s on s.event_id = m.event_id and s.required and s.takes_attendance
    where m.event_id = p_event and m.role = 'participant' and m.status = 'active'
    union
    select g.user_id, g.session_id
    from public.session_signups g join public.event_sessions s on s.id = g.session_id
    where g.event_id = p_event and s.takes_attendance
  ),
  rows as (
    select e.user_id, e.session_id, true as expected from expected e
    union all
    select a.user_id, a.session_id, false from public.session_attendance a
    where a.event_id = p_event
      and not exists (select 1 from expected e where e.user_id = a.user_id and e.session_id = a.session_id)
  )
  select r.user_id, p.display_name, r.session_id, r.expected, a.created_at
  from rows r
  join public.profiles p on p.id = r.user_id
  left join public.session_attendance a on a.session_id = r.session_id and a.user_id = r.user_id
  order by p.display_name;
end;
$$;

grant execute on function
  public.event_agenda(uuid),
  public.save_agenda(uuid, jsonb),
  public.choose_session(uuid),
  public.leave_session_slot(uuid),
  public.session_roster(uuid),
  public.set_attendance(uuid, uuid, boolean),
  public.session_code(uuid, boolean),
  public.check_in_session(uuid, text),
  public.event_attendance(uuid)
to authenticated;
grant execute on function public.event_agenda(uuid) to anon;

create index event_sessions_event_id_slot_id_fk_idx on public.event_sessions (event_id, slot_id);
create index event_sessions_event_id_category_id_fk_idx on public.event_sessions (event_id, category_id);
create index session_hosts_event_id_session_id_fk_idx on public.session_hosts (event_id, session_id);
create index session_hosts_event_id_user_id_fk_idx on public.session_hosts (event_id, user_id);
create index session_signups_slot_id_session_id_fk_idx on public.session_signups (slot_id, session_id);
create index session_signups_event_id_slot_id_fk_idx on public.session_signups (event_id, slot_id);
create index session_signups_event_id_user_id_fk_idx on public.session_signups (event_id, user_id);
create index session_attendance_event_id_session_id_fk_idx on public.session_attendance (event_id, session_id);
create index session_attendance_event_id_user_id_fk_idx on public.session_attendance (event_id, user_id);
create index session_attendance_marked_by_fk_idx on public.session_attendance (marked_by);
create index session_codes_event_id_session_id_fk_idx on public.session_codes (event_id, session_id);

grant execute on function private.can_see_session(uuid, uuid, public.session_visibility) to anon, authenticated;
grant execute on function private.takes_attendance(uuid, uuid) to authenticated;

alter table public.session_slots enable row level security;
alter table public.session_categories enable row level security;
alter table public.event_sessions enable row level security;
alter table public.session_hosts enable row level security;
alter table public.session_signups enable row level security;
alter table public.session_attendance enable row level security;
alter table public.session_codes enable row level security;

create policy session_slots_select on public.session_slots for select to anon, authenticated
  using ((select private.section_open(event_id, 'agenda')));
create policy session_categories_select on public.session_categories for select to anon, authenticated
  using ((select private.section_open(event_id, 'agenda')));
create policy event_sessions_select on public.event_sessions for select to anon, authenticated
  using ((select private.can_see_session(event_id, id, visibility)));
create policy session_hosts_select on public.session_hosts for select to authenticated
  using ((select private.has_permission(event_id, 'event.view')));
create policy session_signups_select on public.session_signups for select to authenticated
  using (user_id = (select auth.uid()) or (select private.takes_attendance(event_id, session_id)));
create policy session_attendance_select on public.session_attendance for select to authenticated
  using (user_id = (select auth.uid()) or (select private.takes_attendance(event_id, session_id)));
