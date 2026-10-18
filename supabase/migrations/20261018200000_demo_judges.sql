-- demo_judges: judging.demoJudges shows teams which judges sit on the panel they present to

-- When and where the caller's team presents, for each demo round its entries are slotted in; the
-- panel's judges too when judging.demoJudges is on.
create or replace function public.my_demo_slots(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'submissionId', sl.submission_id, 'title', s.title, 'roundName', r.name,
      'panelName', p.name, 'location', p.location, 'position', sl.position,
      'startsAt', p.starts_at + make_interval(mins => sl.position * p.slot_minutes),
      'ahead', case when p.now_position is null then null else greatest(sl.position - p.now_position, 0) end,
      'judges', case
        when coalesce((private.event_setting(p_event, 'judging') ->> 'demoJudges')::boolean, false) then (
          select coalesce(jsonb_agg(pr.display_name order by pr.display_name), '[]')
          from public.panel_judges pj join public.profiles pr on pr.id = pj.judge_id
          where pj.panel_id = p.id)
        else '[]'::jsonb
      end
    ) order by r.ordinal, sl.position), '[]')
  from public.panel_slots sl
  join public.submissions s on s.id = sl.submission_id
  join public.judging_panels p on p.id = sl.panel_id
  join public.judging_rounds r on r.id = sl.round_id and r.format = 'demos'
  where sl.event_id = p_event and private.is_team_member(s.team_id)
    and private.active_round(s.id) = sl.round_id;
$$;
