create function public.hello_applause(p_submission uuid, p_volume integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_round uuid;
begin
  select event_id into v_event from public.submissions where id = p_submission;
  if v_event is null or not private.has_permission(v_event, 'judging.score') then
    raise exception 'only judges can record applause' using errcode = '42501';
  end if;
  if p_volume not between 1 and 10 then
    raise exception 'volume is 1 to 10' using errcode = '22023';
  end if;
  v_round := private.active_round(p_submission);
  if v_round is null or not private.round_window_open(v_round) then
    raise exception 'judging is closed' using errcode = '42501';
  end if;
  perform private.set_ranking_input(v_round, p_submission, 'hello.applause', p_volume,
    jsonb_build_object('by', (select auth.uid())));
  update public.judge_assignments set status = 'done'
  where submission_id = p_submission and round_id = v_round and judge_id = (select auth.uid());
end;
$$;
revoke execute on function public.hello_applause(uuid, integer) from public, anon;
grant execute on function public.hello_applause(uuid, integer) to authenticated;
