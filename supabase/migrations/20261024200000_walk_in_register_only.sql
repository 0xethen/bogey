-- the desk can register a walk-in without checking them in
drop function if exists public.check_in_walk_in(uuid, text, text, jsonb);
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
      else private.clean_registration_answers(p_event, coalesce(v_fields, '[]'), p_answers, (select auth.uid())) end)
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
grant execute on function public.check_in_walk_in(uuid, text, text, jsonb, boolean) to authenticated;
