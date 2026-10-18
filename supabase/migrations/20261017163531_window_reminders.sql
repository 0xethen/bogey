-- window_reminders: each window can remind the event's members before it opens (null: the event's
-- agenda.reminderMinutes, now 5 by default; 0: none); session reminders default to 5 minutes too

alter table public.event_windows
  add column if not exists reminder_minutes smallint check (reminder_minutes between 0 and 1440);


create or replace function private.setting_defaults(p_namespace text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce($json${"branding":{},"registration":{"signup":"invite","mode":"review","capacity":0,"autoPromote":true},"email":{},"tenancy":{},"accounts":{"deletionRequests":true,"requireAdminMfa":true,"portfolios":false,"deviceSignOut":false,"maxPasskeys":5},"signin":{"providers":[]},"audit":{"retentionDays":60},"access":{"allowedNetworks":[],"onlyUsers":[],"onlyTeams":[],"onlyDivisions":[]},"network":{"clientIpHeader":"x-forwarded-for","trustedHops":1,"trustedProxies":[]},"seo":{"indexing":true},"limits":{},"submissions":{"autoSubmit":false,"deletion":"allow","reminderHours":24,"publicToggle":false},"schedule":{"display":"list","hiddenWindows":[],"showEventTimezone":false},"agenda":{"kinds":[],"reminderMinutes":5},"home":{"layout":{"main":[{"id":"next-steps","type":"next-steps"},{"id":"agenda","type":"agenda"}],"aside":[{"id":"announcements","type":"announcements"},{"id":"facts","type":"facts"},{"id":"prizes","type":"prizes"},{"id":"about","type":"about"}]}},"tabs":{"items":[]},"identity":{"enabled":false},"chat":{"enabled":true,"staff":true,"participants":false,"judges":false,"copyTeam":true},"certificates":{"enabled":false},"announcements":{"toasts":true,"urgentStays":true,"postAs":"author","judges":false},"teams":{"disband":"captain","board":false,"switching":true,"askOrganizer":true,"creation":"participants","leaveLimit":0},"divisions":{"askOnJoin":true},"venue":{},"privacy":{"about":"members","agenda":"members","tracks":"public"},"about":{},"checkin":{"confirmName":true,"allowWalkIns":false,"badgeEmailHours":24,"requiredToCompete":false,"takers":["organizer","staff"]},"voting":{"enabled":false,"who":"participants","votesPerPerson":1,"ownTeam":false,"showCounts":false},"judging":{"blind":false,"showRankings":"organizers","normalize":"none","minJudges":2,"shareWithTeams":"feedback","judgeRubric":true,"teamRubric":false,"teamRubricShows":"name","deliberation":"assigned","flagGap":0,"holdFlagged":true},"plugins":{"enabled":[]}}$json$::jsonb -> p_namespace, '{}');
$$;

create or replace function private.notification_kind(p_kind text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select $json${"registration.received":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.received"},"registration.approved":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.approved"},"registration.rejected":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.rejected"},"registration.waitlisted":{"inApp":true,"email":true,"transactional":true,"emailKind":"registration.waitlisted"},"team.joined":{"inApp":true,"email":false,"transactional":false,"emailKind":"team.joined"},"team.left":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"},"team.request":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"team.invited":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"team.answered":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"},"judging.assigned":{"inApp":true,"email":true,"transactional":false,"emailKind":"judging.assigned"},"judging.advanced":{"inApp":true,"email":true,"transactional":false,"emailKind":"judging.advanced"},"submission.received":{"inApp":true,"email":true,"transactional":false,"emailKind":"submission.received"},"submission.deadline":{"inApp":true,"email":true,"transactional":false,"emailKind":"submission.deadline"},"results.published":{"inApp":true,"email":true,"transactional":false,"emailKind":"results.published"},"announcement":{"inApp":true,"email":false,"transactional":false,"emailKind":"announcement"},"checkin.badge":{"inApp":true,"email":true,"transactional":false,"emailKind":"checkin.badge"},"certificate.issued":{"inApp":true,"email":true,"transactional":false,"emailKind":"notification"},"session.reminder":{"inApp":true,"email":false,"transactional":false,"emailKind":"session.reminder"},"window.reminder":{"inApp":true,"email":false,"transactional":false,"emailKind":"notification"}}$json$::jsonb -> p_kind;
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
      insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort)
      select v_new.id, v_id, key, label, help, kind, required, options, config, sort
      from public.submission_items where form_id = r.id;
    end loop;
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
    insert into public.criteria (event_id, label, description_md, min_score, max_score, weight, sort, round_id, rubric_id)
    select v_new.id, label, description_md, min_score, max_score, weight, sort,
      (v_rounds ->> round_id::text)::uuid, (v_rubrics ->> rubric_id::text)::uuid
    from public.criteria where event_id = p_source;
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
        location, starts_at, ends_at, host_note, capacity, required, takes_attendance, visibility, sort)
      values (v_new.id, (v_slots ->> r.slot_id::text)::uuid, (v_categories ->> r.category_id::text)::uuid,
        r.kind, r.name, r.description_md, r.location, r.starts_at + v_shift, r.ends_at + v_shift,
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
    insert into public.onboarding_forms (event_id, fields)
    select v_new.id, fields from public.onboarding_forms where event_id = p_source;
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

create or replace function public.set_windows(p_event uuid, p_windows jsonb, p_label text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w jsonb;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  for w in select * from jsonb_array_elements(p_windows) loop
    insert into public.event_windows (event_id, key, opens_at, closes_at, override, reminder_minutes, updated_by)
    values (
      p_event,
      w ->> 'key',
      (w ->> 'opens_at')::timestamptz,
      (w ->> 'closes_at')::timestamptz,
      (w ->> 'override')::public.window_override,
      (w ->> 'reminder_minutes')::smallint,
      (select auth.uid())
    )
    on conflict (event_id, key) do update set
      opens_at = case when w ? 'opens_at' then excluded.opens_at else public.event_windows.opens_at end,
      closes_at = case when w ? 'closes_at' then excluded.closes_at else public.event_windows.closes_at end,
      override = case when w ? 'override' then excluded.override else public.event_windows.override end,
      reminder_minutes = case when w ? 'reminder_minutes' then excluded.reminder_minutes
        else public.event_windows.reminder_minutes end,
      updated_by = excluded.updated_by;
  end loop;

  perform private.audit(p_event, 'windows.changed', 'event', p_event,
    jsonb_build_object('label', p_label, 'windows', p_windows));
end;
$$;

create or replace function private.remind_windows()
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

select cron.schedule('bogey-window-reminders', '* * * * *', 'select private.remind_windows()');
