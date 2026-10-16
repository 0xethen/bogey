-- organizers can stop a person or a team from messaging

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

alter table public.chat_blocks enable row level security;
create policy chat_blocks_select on public.chat_blocks for select to authenticated
  using (
    (select private.can_manage(event_id))
    or user_id = (select auth.uid())
    or (team_id is not null and private.is_team_member(team_id))
  );

create or replace function private.can_write_clarification(p_clarification uuid)
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
      and private.network_allowed(c.event_id)
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

drop policy clarifications_insert on public.clarifications;
create policy clarifications_insert on public.clarifications for insert to authenticated
  with check (
    (select private.chat_allows(event_id, 'enabled'))
    and (
      (
        audience = 'staff'
        and (select private.chat_allows(event_id, 'staff'))
        and ((select private.can_manage(event_id)) or (select private.event_role(event_id)) = 'judge')
      )
      or (audience <> 'staff' and (select private.can_manage(event_id)))
      or (
        audience = 'judges'
        and team_id is not null
        and (select private.event_role(event_id)) = 'judge'
        and (select private.chat_allows(event_id, 'judges'))
      )
      or (
        (select private.has_permission(event_id, 'event.compete'))
        and not (select private.chat_blocked(event_id))
        and (select private.chat_allows(event_id, 'participants'))
        and (audience = 'organizers' or (audience = 'judges' and (select private.chat_allows(event_id, 'judges'))))
      )
    )
  );
