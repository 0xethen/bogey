-- The contest updates as it happens. A verdict, a rejudging or a problem changing sends 'changed' on
-- the public topic challenges:<event>, and pages read the scoreboard and problems again through RLS;
-- the message itself is empty. A team's own solutions also come through postgres_changes on
-- challenges_judgings, which RLS already limits to the team.

create or replace function private.challenges_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
begin
  perform realtime.send('{}'::jsonb, 'changed', 'challenges:' || v_event::text, false);
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists challenges_judgings_broadcast on public.challenges_judgings;
create trigger challenges_judgings_broadcast
  after insert or delete or update of status, verdict, score, valid, verified_at on public.challenges_judgings
  for each row execute function private.challenges_broadcast();

drop trigger if exists challenges_problems_broadcast on public.challenges_problems;
create trigger challenges_problems_broadcast after insert or update or delete on public.challenges_problems
  for each row execute function private.challenges_broadcast();
