-- A judge with no assignments scores any project; record "marked done" for them too.

create table public.sheet_completions (
  event_id uuid not null,
  judge_id uuid not null,
  submission_id uuid not null,
  round_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (judge_id, submission_id, round_id),
  foreign key (event_id, judge_id) references public.event_members (event_id, user_id) on delete cascade,
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, round_id) references public.judging_rounds (event_id, id) on delete cascade
);
create index sheet_completions_event_id_judge_id_fk_idx on public.sheet_completions (event_id, judge_id);
create index sheet_completions_event_id_submission_id_fk_idx on public.sheet_completions (event_id, submission_id);
create index sheet_completions_event_id_round_id_fk_idx on public.sheet_completions (event_id, round_id);

alter table public.sheet_completions enable row level security;
create policy sheet_completions_select on public.sheet_completions for select to authenticated
  using (judge_id = (select auth.uid()) or (select private.can_manage(event_id)));

create function public.set_sheet_done(p_submission uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_round uuid;
  v_judge uuid := (select auth.uid());
begin
  select event_id into v_event from public.submissions where id = p_submission and status = 'submitted';
  v_round := private.active_round(p_submission);
  if v_judge is null or v_event is null or v_round is null
    or not private.has_permission(v_event, 'judging.score')
    or private.has_conflict(v_judge, p_submission)
    or not private.round_window_open(v_round) then
    raise exception 'you can''t score this project' using errcode = '42501';
  end if;
  if p_done then
    insert into public.sheet_completions (event_id, judge_id, submission_id, round_id)
    values (v_event, v_judge, p_submission, v_round)
    on conflict do nothing;
  else
    delete from public.sheet_completions
    where judge_id = v_judge and submission_id = p_submission and round_id = v_round;
  end if;
end;
$$;

revoke execute on function public.set_sheet_done(uuid, boolean) from public, anon;
grant execute on function public.set_sheet_done(uuid, boolean) to authenticated;
