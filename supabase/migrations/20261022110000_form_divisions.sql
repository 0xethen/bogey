-- form_divisions: submission forms go to everyone or to chosen divisions; teams can switch their division

-- A form with no rows here is for everyone; otherwise only teams in these divisions submit it.
create table public.submission_form_divisions (
  event_id uuid not null,
  form_id uuid not null,
  division_id uuid not null,
  primary key (form_id, division_id),
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade,
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete cascade
);

create index submission_form_divisions_event_id_form_id_fk_idx on public.submission_form_divisions (event_id, form_id);
create index submission_form_divisions_event_id_division_id_fk_idx on public.submission_form_divisions (event_id, division_id);
alter table public.submission_form_divisions enable row level security;
create policy submission_form_divisions_select on public.submission_form_divisions for select to anon, authenticated
  using (
    (select private.has_permission(event_id, 'event.view'))
    or (select private.gallery_open(event_id))
  );
create policy submission_form_divisions_write_insert on public.submission_form_divisions for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy submission_form_divisions_write_delete on public.submission_form_divisions for delete to authenticated
  using ((select private.can_manage(event_id)));

create function private.form_reaches_team(p_form uuid, p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.submission_form_divisions where form_id = p_form)
    or exists (
      select 1 from public.submission_form_divisions fd
      join public.teams t on t.division_id = fd.division_id
      where fd.form_id = p_form and t.id = p_team
    );
$$;
grant execute on function private.form_reaches_team(uuid, uuid) to authenticated;

drop policy submissions_insert on public.submissions;
create policy submissions_insert on public.submissions for insert to authenticated
  with check (
    (
      status = 'draft'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
      and (select private.form_reaches_team(form_id, team_id))
    )
    or
    ((select private.can_manage(event_id)))
  );

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
  if not private.network_allowed(v_row.event_id) then
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
grant execute on function public.submit_project(uuid, boolean) to authenticated;

create or replace function public.save_submission_form(p_event uuid, p_form jsonb, p_items jsonb)
returns public.submission_forms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.submission_forms;
  v_id uuid := nullif(p_form ->> 'id', '')::uuid;
  v_kind text;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can edit submission forms' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.submission_forms (event_id, key, title, description_md, window_key, judged, sort)
    values (p_event, p_form ->> 'key', p_form ->> 'title', coalesce(p_form ->> 'description_md', ''),
      coalesce(p_form ->> 'window_key', 'submissions'), coalesce((p_form ->> 'judged')::boolean, true),
      coalesce((select max(sort) + 1 from public.submission_forms where event_id = p_event), 0))
    returning * into v_form;
  else
    update public.submission_forms set
      title = p_form ->> 'title',
      description_md = coalesce(p_form ->> 'description_md', ''),
      window_key = coalesce(p_form ->> 'window_key', window_key),
      judged = coalesce((p_form ->> 'judged')::boolean, judged)
    where id = v_id and event_id = p_event
    returning * into v_form;
    if v_form.id is null then
      raise exception 'that form is gone' using errcode = 'P0002';
    end if;
  end if;

  if jsonb_typeof(p_form -> 'division_ids') = 'array' then
    delete from public.submission_form_divisions
    where form_id = v_form.id
      and division_id::text not in (select jsonb_array_elements_text(p_form -> 'division_ids'));
    insert into public.submission_form_divisions (event_id, form_id, division_id)
    select p_event, v_form.id, d.id
    from public.divisions d
    where d.event_id = p_event
      and d.id::text in (select jsonb_array_elements_text(p_form -> 'division_ids'))
    on conflict do nothing;
  end if;

  for v_kind in
    select distinct item ->> 'kind' from jsonb_array_elements(p_items) item
    where (item ->> 'kind') like '%.%'
  loop
    if not private.plugin_enabled(p_event, split_part(v_kind, '.', 1)) then
      raise exception 'turn on the % extension to use its item types', split_part(v_kind, '.', 1)
        using errcode = '22023';
    end if;
  end loop;

  delete from public.submission_items
  where form_id = v_form.id
    and key not in (select item ->> 'key' from jsonb_array_elements(p_items) item);

  insert into public.submission_items (event_id, form_id, key, label, help, kind, required, options, config, sort)
  select p_event, v_form.id, item ->> 'key', item ->> 'label', nullif(item ->> 'help', ''),
    item ->> 'kind', coalesce((item ->> 'required')::boolean, false),
    case when jsonb_typeof(item -> 'options') = 'array' then item -> 'options' end,
    coalesce(item -> 'config', '{}'), (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (form_id, key) do update set
    label = excluded.label, help = excluded.help, kind = excluded.kind, required = excluded.required,
    options = excluded.options, config = excluded.config, sort = excluded.sort;

  perform private.audit(p_event, 'form.saved', 'submission_form', v_form.id,
    jsonb_build_object('title', v_form.title, 'items', jsonb_array_length(p_items)));
  return v_form;
end;
$$;
grant execute on function public.save_submission_form(uuid, jsonb, jsonb) to authenticated;

-- Moves the caller's whole team (and its members) to another division, within the same rules as
-- choose_division: the target is one participants pick, and nobody is in a division that can't be left.
create function public.choose_team_division(p_event uuid, p_division uuid)
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
  perform private.require_network(p_event);
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
grant execute on function public.choose_team_division(uuid, uuid) to authenticated;
