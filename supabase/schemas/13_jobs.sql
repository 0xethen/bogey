create table private.window_states (
  event_id uuid not null references public.events on delete cascade,
  key text not null,
  is_open boolean not null,
  changed_at timestamptz not null default now(),
  primary key (event_id, key)
);

create function private.announce_window_changes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select w.event_id, w.key, private.window_open(w.event_id, w.key) as is_open, e.name as event_name,
      s.is_open as was_open
    from public.event_windows w
    join public.events e on e.id = w.event_id
    left join private.window_states s on s.event_id = w.event_id and s.key = w.key
    where s.is_open is distinct from private.window_open(w.event_id, w.key)
  loop
    insert into private.window_states (event_id, key, is_open)
    values (v_row.event_id, v_row.key, v_row.is_open)
    on conflict (event_id, key) do update set is_open = excluded.is_open, changed_at = now();

    continue when v_row.was_open is null;

    perform private.audit(v_row.event_id,
      case when v_row.is_open then 'window.opened' else 'window.closed' end,
      'window', null, jsonb_build_object('key', v_row.key));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create function private.broadcast_due_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_count integer := 0;
begin
  for v_event in
    select distinct a.event_id from public.announcements a
    where a.deleted_at is null
      and a.publish_at > a.created_at
      and a.publish_at <= now()
      and a.publish_at > now() - interval '75 seconds'
  loop
    perform private.broadcast_announcements(v_event);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create table private.reminders_sent (
  kind text not null,
  subject uuid not null,
  stamp timestamptz not null,
  sent_at timestamptz not null default now(),
  primary key (kind, subject, stamp)
);

create function private.remind_submission_deadlines()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select s.id as submission_id, s.title, s.team_id, s.event_id, w.closes_at, e.slug, e.timezone, t.name as team
    from public.submissions s
    join public.submission_forms f on f.id = s.form_id
    join public.event_windows w on w.event_id = f.event_id and w.key = f.window_key
    join public.events e on e.id = s.event_id
    join public.teams t on t.id = s.team_id
    where s.status = 'draft'
      and w.override is null
      and w.closes_at > now()
      and coalesce((private.event_setting(s.event_id, 'submissions') ->> 'reminderHours')::integer, 0) > 0
      and w.closes_at <= now() + make_interval(
        hours => (private.event_setting(s.event_id, 'submissions') ->> 'reminderHours')::integer)
      and not exists (select 1 from private.reminders_sent r
        where r.kind = 'submission.deadline' and r.subject = s.id and r.stamp = w.closes_at)
  loop
    insert into private.reminders_sent (kind, subject, stamp)
    values ('submission.deadline', v_row.submission_id, v_row.closes_at);
    v_count := v_count + private.notify(
      array(select user_id from public.team_members where team_id = v_row.team_id),
      v_row.event_id, 'submission.deadline', 'Submit ' || v_row.title, null,
      '/events/' || v_row.slug || '/submission',
      jsonb_build_object('project', v_row.title, 'team', v_row.team,
        'when', to_char(v_row.closes_at at time zone v_row.timezone, 'FMDay FMHH12:MI AM')));
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.remind_submission_deadlines() from anon, authenticated;

create function private.remind_sessions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select x.id, x.name, x.event_id, x.starts, e.slug, e.timezone
    from (
      select se.id, se.name, se.event_id, coalesce(se.starts_at, sl.starts_at) as starts
      from public.event_sessions se join public.session_slots sl on sl.id = se.slot_id
    ) x
    join public.events e on e.id = x.event_id
    where x.starts > now()
      and coalesce((private.event_setting(x.event_id, 'agenda') ->> 'reminderMinutes')::integer, 0) > 0
      and x.starts <= now() + make_interval(
        mins => (private.event_setting(x.event_id, 'agenda') ->> 'reminderMinutes')::integer)
      and not exists (select 1 from private.reminders_sent r
        where r.kind = 'session.reminder' and r.subject = x.id and r.stamp = x.starts)
  loop
    insert into private.reminders_sent (kind, subject, stamp)
    values ('session.reminder', v_row.id, v_row.starts);
    v_count := v_count + private.notify(
      array(select user_id from public.session_signups where session_id = v_row.id),
      v_row.event_id, 'session.reminder', v_row.name || ' is about to start', null,
      '/events/' || v_row.slug || '/agenda/' || v_row.id,
      jsonb_build_object('session', v_row.name,
        'when', to_char(v_row.starts at time zone v_row.timezone, 'FMDay FMHH12:MI AM')));
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.remind_sessions() from anon, authenticated;

create function private.remind_windows()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select x.event_id, x.key, x.opens_at, x.label, e.slug, e.timezone, x.subject
    from (
      select w.event_id, w.key, w.opens_at,
        coalesce(w.reminder_minutes,
          (private.event_setting(w.event_id, 'agenda') ->> 'reminderMinutes')::integer, 0) as mins,
        case w.key
          when 'registration' then 'Registration'
          when 'checkin' then 'Check-in'
          when 'teams' then 'Team changes'
          when 'instructions' then 'Instructions'
          when 'sessions' then 'Session sign-ups'
          when 'submissions' then 'Submissions'
          when 'judging' then 'Judging'
          when 'voting' then 'Popular vote'
          when 'results' then 'Results'
          when 'gallery' then 'Project gallery'
          else initcap(replace(replace(w.key, '-', ' '), '.', ' '))
        end as label,
        -- windows have no id of their own; this one is stable per event and key
        md5(w.event_id::text || ':' || w.key)::uuid as subject
      from public.event_windows w
      where w.override is null and w.opens_at > now()
    ) x
    join public.events e on e.id = x.event_id
    where x.mins > 0
      and x.opens_at <= now() + make_interval(mins => x.mins)
      and not exists (select 1 from private.reminders_sent r
        where r.kind = 'window.reminder' and r.subject = x.subject and r.stamp = x.opens_at)
  loop
    insert into private.reminders_sent (kind, subject, stamp)
    values ('window.reminder', v_row.subject, v_row.opens_at);
    v_count := v_count + private.notify(
      array(select user_id from public.event_members
        where event_id = v_row.event_id and status = 'active'),
      v_row.event_id, 'window.reminder', v_row.label || ' opens soon',
      'Opens ' || to_char(v_row.opens_at at time zone v_row.timezone, 'FMDay FMHH12:MI AM') || '.',
      '/events/' || v_row.slug,
      jsonb_build_object('window', v_row.key,
        'when', to_char(v_row.opens_at at time zone v_row.timezone, 'FMDay FMHH12:MI AM')));
  end loop;
  return v_count;
end;
$$;
revoke execute on function private.remind_windows() from anon, authenticated;

select cron.schedule('bogey-submission-reminders', '*/10 * * * *', 'select private.remind_submission_deadlines()');
select cron.schedule('bogey-session-reminders', '* * * * *', 'select private.remind_sessions()');
select cron.schedule('bogey-window-reminders', '* * * * *', 'select private.remind_windows()');
select cron.schedule('bogey-announcement-notices', '* * * * *', 'select private.deliver_due_announcements()');
select cron.schedule('bogey-settle-submissions', '* * * * *', 'select private.settle_submissions()');
select cron.schedule('bogey-window-changes', '* * * * *', 'select private.announce_window_changes()');
select cron.schedule('bogey-due-announcements', '* * * * *', 'select private.broadcast_due_announcements()');
select cron.schedule('bogey-prune-audit', '17 4 * * *', 'select private.prune_audit_log()');
