-- announcements can go to the people in a session

alter table public.announcement_audiences add column if not exists session_id uuid;

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
    where conrelid = 'public.announcement_audiences'::regclass and contype in ('c', 'u')
  loop
    execute format('alter table public.announcement_audiences drop constraint %I', v_name);
  end loop;
end;
$$;

alter table public.announcement_audiences
  add check (num_nonnulls(role, division_id, team_id, session_id) = 1),
  add unique nulls not distinct (announcement_id, role, division_id, team_id, session_id),
  add foreign key (event_id, session_id) references public.event_sessions (event_id, id) on delete cascade;
create index if not exists announcement_audiences_event_id_session_id_fk_idx
  on public.announcement_audiences (event_id, session_id);

create or replace function private.in_announcement_audience(p_announcement uuid, p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.announcement_audiences a
    where a.announcement_id = p_announcement
      and (
        a.role = private.event_role(p_event)
        or a.team_id = private.my_team(p_event)
        or a.division_id in (
          select m.division_id from public.event_members m
          where m.event_id = p_event and m.user_id = (select auth.uid()) and m.status = 'active'
          union
          select t.division_id from public.teams t where t.id = private.my_team(p_event)
        )
        or a.session_id in (
          select g.session_id from public.session_signups g
          where g.event_id = p_event and g.user_id = (select auth.uid())
          union
          select h.session_id from public.session_hosts h
          where h.event_id = p_event and h.user_id = (select auth.uid())
        )
      )
  );
$$;

create or replace function private.deliver_announcement(p_announcement uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements;
  v_slug text;
  v_users uuid[];
begin
  update public.announcements set notified_at = now()
  where id = p_announcement and also_notify and notified_at is null and deleted_at is null
    and publish_at <= now()
  returning * into v_a;
  if v_a.id is null then
    return 0;
  end if;
  select slug into v_slug from public.events where id = v_a.event_id;
  select array_agg(m.user_id) into v_users
  from public.event_members m
  where m.event_id = v_a.event_id and m.status = 'active'
    and (v_a.everyone
      or exists (select 1 from public.announcement_audiences x
        where x.announcement_id = v_a.id and x.role = m.role)
      or exists (select 1 from public.announcement_audiences x
        where x.announcement_id = v_a.id and x.division_id = m.division_id)
      or exists (select 1 from public.announcement_audiences x
        join public.team_members tm on tm.team_id = x.team_id
        where x.announcement_id = v_a.id and tm.user_id = m.user_id)
      or exists (select 1 from public.announcement_audiences x
        where x.announcement_id = v_a.id and x.session_id is not null
          and (exists (select 1 from public.session_signups g
                where g.session_id = x.session_id and g.user_id = m.user_id)
            or exists (select 1 from public.session_hosts h
                where h.session_id = x.session_id and h.user_id = m.user_id))));
  return private.notify(coalesce(v_users, '{}'), v_a.event_id, 'announcement', v_a.title,
    left(v_a.body_md, 2000), '/events/' || v_slug || '/messages', '{}', true);
end;
$$;

drop function if exists public.post_announcement(uuid, text, text, public.announcement_severity, timestamptz, public.event_role[], uuid[], uuid[], boolean, boolean, uuid, jsonb);

create function public.post_announcement(
  p_event uuid,
  p_title text,
  p_body text,
  p_severity public.announcement_severity,
  p_publish_at timestamptz default null,
  p_roles public.event_role[] default '{}',
  p_divisions uuid[] default '{}',
  p_teams uuid[] default '{}',
  p_anonymous boolean default false,
  p_notify boolean default false,
  p_id uuid default null,
  p_attachments jsonb default '[]',
  p_sessions uuid[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_everyone boolean := coalesce(cardinality(p_roles), 0) + coalesce(cardinality(p_divisions), 0)
    + coalesce(cardinality(p_teams), 0) + coalesce(cardinality(p_sessions), 0) = 0;
begin
  if not private.may_announce(p_event) then
    raise exception 'Only organizers can post announcements.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_attachments) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_attachments) a
    where jsonb_typeof(a) <> 'object'
      or coalesce(a ->> 'path', '') not like p_event::text || '/' || v_id::text || '/%'
      or length(coalesce(a ->> 'name', '')) not between 1 and 255
  ) then
    raise exception 'attachments must be uploaded to this announcement' using errcode = '22023';
  end if;
  if not private.can_manage(p_event) then
    if cardinality(p_teams) > 0 and private.hides_team_names(p_event) then
      raise exception 'Judging is blind, so judges can''t address teams.' using errcode = '42501';
    end if;
    -- A judge's announcement always carries their name.
    p_anonymous := false;
  end if;
  insert into public.announcements (id, event_id, title, body_md, severity, everyone, publish_at, also_notify, author_id, attachments)
  values (v_id, p_event, trim(p_title), coalesce(p_body, ''), p_severity, v_everyone,
    coalesce(p_publish_at, now()), p_notify, case when p_anonymous then null else (select auth.uid()) end,
    p_attachments);
  insert into public.announcement_audiences (event_id, announcement_id, role)
  select distinct p_event, v_id, r from unnest(p_roles) r;
  insert into public.announcement_audiences (event_id, announcement_id, division_id)
  select distinct p_event, v_id, d from unnest(p_divisions) d;
  insert into public.announcement_audiences (event_id, announcement_id, team_id)
  select distinct p_event, v_id, t from unnest(p_teams) t;
  insert into public.announcement_audiences (event_id, announcement_id, session_id)
  select distinct p_event, v_id, x from unnest(p_sessions) x;
  perform private.audit(p_event, 'announcement.posted', 'announcement', v_id,
    jsonb_build_object('title', trim(p_title), 'everyone', v_everyone,
      'scheduled', p_publish_at is not null and p_publish_at > now(), 'anonymous', p_anonymous,
      'notify', p_notify));
  if p_notify and coalesce(p_publish_at, now()) <= now() then
    perform private.deliver_announcement(v_id);
  end if;
  return v_id;
end;
$$;
grant execute on function public.post_announcement(uuid, text, text, public.announcement_severity, timestamptz, public.event_role[], uuid[], uuid[], boolean, boolean, uuid, jsonb, uuid[]) to authenticated;
