create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  title text not null check (length(title) between 1 and 140),
  body_md text not null default '',
  severity public.announcement_severity not null default 'info',
  everyone boolean not null default true,
  publish_at timestamptz not null default now(),
  also_notify boolean not null default false,
  notified_at timestamptz,
  author_id uuid references public.profiles on delete set null,
  attachments jsonb not null default '[]'
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, id)
);
create index announcements_event_idx on public.announcements (event_id, publish_at desc);

create trigger announcements_touch before update on public.announcements
  for each row execute function private.touch_updated_at();

create function private.broadcast_announcements(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send('{}'::jsonb, 'changed', 'announcements:' || p_event::text, false);
exception when others then
  null;
end;
$$;

create function private.announcements_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.broadcast_announcements(coalesce(new.event_id, old.event_id));
  return null;
end;
$$;

create trigger announcements_broadcast after insert or update or delete on public.announcements
  for each row execute function private.announcements_changed();

create table public.announcement_audiences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  announcement_id uuid not null,
  role public.event_role,
  division_id uuid,
  team_id uuid,
  session_id uuid,
  check (num_nonnulls(role, division_id, team_id, session_id) = 1),
  unique nulls not distinct (announcement_id, role, division_id, team_id, session_id),
  foreign key (event_id, announcement_id) references public.announcements (event_id, id) on delete cascade,
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);

create function private.in_announcement_audience(p_announcement uuid, p_event uuid)
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
grant execute on function private.in_announcement_audience(uuid, uuid) to authenticated;

create function private.deliver_announcement(p_announcement uuid)
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
revoke execute on function private.deliver_announcement(uuid) from anon, authenticated;

create function private.deliver_due_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select id from public.announcements
    where also_notify and notified_at is null and deleted_at is null and publish_at <= now()
  loop
    v_count := v_count + private.deliver_announcement(v_id);
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.deliver_due_announcements() from anon, authenticated;

-- Organizers, and judges when `announcements.judges` is on.
create function private.may_announce(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage(p_event)
    or (
      private.event_role(p_event) = 'judge'
      and coalesce((private.event_setting(p_event, 'announcements') ->> 'judges')::boolean, false)
    );
$$;
grant execute on function private.may_announce(uuid) to authenticated;

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

create table public.announcement_reads (
  announcement_id uuid not null references public.announcements on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index announcement_reads_user_idx on public.announcement_reads (user_id);

create function private.audit_announcement_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    perform private.audit(new.event_id, 'announcement.deleted', 'announcement', new.id,
      jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

create trigger announcements_audit_delete after update of deleted_at on public.announcements
  for each row execute function private.audit_announcement_delete();

create table public.clarifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  team_id uuid,
  asked_by uuid references public.profiles on delete set null,
  topic text not null default 'general' check (topic ~ '^(general|[a-z][a-z0-9-]*\.[a-z0-9-]+(:[0-9a-f-]+)?)$'),
  subject text not null check (length(subject) between 1 and 140),
  audience text not null default 'organizers' check (audience in ('organizers', 'judges', 'staff')),
  status public.clarification_status not null default 'open',
  visibility public.clarification_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, id),
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete set null (team_id)
);
create index clarifications_event_idx on public.clarifications (event_id, created_at desc);
create index clarifications_team_idx on public.clarifications (team_id) where team_id is not null;

create trigger clarifications_touch before update on public.clarifications
  for each row execute function private.touch_updated_at();

create table public.clarification_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  clarification_id uuid not null,
  author_id uuid references public.profiles on delete set null,
  author_role text not null default 'participant' check (author_role in ('participant', 'organizer', 'judge')),
  body_md text not null default '' check (length(body_md) <= 10000),
  attachments jsonb not null default '[]'
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(body_md) > 0 or jsonb_array_length(attachments) > 0),
  foreign key (event_id, clarification_id) references public.clarifications (event_id, id) on delete cascade
);
create index clarification_messages_thread_idx on public.clarification_messages (clarification_id, created_at);

create function private.chat_allows(p_event uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.event_setting(p_event, 'chat') ->> p_key)::boolean, false);
$$;

-- people or teams an organizer stopped from asking or replying, for abuse
create table public.chat_blocks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  user_id uuid,
  team_id uuid,
  reason text not null default '' check (length(reason) <= 500),
  blocked_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, team_id) = 1),
  unique nulls not distinct (event_id, user_id, team_id),
  foreign key (event_id, user_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index chat_blocks_event_id_user_id_fk_idx on public.chat_blocks (event_id, user_id);
create index chat_blocks_event_id_team_id_fk_idx on public.chat_blocks (event_id, team_id);
create index chat_blocks_blocked_by_fk_idx on public.chat_blocks (blocked_by);

create function private.chat_blocked(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.chat_blocks b
    where b.event_id = p_event
      and (b.user_id = (select auth.uid()) or b.team_id = private.my_team(p_event))
  );
$$;
grant execute on function private.chat_blocked(uuid) to authenticated;

create function public.block_from_chat(
  p_event uuid, p_user uuid default null, p_team uuid default null, p_reason text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if num_nonnulls(p_user, p_team) <> 1 then
    raise exception 'block one person or one team' using errcode = '22023';
  end if;
  insert into public.chat_blocks (event_id, user_id, team_id, reason, blocked_by)
  values (p_event, p_user, p_team, left(trim(coalesce(p_reason, '')), 500), (select auth.uid()))
  on conflict (event_id, user_id, team_id) do update set reason = excluded.reason
  returning id into v_id;
  perform private.audit(p_event, 'chat.blocked', case when p_team is null then 'user' else 'team' end,
    coalesce(p_user, p_team), '{}');
  return v_id;
end;
$$;

create function public.unblock_from_chat(p_block uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.chat_blocks;
begin
  select * into v_block from public.chat_blocks where id = p_block;
  if v_block.id is null or not private.can_manage(v_block.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.chat_blocks where id = p_block;
  perform private.audit(v_block.event_id, 'chat.unblocked',
    case when v_block.team_id is null then 'user' else 'team' end,
    coalesce(v_block.user_id, v_block.team_id), '{}');
end;
$$;
grant execute on function
  public.block_from_chat(uuid, uuid, uuid, text),
  public.unblock_from_chat(uuid)
to authenticated;

create function private.prepare_clarification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.asked_by := coalesce((select auth.uid()), new.asked_by);
  if (select auth.uid()) is not null and not private.can_manage(new.event_id) then
    if new.team_id is not null and private.event_role(new.event_id) = 'judge' then
      -- A judge messaging a team: only in a judges conversation, never under blind judging.
      if new.audience <> 'judges' or private.hides_team_names(new.event_id) then
        raise exception 'You can''t message that team.' using errcode = '42501';
      end if;
    else
      new.team_id := case
        when new.audience <> 'staff' and private.chat_allows(new.event_id, 'copyTeam')
          then private.my_team(new.event_id)
      end;
    end if;
    new.status := 'open';
    new.visibility := 'private';
  end if;
  return new;
end;
$$;

create trigger clarifications_prepare before insert on public.clarifications
  for each row execute function private.prepare_clarification();

create function private.prepare_clarification_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager boolean := private.can_manage(new.event_id)
    or private.has_permission(new.event_id, 'clarifications.answer');
  v_asker uuid := (select asked_by from public.clarifications where id = new.clarification_id);
begin
  if exists (
    select 1 from jsonb_array_elements(new.attachments) a
    where jsonb_typeof(a) <> 'object'
      or coalesce(a ->> 'path', '') not like new.event_id::text || '/' || new.clarification_id::text || '/%'
      or length(coalesce(a ->> 'name', '')) not between 1 and 255
  ) then
    raise exception 'attachments must be uploaded to this conversation' using errcode = '22023';
  end if;
  new.author_id := coalesce((select auth.uid()), new.author_id);
  new.author_role := case
    when v_manager then 'organizer'
    when private.event_role(new.event_id) = 'judge' then 'judge'
    else 'participant'
  end;
  update public.clarifications
  set status = case when new.author_id = v_asker then 'open' else 'answered' end::public.clarification_status
  where id = new.clarification_id and status <> 'closed';
  return new;
end;
$$;

create trigger clarification_messages_prepare before insert on public.clarification_messages
  for each row execute function private.prepare_clarification_message();

create function public.ask_clarification(
  p_event uuid, p_subject text, p_body text, p_topic text default 'general',
  p_audience text default 'organizers'
)
returns public.clarifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_row public.clarifications;
begin
  perform private.require_network(p_event, 'messages');
  insert into public.clarifications (id, event_id, subject, topic, audience)
  values (v_id, p_event, trim(p_subject), p_topic, p_audience);
  insert into public.clarification_messages (event_id, clarification_id, body_md)
  values (p_event, v_id, p_body);
  select * into v_row from public.clarifications where id = v_id;
  return v_row;
end;
$$;
grant execute on function public.ask_clarification(uuid, text, text, text, text) to authenticated;

-- An organizer or judge starts a conversation with one team. Organizers write
-- as organizers; judges in a judges conversation, which needs `chat.judges`.
create function public.message_team(p_event uuid, p_team uuid, p_subject text, p_body text)
returns public.clarifications
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_row public.clarifications;
begin
  perform private.require_network(p_event, 'messages');
  insert into public.clarifications (id, event_id, team_id, subject, audience)
  values (v_id, p_event, p_team, trim(p_subject),
    case when private.can_manage(p_event) then 'organizers' else 'judges' end);
  insert into public.clarification_messages (event_id, clarification_id, body_md)
  values (p_event, v_id, p_body);
  select * into v_row from public.clarifications where id = v_id;
  return v_row;
end;
$$;
grant execute on function public.message_team(uuid, uuid, text, text) to authenticated;

create function private.can_see_clarification(p_clarification uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clarifications c
    where c.id = p_clarification
      and (
        private.can_manage(c.event_id)
        or private.has_permission(c.event_id, 'clarifications.answer')
        or c.asked_by = (select auth.uid())
        or (c.team_id is not null and private.is_team_member(c.team_id))
        or (c.audience <> 'organizers' and private.event_role(c.event_id) = 'judge')
        or (
          c.audience = 'organizers' and c.visibility = 'public'
          and private.has_permission(c.event_id, 'event.view')
        )
      )
  );
$$;
grant execute on function private.can_see_clarification(uuid) to authenticated;
grant execute on function private.chat_allows(uuid, text) to authenticated;

create function private.can_write_clarification(p_clarification uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clarifications c
    where c.id = p_clarification
      and private.chat_allows(c.event_id, 'enabled')
      and private.network_allowed(c.event_id, 'messages')
      and (
        ((private.can_manage(c.event_id) or private.has_permission(c.event_id, 'clarifications.answer'))
          and (c.audience <> 'staff' or private.chat_allows(c.event_id, 'staff')))
        or (
          c.status <> 'closed'
          and (
            (c.audience = 'staff' and private.event_role(c.event_id) = 'judge' and private.chat_allows(c.event_id, 'staff'))
            or (c.audience = 'judges' and private.event_role(c.event_id) = 'judge' and private.chat_allows(c.event_id, 'judges'))
            or (
              c.audience <> 'staff'
              and not private.chat_blocked(c.event_id)
              and private.chat_allows(c.event_id, 'participants')
              and (c.audience = 'organizers' or private.chat_allows(c.event_id, 'judges'))
              and (c.asked_by = (select auth.uid()) or (c.team_id is not null and private.is_team_member(c.team_id)))
            )
          )
        )
      )
  );
$$;
grant execute on function private.can_write_clarification(uuid) to authenticated;

create table public.clarification_archives (
  clarification_id uuid not null references public.clarifications on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (clarification_id, user_id)
);
create index clarification_archives_user_idx on public.clarification_archives (user_id);

create index clarification_messages_event_id_clarification_id_fk_idx on public.clarification_messages (event_id, clarification_id);
create index clarifications_event_id_team_id_fk_idx on public.clarifications (event_id, team_id);
create index announcements_author_id_fk_idx on public.announcements (author_id);
create index announcement_audiences_event_id_announcement_id_fk_idx on public.announcement_audiences (event_id, announcement_id);
create index announcement_audiences_event_id_division_id_fk_idx on public.announcement_audiences (event_id, division_id);
create index announcement_audiences_event_id_team_id_fk_idx on public.announcement_audiences (event_id, team_id);
create index announcement_audiences_event_id_session_id_fk_idx on public.announcement_audiences (event_id, session_id);
create index clarification_messages_author_id_fk_idx on public.clarification_messages (author_id);
create index clarifications_asked_by_fk_idx on public.clarifications (asked_by);

alter table public.announcements enable row level security;
alter table public.announcement_audiences enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.clarifications enable row level security;
alter table public.chat_blocks enable row level security;
alter table public.clarification_messages enable row level security;
alter table public.clarification_archives enable row level security;

create policy announcements_select on public.announcements for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (
      deleted_at is null
      and publish_at <= now()
      and (event_id = any ((select private.events_where('event.view'))::uuid[]))
      and (everyone or private.in_announcement_audience(id, event_id))
    )
  );
create policy announcements_write_update on public.announcements for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy announcements_write_delete on public.announcements for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy announcement_audiences_select on public.announcement_audiences for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy announcement_reads_own on public.announcement_reads for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy chat_blocks_select on public.chat_blocks for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or user_id = (select auth.uid())
    or (team_id is not null and private.is_team_member(team_id))
  );

create policy clarifications_select on public.clarifications for select to authenticated
  using ((select private.can_see_clarification(id)));
create policy clarifications_insert on public.clarifications for insert to authenticated
  with check (
    (select private.chat_allows(event_id, 'enabled'))
    and (
      (
        audience = 'staff'
        and (select private.chat_allows(event_id, 'staff'))
        and ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (select private.event_role(event_id)) = 'judge')
      )
      or (audience <> 'staff' and (event_id = any ((select private.events_where('event.manage'))::uuid[])))
      or (
        audience = 'judges'
        and team_id is not null
        and (select private.event_role(event_id)) = 'judge'
        and (select private.chat_allows(event_id, 'judges'))
      )
      or (
        (event_id = any ((select private.events_where('event.compete'))::uuid[]))
        and not (select private.chat_blocked(event_id))
        and (select private.chat_allows(event_id, 'participants'))
        and (audience = 'organizers' or (audience = 'judges' and (select private.chat_allows(event_id, 'judges'))))
      )
    )
  );
create policy clarifications_manage on public.clarifications for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (event_id = any ((select private.events_where('clarifications.answer'))::uuid[])));

create policy clarification_messages_select on public.clarification_messages for select to authenticated
  using ((select private.can_see_clarification(clarification_id)) and (deleted_at is null or (event_id = any ((select private.events_where('event.manage'))::uuid[]))));
create policy clarification_messages_insert on public.clarification_messages for insert to authenticated
  with check ((select private.can_write_clarification(clarification_id)));
create policy clarification_messages_moderate on public.clarification_messages for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy clarification_archives_own on public.clarification_archives for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select private.can_see_clarification(clarification_id)));

alter publication supabase_realtime add table
  public.announcements, public.clarifications, public.clarification_messages, public.event_windows;
