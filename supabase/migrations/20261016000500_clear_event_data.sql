-- danger zone clean-ups: prune participants, decline everyone waiting, reset judging, remove all participants

-- the danger zone's bulk clean-ups; p_dry_run only counts, otherwise the slug confirms.
-- returns the count and, for removed participants, their stored files for the caller to remove
create function public.clear_event_data(
  p_event uuid, p_what text, p_confirm text default null, p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_count integer;
  v_files jsonb := '[]';
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_what not in ('waiting', 'judging', 'participants') then
    raise exception 'unknown clean-up' using errcode = '22023';
  end if;
  if not p_dry_run and p_confirm is distinct from v_event.slug::text then
    raise exception 'type the event''s web address to confirm' using errcode = '22023';
  end if;

  if p_what = 'waiting' then
    select count(*) into v_count from public.registrations
    where event_id = p_event and status in ('pending', 'waitlisted');
    if not p_dry_run then
      update public.registrations set status = 'rejected'
      where event_id = p_event and status in ('pending', 'waitlisted');
    end if;
  elsif p_what = 'judging' then
    select count(distinct submission_id) into v_count from (
      select submission_id from public.scores where event_id = p_event
      union all select submission_id from public.feedback where event_id = p_event
      union all select submission_id from public.judge_assignments where event_id = p_event
      union all select submission_id from public.judging_flags where event_id = p_event
      union all select submission_id from public.round_entries where event_id = p_event
      union all select submission_id from public.ranking_inputs where event_id = p_event
    ) touched;
    if not p_dry_run then
      delete from public.scores where event_id = p_event;
      delete from public.feedback where event_id = p_event;
      delete from public.judge_assignments where event_id = p_event;
      delete from public.judging_flags where event_id = p_event;
      delete from public.round_entries where event_id = p_event;
      delete from public.ranking_inputs where event_id = p_event;
    end if;
  else
    select count(*) into v_count from public.event_members
    where event_id = p_event and role = 'participant';
    if not p_dry_run then
      select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]')
      into v_files
      from storage.objects o
      where (storage.foldername(o.name))[1] = p_event::text
        and (o.bucket_id = 'submissions'
          or (o.bucket_id = 'registrations' and exists (
            select 1 from public.event_members m
            where m.event_id = p_event and m.role = 'participant'
              and m.user_id::text = (storage.foldername(o.name))[2])));
      delete from public.teams where event_id = p_event;
      delete from public.registrations where event_id = p_event and role = 'participant';
      delete from public.event_members where event_id = p_event and role = 'participant';
    end if;
  end if;

  if not p_dry_run then
    perform private.audit(p_event, 'event.cleared', 'event', p_event,
      jsonb_build_object('what', p_what, 'count', v_count));
  end if;
  return jsonb_build_object('count', v_count, 'files', v_files);
end;
$$;
grant execute on function public.clear_event_data(uuid, text, text, boolean) to authenticated;

-- removes active participants matching every kind of rule given: each condition in p_rules
-- (not_checked_in, no_team, no_submission), any of p_divisions, any of p_sessions (signed up for)
create function public.prune_participants(
  p_event uuid, p_rules text[] default '{}', p_divisions uuid[] default '{}', p_sessions uuid[] default '{}',
  p_confirm text default null, p_dry_run boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_users uuid[];
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(p_rules) r where r not in ('not_checked_in', 'no_team', 'no_submission')) then
    raise exception 'unknown rule' using errcode = '22023';
  end if;
  if cardinality(p_rules) + cardinality(p_divisions) + cardinality(p_sessions) = 0 then
    raise exception 'pick who to remove' using errcode = '22023';
  end if;
  if not p_dry_run and p_confirm is distinct from v_event.slug::text then
    raise exception 'type the event''s web address to confirm' using errcode = '22023';
  end if;

  select coalesce(array_agg(m.user_id), '{}') into v_users
  from public.event_members m
  where m.event_id = p_event and m.role = 'participant' and m.status = 'active'
    and (not 'not_checked_in' = any (p_rules) or not exists (
      select 1 from public.checkins c where c.event_id = p_event and c.user_id = m.user_id))
    and (not 'no_team' = any (p_rules) or not exists (
      select 1 from public.team_members tm where tm.event_id = p_event and tm.user_id = m.user_id))
    and (not 'no_submission' = any (p_rules) or not exists (
      select 1 from public.team_members tm
      join public.submissions s on s.team_id = tm.team_id and s.status = 'submitted'
      where tm.event_id = p_event and tm.user_id = m.user_id))
    and (cardinality(p_divisions) = 0 or m.division_id = any (p_divisions) or exists (
      select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
      where tm.event_id = p_event and tm.user_id = m.user_id and t.division_id = any (p_divisions)))
    and (cardinality(p_sessions) = 0 or exists (
      select 1 from public.session_signups g
      where g.event_id = p_event and g.user_id = m.user_id and g.session_id = any (p_sessions)));

  if not p_dry_run then
    update public.event_members set status = 'removed'
    where event_id = p_event and user_id = any (v_users);
    perform private.audit(p_event, 'event.cleared', 'event', p_event, jsonb_build_object(
      'what', 'prune', 'rules', to_jsonb(p_rules), 'divisions', cardinality(p_divisions),
      'sessions', cardinality(p_sessions), 'count', cardinality(v_users)));
  end if;
  return cardinality(v_users);
end;
$$;
grant execute on function public.prune_participants(uuid, text[], uuid[], uuid[], text, boolean) to authenticated;
