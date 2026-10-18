-- problems are hidden once the contest is over unless the organizers keep them up; a team can wait for
-- its last solution to a problem to be judged before sending another (the default)

create or replace function private.challenges_settings(p_event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'scoring', 'icpc', 'penaltyMinutes', 20, 'freezeMinutes', 60, 'revealed', false,
    'languages', '', 'attemptLimit', 0, 'countCompileErrors', false, 'resultDetail', 'tests',
    'idKind', 'letter', 'problemOrder', 'id', 'separateErrors', false,
    'golfMeasure', 'characters', 'golfPoints', 'length', 'golfRankStep', 10, 'showErrors', true,
    'verificationRequired', false, 'problemsAfterContest', false, 'waitForJudging', true
  ) || coalesce(private.event_setting(p_event, 'plugin.challenges'), '{}');
$$;

create or replace function private.challenges_can_see_problems(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.challenges_is_jury(p_event)
    or (
      private.plugin_enabled(p_event, 'challenges')
      and private.has_permission(p_event, 'event.view')
      and (
        private.window_open(p_event, 'challenges.contest')
        or (
          private.challenges_started(p_event)
          and (private.challenges_settings(p_event) ->> 'problemsAfterContest')::boolean
        )
      )
    );
$$;

-- a team's solution waits while its last one to the same problem is being judged; challenges_submit holds
-- the team's lock while it inserts, so two at once can't both get through
create or replace function private.challenges_wait_for_judging()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.team_id is not null
    and (private.challenges_settings(new.event_id) ->> 'waitForJudging')::boolean
    and exists (
      select 1 from public.challenges_solutions s
      join public.challenges_judgings j on j.solution_id = s.id
      where s.team_id = new.team_id and s.problem_id = new.problem_id
        and j.valid and j.status in ('queued', 'running')
    ) then
    raise exception 'wait for your last solution to this problem to be judged' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists challenges_wait_for_judging on public.challenges_solutions;
create trigger challenges_wait_for_judging before insert on public.challenges_solutions
  for each row execute function private.challenges_wait_for_judging();
