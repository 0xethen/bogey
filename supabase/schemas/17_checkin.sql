create table public.checkins (
  event_id uuid not null,
  user_id uuid not null,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.profiles on delete set null,
  method text not null check (method in ('desk', 'qr', 'self', 'import')),
  checked_out_at timestamptz,
  note text not null default '' check (length(note) <= 200),
  primary key (event_id, user_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade
);
create index checkins_event_in_idx on public.checkins (event_id, checked_in_at desc);
create index checkins_checked_in_by_fk_idx on public.checkins (checked_in_by);

create table public.member_codes (
  event_id uuid not null,
  user_id uuid not null,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  primary key (event_id, user_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade
);

create table public.badge_emails (
  event_id uuid not null,
  user_id uuid not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade
);

alter table public.checkins enable row level security;
alter table public.member_codes enable row level security;
alter table public.badge_emails enable row level security;

-- people.checkin and sessions.attendance come from checkin.takers (private.holds_permission)

create policy checkins_select on public.checkins for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('people.checkin'))::uuid[])));

create function private.checked_in(p_event uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.checkins where event_id = p_event and user_id = p_user and checked_out_at is null);
$$;
grant execute on function private.checked_in(uuid, uuid) to authenticated;

create function private.check_in_ok(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
      coalesce((private.event_setting(p_event, 'checkin') ->> 'requiredToCompete')::boolean, false)
      or coalesce((private.event_setting(p_event, 'checkin') ->> 'requiredToEnter')::boolean, false)
    )
    or private.event_role(p_event) is distinct from 'participant'
    or private.checked_in(p_event, (select auth.uid()));
$$;
grant execute on function private.check_in_ok(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'bogey:venue-code') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'bogey:venue-code');
  end if;
end;
$$;

create function private.venue_code(p_event uuid, p_back integer default 0)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select upper(substr(encode(extensions.hmac(
    p_event::text || ':' || (floor(extract(epoch from now()) / 600)::bigint - p_back)::text,
    (select decrypted_secret from vault.decrypted_secrets where name = 'bogey:venue-code'),
    'sha256'), 'hex'), 1, 6));
$$;
revoke execute on function private.venue_code(uuid, integer) from anon, authenticated;

create function public.venue_code(p_event uuid)
returns table (code text, seconds_left integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'people.checkin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select private.venue_code(p_event),
    (600 - (extract(epoch from now())::bigint % 600))::integer;
end;
$$;

create function private.new_member_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) i;
$$;

create function private.member_code(p_event uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  select code into v_code from public.member_codes where event_id = p_event and user_id = p_user;
  if v_code is not null then
    return v_code;
  end if;
  loop
    begin
      insert into public.member_codes (event_id, user_id, code)
      values (p_event, p_user, private.new_member_code())
      on conflict (event_id, user_id) do nothing;
      select code into v_code from public.member_codes where event_id = p_event and user_id = p_user;
      return v_code;
    exception when unique_violation then
    end;
  end loop;
end;
$$;
revoke execute on function private.member_code(uuid, uuid) from anon, authenticated;

create function public.my_badge(p_event uuid)
returns table (code text, name text, team text, division text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or private.event_role(p_event) is null then
    raise exception 'not in this event' using errcode = '42501';
  end if;
  return query
  select private.member_code(p_event, v_uid),
    coalesce(p.display_name, 'Participant'),
    (select t.name from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.event_id = p_event and tm.user_id = v_uid limit 1),
    (select d.name from public.event_members m join public.divisions d on d.id = m.division_id
     where m.event_id = p_event and m.user_id = v_uid)
  from public.profiles p where p.id = v_uid;
end;
$$;

create function public.check_in(
  p_event uuid, p_user uuid default null, p_code text default null, p_method text default 'desk',
  p_note text default ''
)
returns table (user_id uuid, name text, already boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid;
  v_settings jsonb := private.event_setting(p_event, 'checkin');
  v_already boolean;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_method not in ('desk', 'qr', 'self', 'import') then
    raise exception 'unknown method' using errcode = '22023';
  end if;

  if p_method = 'self' then
    if coalesce((v_settings ->> 'selfCheckIn')::boolean, false) is not true
       or upper(btrim(coalesce(p_code, ''))) not in (private.venue_code(p_event), private.venue_code(p_event, 1))
       or not private.window_open(p_event, 'checkin')
       or private.event_role(p_event) is null then
      raise exception 'that code doesn''t check you in' using errcode = '42501';
    end if;
    v_target := v_uid;
  else
    if not private.has_permission(p_event, 'people.checkin') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_user is not null then
      v_target := p_user;
    else
      select c.user_id into v_target from public.member_codes c
      where c.event_id = p_event and c.code = upper(btrim(coalesce(p_code, '')));
    end if;
  end if;

  if v_target is null or not exists (
    select 1 from public.event_members m where m.event_id = p_event and m.user_id = v_target and m.status = 'active'
  ) then
    raise exception 'no one in this event matches' using errcode = 'P0002';
  end if;

  v_already := private.checked_in(p_event, v_target);
  if not v_already then
    insert into public.checkins (event_id, user_id, checked_in_by, method, note)
    values (p_event, v_target, v_uid, p_method, left(coalesce(p_note, ''), 200))
    on conflict on constraint checkins_pkey do update
      set checked_in_at = now(), checked_in_by = v_uid, method = excluded.method,
          checked_out_at = null, note = excluded.note;
    perform private.audit(p_event, 'checkin.checked_in', 'member', v_target,
      jsonb_build_object('method', p_method));
  end if;
  return query select v_target, coalesce(p.display_name, 'Participant'), v_already
    from public.profiles p where p.id = v_target;
end;
$$;

create function public.undo_check_in(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'people.checkin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.checkins where event_id = p_event and user_id = p_user;
  if found then
    perform private.audit(p_event, 'checkin.undone', 'member', p_user, '{}');
  end if;
end;
$$;

create function public.check_out(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'people.checkin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.checkins set checked_out_at = now()
  where event_id = p_event and user_id = p_user and checked_out_at is null;
  if found then
    perform private.audit(p_event, 'checkin.checked_out', 'member', p_user, '{}');
  end if;
end;
$$;

create function public.checkin_roster(p_event uuid)
returns table (
  user_id uuid, name text, email text, role public.event_role, team text, division text,
  checked_in_at timestamptz, checked_out_at timestamptz, method text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_event, 'people.checkin') or private.can_manage(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(p.display_name, 'Participant'), u.email::text, m.role,
    (select t.name from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.event_id = p_event and tm.user_id = m.user_id limit 1),
    d.name, c.checked_in_at, c.checked_out_at, c.method
  from public.event_members m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  left join public.divisions d on d.id = m.division_id
  left join public.checkins c on c.event_id = m.event_id and c.user_id = m.user_id
  where m.event_id = p_event and m.status = 'active'
  order by coalesce(p.display_name, ''), u.email;
end;
$$;

create function public.badge_sheet(p_event uuid, p_roles public.event_role[] default array['participant']::public.event_role[])
returns table (user_id uuid, name text, role public.event_role, team text, division text, code text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_permission(p_event, 'people.checkin') or private.can_manage(p_event)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
  select m.user_id, coalesce(p.display_name, 'Participant'), m.role,
    (select t.name from public.team_members tm join public.teams t on t.id = tm.team_id
     where tm.event_id = p_event and tm.user_id = m.user_id limit 1),
    d.name, private.member_code(p_event, m.user_id)
  from public.event_members m
  join public.profiles p on p.id = m.user_id
  left join public.divisions d on d.id = m.division_id
  where m.event_id = p_event and m.status = 'active' and m.role = any (p_roles)
  order by coalesce(p.display_name, '');
end;
$$;

create function public.check_in_walk_in(
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

create function private.send_badge_emails()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_hours integer;
  v_person uuid;
  v_count integer := 0;
begin
  for v_event in
    select e.id, e.slug, e.starts_at from public.events e
    where e.starts_at > now() and e.starts_at < now() + interval '14 days' and e.visibility <> 'draft'
  loop
    v_hours := (private.event_setting(v_event.id, 'checkin') ->> 'badgeEmailHours')::integer;
    continue when v_hours is null or v_hours = 0 or v_event.starts_at > now() + make_interval(hours => v_hours);
    for v_person in
      select m.user_id from public.event_members m
      where m.event_id = v_event.id and m.role = 'participant' and m.status = 'active'
        and not exists (select 1 from public.badge_emails b where b.event_id = m.event_id and b.user_id = m.user_id)
    loop
      insert into public.badge_emails (event_id, user_id) values (v_event.id, v_person);
      perform private.notify(array[v_person], v_event.id, 'checkin.badge',
        'Your check-in code', 'Show it at the desk when you arrive.', '/events/' || v_event.slug,
        jsonb_build_object('when', to_char(v_event.starts_at, 'FMDay HH24:MI') || ' UTC'));
      v_count := v_count + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.send_badge_emails() from anon, authenticated;
select cron.schedule('bogey-badge-emails', '*/10 * * * *', 'select private.send_badge_emails()');

grant execute on function
  public.my_badge(uuid),
  public.check_in(uuid, uuid, text, text, text),
  public.venue_code(uuid),
  public.undo_check_in(uuid, uuid),
  public.check_out(uuid, uuid),
  public.checkin_roster(uuid),
  public.badge_sheet(uuid, public.event_role[]),
  public.check_in_walk_in(uuid, text, text, jsonb, boolean)
to authenticated;

select private.hide_suspended_org('public.checkins');
select private.hide_suspended_org('public.member_codes');
select private.hide_suspended_org('public.badge_emails');

alter publication supabase_realtime add table public.checkins;
