-- network_areas: limit the network allowlist to chosen areas of the event
-- p_area names where the check applies: null means any area; an event can limit the
-- network to some areas (access.networkAreas), and the rest stay open.
create function private.network_allowed(p_event uuid, p_area text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb := private.event_setting(p_event, 'access');
  v_networks jsonb := v_access -> 'allowedNetworks';
  v_areas jsonb := coalesce(v_access -> 'networkAreas', '[]');
  v_role public.event_role;
  v_ip inet;
begin
  if v_networks is null or jsonb_array_length(v_networks) = 0
     or (select auth.role()) = 'service_role'
     or private.can_manage(p_event) then
    return true;
  end if;
  if p_area is not null and jsonb_array_length(v_areas) > 0 and not (v_areas ? p_area) then
    return true;
  end if;
  v_role := private.event_role(p_event);
  if v_role is not null and v_role <> 'participant' then
    return true;
  end if;
  if v_role is not null and not private.network_limit_covers(p_event, v_access) then
    return true;
  end if;
  v_ip := private.request_ip();
  return v_ip is not null and exists (
    select 1 from jsonb_array_elements_text(v_networks) as n(cidr) where v_ip <<= n.cidr::cidr
  );
end;
$$;

create or replace function private.network_allowed(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.network_allowed(p_event, null);
$$;

create function private.require_network(p_event uuid, p_area text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.network_allowed(p_event, p_area) then
    raise exception 'connect to the event''s network to take part' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function private.require_network(p_event uuid)
returns void
language sql
stable
security definer
set search_path = ''
as $$
  select private.require_network(p_event, null);
$$;

create or replace function public.event_network_status(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_access jsonb := private.event_setting(p_event, 'access');
  v_networks jsonb := v_access -> 'allowedNetworks';
begin
  if not private.can_view_event(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'restricted', coalesce(jsonb_array_length(v_networks), 0) > 0
      and (private.event_role(p_event) is null or private.network_limit_covers(p_event, v_access)),
    'allowed', private.network_allowed(p_event),
    'areas', coalesce(v_access -> 'networkAreas', '[]'),
    'ip', host(private.request_ip())
  );
end;
$$;

grant execute on function private.network_allowed(uuid, text), private.require_network(uuid, text)
to anon, authenticated, service_role;

create or replace function public.choose_session(p_session uuid)
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
  perform private.require_network(v_session.event_id, 'sessions');
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

create or replace function public.leave_session_slot(p_slot uuid)
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
  perform private.require_network(v_event, 'sessions');
  if not private.window_open(v_event, 'sessions') then
    raise exception 'session sign-ups are closed' using errcode = '42501';
  end if;
  delete from public.session_signups where slot_id = p_slot and user_id = (select auth.uid());
  perform private.audit(v_event, 'session.left', 'session', v_session, '{}');
end;
$$;

create or replace function public.check_in_session(p_event uuid, p_code text)
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
  perform private.require_network(p_event, 'sessions');
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

create or replace function private.assert_can_change_teams(p_event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_permission(p_event, 'event.compete') then
    raise exception 'only participants can join teams' using errcode = '42501';
  end if;
  perform private.require_network(p_event, 'teams');
  if not private.check_in_ok(p_event) then
    raise exception 'check in at the desk first' using errcode = 'P0001';
  end if;
  if not private.window_open(p_event, 'teams') then
    raise exception 'teams are locked right now' using errcode = 'P0001';
  end if;
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
  update public.teams set division_id = p_division where id = v_team.id;
  update public.event_members set division_id = p_division
  where event_id = p_event
    and user_id in (select user_id from public.team_members where team_id = v_team.id);
  perform private.audit(p_event, 'division.chosen', 'division', p_division,
    jsonb_build_object('from', v_team.division_id, 'team', v_team.id));
end;
$$;

create or replace function public.ask_clarification(
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

create or replace function public.message_team(p_event uuid, p_team uuid, p_subject text, p_body text)
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

create or replace function private.team_write_allowed(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.submission_window_open(p_form) and coalesce((
    select private.network_allowed(f.event_id, 'submissions') and private.check_in_ok(f.event_id)
    from public.submission_forms f where f.id = p_form
  ), false);
$$;

create or replace function public.submit_project(p_submission uuid, p_submit boolean default true)
returns public.submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submissions;
  v_missing text[];
begin
  select * into v_row from public.submissions where id = p_submission for update;
  if v_row.id is null or not private.is_team_member(v_row.team_id) then
    raise exception 'not your submission' using errcode = '42501';
  end if;
  if not private.submission_window_open(v_row.form_id) then
    raise exception 'submissions are closed' using errcode = 'P0001';
  end if;
  if not private.network_allowed(v_row.event_id, 'submissions') then
    raise exception 'connect to the event''s network to submit' using errcode = 'P0001';
  end if;
  if v_row.status = 'disqualified' then
    raise exception 'this submission was disqualified' using errcode = 'P0001';
  end if;

  if p_submit and not private.form_reaches_team(v_row.form_id, v_row.team_id) then
    raise exception 'this form is for teams in other divisions' using errcode = '42501';
  end if;

  if p_submit then
    v_missing := private.submission_problems(p_submission);
    if cardinality(v_missing) > 0 then
      raise exception 'still missing: %', array_to_string(v_missing, ', ') using errcode = '23502';
    end if;
  end if;

  update public.submissions set
    status = case when p_submit then 'submitted' else 'draft' end::public.submission_status,
    submitted_at = case when p_submit then now() end,
    submitted_by = case when p_submit then (select auth.uid()) end
  where id = p_submission
  returning * into v_row;

  perform private.audit(v_row.event_id, case when p_submit then 'submission.submitted' else 'submission.unsubmitted' end,
    'submission', v_row.id, jsonb_build_object('form', v_row.form_id));
  if p_submit then
    perform private.notify(
      array(select user_id from public.team_members where team_id = v_row.team_id),
      v_row.event_id, 'submission.received', 'Submitted: ' || v_row.title, null,
      '/events/' || (select slug from public.events where id = v_row.event_id) || '/submission',
      jsonb_build_object('project', v_row.title,
        'team', (select name from public.teams where id = v_row.team_id)));
  end if;
  return v_row;
end;
$$;

create or replace function public.delete_submission(p_submission uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submissions;
  v_policy text;
begin
  select * into v_row from public.submissions where id = p_submission for update;
  if v_row.id is null then
    raise exception 'that submission is gone' using errcode = 'P0002';
  end if;

  if not private.can_manage(v_row.event_id) then
    if not private.is_team_member(v_row.team_id) then
      raise exception 'not your submission' using errcode = '42501';
    end if;
    if v_row.status = 'disqualified' then
      raise exception 'this submission was disqualified' using errcode = 'P0001';
    end if;
    if not private.network_allowed(v_row.event_id, 'submissions') then
      raise exception 'connect to the event''s network to change submissions' using errcode = 'P0001';
    end if;
    v_policy := private.submission_deletion(v_row.event_id);
    if v_policy = 'none' then
      raise exception 'this event doesn''t allow deleting submissions' using errcode = 'P0001';
    end if;
    if v_policy = 'request' then
      if v_row.deletion_requested_at is null then
        update public.submissions
        set deletion_requested_at = now(), deletion_requested_by = (select auth.uid())
        where id = p_submission;
        perform private.audit(v_row.event_id, 'submission.deletion_requested', 'submission', v_row.id,
          jsonb_build_object('title', v_row.title));
      end if;
      return 'requested';
    end if;
    if not private.submission_window_open(v_row.form_id) then
      raise exception 'submissions are closed' using errcode = 'P0001';
    end if;
  end if;

  perform private.audit(v_row.event_id, 'submission.deleted', 'submission', v_row.id,
    jsonb_build_object('title', v_row.title, 'team', v_row.team_id, 'form', v_row.form_id));
  delete from public.submissions where id = p_submission;
  return 'deleted';
end;
$$;

create or replace function public.cast_vote(p_submission uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.submissions;
  v_settings jsonb;
  v_who text;
  v_limit integer;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or v_sub.status <> 'submitted' then
    raise exception 'that project can''t be voted for' using errcode = '22023';
  end if;
  v_settings := private.event_setting(v_sub.event_id, 'voting');
  if coalesce((v_settings ->> 'enabled')::boolean, false) is not true
     or not private.window_open(v_sub.event_id, 'voting') then
    raise exception 'voting is not open' using errcode = '42501';
  end if;
  if not private.network_allowed(v_sub.event_id, 'voting') then
    raise exception 'voting isn''t allowed from this network' using errcode = '42501';
  end if;
  if not private.check_in_ok(v_sub.event_id) then
    raise exception 'check in at the desk first' using errcode = 'P0001';
  end if;

  v_who := v_settings ->> 'who';
  v_ok := case v_who
    when 'participants' then exists (
      select 1 from public.event_members m
      where m.event_id = v_sub.event_id and m.user_id = v_uid and m.role = 'participant' and m.status = 'active')
    when 'members' then exists (
      select 1 from public.event_members m
      where m.event_id = v_sub.event_id and m.user_id = v_uid and m.status = 'active')
    else private.can_view_event(v_sub.event_id) and private.gallery_open(v_sub.event_id)
  end;
  if not coalesce(v_ok, false) then
    raise exception 'you can''t vote in this event' using errcode = '42501';
  end if;

  if not coalesce((v_settings ->> 'ownTeam')::boolean, false) and private.is_team_member(v_sub.team_id) then
    raise exception 'teams can''t vote for themselves' using errcode = '42501';
  end if;
  v_limit := coalesce((v_settings ->> 'votesPerPerson')::integer, 1);
  if (select count(*) from public.votes where event_id = v_sub.event_id and voter_id = v_uid
      and submission_id <> p_submission) >= v_limit then
    raise exception 'you have used your % vote(s)', v_limit using errcode = '22023';
  end if;

  insert into public.votes (event_id, submission_id, voter_id)
  values (v_sub.event_id, p_submission, v_uid)
  on conflict do nothing;
  if found then
    perform private.audit(v_sub.event_id, 'vote.cast', 'submission', p_submission, '{}');
  end if;
end;
$$;

alter policy teams_update on public.teams
  using (
    ((select private.can_manage(event_id)))
    or
    (
      locked_at is null
      and (select private.window_open(event_id, 'teams'))
      and (select private.network_allowed(event_id, 'teams'))
      and exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid()) and tm.role = 'captain'
      )
    )
  );
