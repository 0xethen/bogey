-- presentations: a panel remembers when its presenter started, for the presentation timer, and
-- panel_presentation gives the presentation screen each slot's team, division, members and tracks

alter table public.judging_panels add column if not exists now_started_at timestamptz;

-- Who's presenting: the panel's own judges move it along as teams finish, and organizers can too.
create or replace function public.set_panel_now(p_panel uuid, p_position integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_panel public.judging_panels;
begin
  select * into v_panel from public.judging_panels where id = p_panel;
  if v_panel.id is null or not (
    private.can_manage(v_panel.event_id)
    or exists (select 1 from public.panel_judges where panel_id = p_panel and judge_id = (select auth.uid()))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- setting the same slot again restarts its timer
  update public.judging_panels set now_position = case
    when p_position is null or p_position < 0 then null
    else least(p_position, coalesce((select max(position) + 1 from public.panel_slots where panel_id = p_panel), 0))
  end,
  now_started_at = case when p_position is null or p_position < 0 then null else now() end
  where id = p_panel;
end;
$$;

-- A panel's run of show for its presentation screen: each slot with its team, division, members and
-- prize tracks. Team names and members are left out for judges while judging is blind.
create function public.panel_presentation(p_panel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_panel public.judging_panels;
  v_hide boolean;
begin
  select * into v_panel from public.judging_panels where id = p_panel;
  if v_panel.id is null or not (
    private.can_manage(v_panel.event_id)
    or private.has_permission(v_panel.event_id, 'judging.score')
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_hide := private.hides_team_names(v_panel.event_id);
  return jsonb_build_object(
    'id', v_panel.id,
    'roundName', (select r.name from public.judging_rounds r where r.id = v_panel.round_id),
    'name', v_panel.name,
    'location', v_panel.location,
    'startsAt', v_panel.starts_at,
    'slotMinutes', v_panel.slot_minutes,
    'nowPosition', v_panel.now_position,
    'nowStartedAt', v_panel.now_started_at,
    'serverNow', now(),
    'canAdvance', private.can_manage(v_panel.event_id) or exists (
      select 1 from public.panel_judges where panel_id = v_panel.id and judge_id = (select auth.uid())),
    'judges', (
      select coalesce(jsonb_agg(pr.display_name order by pr.display_name), '[]')
      from public.panel_judges pj join public.profiles pr on pr.id = pj.judge_id
      where pj.panel_id = v_panel.id),
    'slots', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'submissionId', sl.submission_id,
          'position', sl.position,
          'title', s.title,
          'table', s.table_label,
          'teamName', case when v_hide then null else t.name end,
          'division', d.name,
          'members', case when v_hide then '[]'::jsonb else (
            select coalesce(jsonb_agg(pr.display_name order by tm.role, pr.display_name), '[]')
            from public.team_members tm join public.profiles pr on pr.id = tm.user_id
            where tm.team_id = t.id) end,
          'tracks', (
            select coalesce(jsonb_agg(tr.name order by tr.sort, tr.name), '[]')
            from public.submission_tracks st join public.tracks tr on tr.id = st.track_id
            where st.submission_id = s.id)
        ) order by sl.position), '[]')
      from public.panel_slots sl
      join public.submissions s on s.id = sl.submission_id
      join public.teams t on t.id = s.team_id
      left join public.divisions d on d.id = t.division_id
      where sl.panel_id = v_panel.id)
  );
end;
$$;

grant execute on function public.panel_presentation(uuid) to authenticated;
