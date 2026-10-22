create table public.submission_forms (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9-]*$'),
  title text not null check (length(title) between 1 and 80),
  description_md text not null default '',
  window_key text not null default 'submissions',
  judged boolean not null default true,
  sort smallint not null default 0,
  unique (event_id, key),
  unique (event_id, id)
);

-- A form with no rows here is for everyone; otherwise only teams in these divisions submit it.
create table public.submission_form_divisions (
  event_id uuid not null,
  form_id uuid not null,
  division_id uuid not null,
  primary key (form_id, division_id),
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade,
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete cascade
);

create table public.submission_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  form_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(label) between 1 and 200),
  help text,
  kind text not null default 'text' check (
    kind in ('text', 'longtext', 'markdown', 'url', 'video', 'file', 'drive', 'select', 'boolean', 'number')
    or kind ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9_-]*$'
  ),
  required boolean not null default false,
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  sort smallint not null default 0,
  unique (form_id, key),
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade
);
create index submission_items_form_idx on public.submission_items (form_id, sort);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  form_id uuid not null,
  team_id uuid not null,
  title text not null default '' check (length(title) <= 120),
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  status public.submission_status not null default 'draft',
  is_public boolean not null default true,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles on delete set null,
  deletion_requested_at timestamptz,
  deletion_requested_by uuid references public.profiles on delete set null,
  table_label text check (length(table_label) between 1 and 20),
  card_size text not null default 'standard' check (card_size in ('compact', 'standard', 'large')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, team_id),
  unique (event_id, id),
  foreign key (event_id, form_id) references public.submission_forms (event_id, id) on delete cascade,
  foreign key (event_id, team_id) references public.teams (event_id, id) on delete cascade
);
create index submissions_status_idx on public.submissions (event_id, status);
create index submissions_event_id_team_id_fk_idx on public.submissions (event_id, team_id);

create trigger submissions_touch before update on public.submissions
  for each row execute function private.touch_updated_at();

create function private.submission_window_open(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select private.window_open(f.event_id, f.window_key) from public.submission_forms f where f.id = p_form
  ), false);
$$;
grant execute on function private.submission_window_open(uuid) to authenticated;

create function private.team_write_allowed(p_form uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.submission_window_open(p_form) and coalesce((
    select private.network_allowed(f.event_id) and private.check_in_ok(f.event_id)
    from public.submission_forms f where f.id = p_form
  ), false);
$$;
grant execute on function private.team_write_allowed(uuid) to authenticated;

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

create function private.add_default_submission_form(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form uuid;
begin
  insert into public.submission_forms (event_id, key, title, description_md)
  values (p_event, 'project', 'Project', 'Describe your project and why it''s awesome.')
  returning id into v_form;
  insert into public.submission_items (event_id, form_id, key, label, help, kind, required, sort) values
    (p_event, v_form, 'tagline', 'Tagline', 'One line about what it does.', 'text', false, 0),
    (p_event, v_form, 'description', 'Description', 'What it does, how you built it, what''s next.', 'markdown', true, 1),
    (p_event, v_form, 'repo', 'Code', null, 'url', false, 2),
    (p_event, v_form, 'demo', 'Live demo', null, 'url', false, 3),
    (p_event, v_form, 'video', 'Video', 'A short demo video.', 'video', false, 4);
end;
$$;

create function private.guard_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and (new.status, new.submitted_at, new.submitted_by, new.team_id, new.event_id, new.form_id,
          new.deletion_requested_at, new.deletion_requested_by, new.table_label)
       is distinct from (old.status, old.submitted_at, old.submitted_by, old.team_id, old.event_id, old.form_id,
          old.deletion_requested_at, old.deletion_requested_by, old.table_label) then
    raise exception 'use submit_project or delete_submission to change a submission''s status' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and new.card_size is distinct from old.card_size then
    raise exception 'use set_gallery_look to change how your project looks in the gallery' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and new.is_public is distinct from old.is_public
     and (private.event_setting(old.event_id, 'submissions') ->> 'publicToggle')::boolean is false then
    raise exception 'your organizers don''t let teams change gallery visibility' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger submissions_guard_update before update on public.submissions
  for each row execute function private.guard_submission_update();

create function private.guard_file_banner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(new.event_id)
     and ((tg_op = 'INSERT' and new.is_banner) or (tg_op = 'UPDATE' and new.is_banner is distinct from old.is_banner)) then
    raise exception 'use set_gallery_look to pick a gallery banner' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger submission_files_guard_banner before insert or update on public.submission_files
  for each row execute function private.guard_file_banner();

create function private.audit_submission_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and 'disqualified' in (new.status, old.status) then
    perform private.audit(new.event_id,
      case when new.status = 'disqualified' then 'submission.disqualified' else 'submission.reinstated' end,
      'submission', new.id, jsonb_build_object('title', new.title));
  end if;
  return new;
end;
$$;

create trigger submissions_audit_status after update of status on public.submissions
  for each row execute function private.audit_submission_status();

create table public.submission_tracks (
  event_id uuid not null,
  submission_id uuid not null,
  track_id uuid not null,
  primary key (submission_id, track_id),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade,
  foreign key (event_id, track_id) references public.tracks (event_id, id) on delete cascade
);

alter table public.tracks add foreign key (event_id, form_id)
  references public.submission_forms (event_id, id) on delete set null (form_id);
create index tracks_event_id_form_id_fk_idx on public.tracks (event_id, form_id);

create table public.submission_files (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  item_key text not null,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  caption text,
  sort smallint not null default 0,
  is_banner boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create unique index submission_files_banner_idx on public.submission_files (submission_id) where is_banner;

create function private.submission_problems(p_submission uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when s.title = '' then 'Title' end,
    case when (select count(*) from public.team_members tm where tm.team_id = s.team_id) < e.team_size_min
      then format('At least %s team members', e.team_size_min) end
  ], null) || coalesce((
    select array_agg(i.label order by i.sort)
    from public.submission_items i
    where i.form_id = s.form_id and i.required and i.kind <> 'file'
      and coalesce(s.answers ->> i.key, '') in ('', 'false')
  ), '{}') || coalesce((
    select array_agg(i.label order by i.sort)
    from public.submission_items i
    where i.form_id = s.form_id and i.required and i.kind = 'file'
      and not exists (
        select 1 from public.submission_files sf where sf.submission_id = s.id and sf.item_key = i.key
      )
  ), '{}')
  from public.submissions s
  join public.events e on e.id = s.event_id
  where s.id = p_submission;
$$;
grant execute on function private.submission_problems(uuid) to authenticated;

create function public.submit_project(p_submission uuid, p_submit boolean default true)
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

create function private.submission_deletion(p_event uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.event_setting(p_event, 'submissions') ->> 'deletion';
$$;

create function public.delete_submission(p_submission uuid)
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
    if not private.network_allowed(v_row.event_id) then
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
grant execute on function public.delete_submission(uuid) to authenticated;

create function public.cancel_submission_deletion(p_submission uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.submissions;
begin
  select * into v_row from public.submissions where id = p_submission for update;
  if v_row.id is null
     or not (private.is_team_member(v_row.team_id) or private.can_manage(v_row.event_id)) then
    raise exception 'not your submission' using errcode = '42501';
  end if;
  if v_row.deletion_requested_at is null then
    return;
  end if;
  update public.submissions
  set deletion_requested_at = null, deletion_requested_by = null
  where id = p_submission;
  if not private.is_team_member(v_row.team_id) then
    perform private.audit(v_row.event_id, 'submission.deletion_declined', 'submission', v_row.id,
      jsonb_build_object('title', v_row.title));
  end if;
end;
$$;
grant execute on function public.cancel_submission_deletion(uuid) to authenticated;

create function public.save_submission_form(p_event uuid, p_form jsonb, p_items jsonb)
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

create function private.settle_submissions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.submissions s set status = 'submitted', submitted_at = now()
  from public.submission_forms f
  where f.id = s.form_id
    and s.status = 'draft'
    and (private.event_setting(f.event_id, 'submissions') ->> 'autoSubmit')::boolean
    and exists (select 1 from public.event_windows w
      where w.event_id = f.event_id and w.key = f.window_key and w.closes_at is not null)
    and not private.window_open(f.event_id, f.window_key)
    and cardinality(private.submission_problems(s.id)) = 0;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create index submission_files_event_id_submission_id_fk_idx on public.submission_files (event_id, submission_id);
create index submission_form_divisions_event_id_form_id_fk_idx on public.submission_form_divisions (event_id, form_id);
create index submission_form_divisions_event_id_division_id_fk_idx on public.submission_form_divisions (event_id, division_id);
create index submission_items_event_id_form_id_fk_idx on public.submission_items (event_id, form_id);
create index submissions_event_id_form_id_fk_idx on public.submissions (event_id, form_id);
create index submission_tracks_event_id_submission_id_fk_idx on public.submission_tracks (event_id, submission_id);
create index submission_tracks_event_id_track_id_fk_idx on public.submission_tracks (event_id, track_id);
create index submissions_submitted_by_fk_idx on public.submissions (submitted_by);
create index submissions_deletion_requested_by_fk_idx on public.submissions (deletion_requested_by);

alter table public.submission_forms enable row level security;
alter table public.submission_items enable row level security;
alter table public.submission_form_divisions enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_tracks enable row level security;
alter table public.submission_files enable row level security;

create function private.can_read_submission(p_event uuid, p_team uuid, p_status public.submission_status, p_public boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_manage(p_event)
    or private.is_team_member(p_team)
    or (p_status = 'submitted' and private.has_permission(p_event, 'judging.score'))
    or (p_status = 'submitted' and p_public and private.window_open(p_event, 'gallery')
        and (private.is_public_event(p_event) or private.has_permission(p_event, 'event.view')));
$$;
grant execute on function private.can_read_submission(uuid, uuid, public.submission_status, boolean) to anon, authenticated;

create function private.gallery_open(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_public_event(p_event) and private.window_open(p_event, 'gallery');
$$;
grant execute on function private.gallery_open(uuid) to anon, authenticated;

create policy submission_forms_select on public.submission_forms for select to anon, authenticated
  using (
    (select private.has_permission(event_id, 'event.view'))
    or (select private.gallery_open(event_id))
  );
create policy submission_forms_write_insert on public.submission_forms for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy submission_forms_write_update on public.submission_forms for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy submission_forms_write_delete on public.submission_forms for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy submission_form_divisions_select on public.submission_form_divisions for select to anon, authenticated
  using (
    (select private.has_permission(event_id, 'event.view'))
    or (select private.gallery_open(event_id))
  );
create policy submission_form_divisions_write_insert on public.submission_form_divisions for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy submission_form_divisions_write_delete on public.submission_form_divisions for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy submission_items_select on public.submission_items for select to anon, authenticated
  using (
    (select private.has_permission(event_id, 'event.view'))
    or (select private.gallery_open(event_id))
  );
create policy submission_items_write_insert on public.submission_items for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy submission_items_write_update on public.submission_items for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy submission_items_write_delete on public.submission_items for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy submissions_select on public.submissions for select to anon, authenticated
  using (private.can_read_submission(event_id, team_id, status, is_public));
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
create policy submissions_update on public.submissions for update to authenticated
  using (
    (
      status <> 'disqualified'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
    )
    or
    ((select private.can_manage(event_id)))
  )
  with check (
    (
      status <> 'disqualified'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
    )
    or
    ((select private.can_manage(event_id)))
  );
create policy submissions_manage_delete on public.submissions for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy submission_tracks_select on public.submission_tracks for select to anon, authenticated
  using (exists (
    select 1 from public.submissions s where s.id = submission_id
      and private.can_read_submission(s.event_id, s.team_id, s.status, s.is_public)
  ));
create policy submission_tracks_write_insert on public.submission_tracks for insert to authenticated
  with check ((select private.can_manage(event_id)));
create policy submission_tracks_write_update on public.submission_tracks for update to authenticated
  using ((select private.can_manage(event_id)))
  with check ((select private.can_manage(event_id)));
create policy submission_tracks_write_delete on public.submission_tracks for delete to authenticated
  using ((select private.can_manage(event_id)));

create policy submission_files_select on public.submission_files for select to anon, authenticated
  using (exists (
    select 1 from public.submissions s where s.id = submission_id
      and private.can_read_submission(s.event_id, s.team_id, s.status, s.is_public)
  ));
create policy submission_files_write_insert on public.submission_files for insert to authenticated
  with check (exists (
    select 1 from public.submissions s where s.id = submission_id
      and (private.can_manage(s.event_id)
        or (private.is_team_member(s.team_id) and private.team_write_allowed(s.form_id)))
  ));
create policy submission_files_write_update on public.submission_files for update to authenticated
  using (exists (
    select 1 from public.submissions s where s.id = submission_id
      and (private.can_manage(s.event_id)
        or (private.is_team_member(s.team_id) and private.team_write_allowed(s.form_id)))
  ))
  with check (exists (
    select 1 from public.submissions s where s.id = submission_id
      and (private.can_manage(s.event_id)
        or (private.is_team_member(s.team_id) and private.team_write_allowed(s.form_id)))
  ));
create policy submission_files_write_delete on public.submission_files for delete to authenticated
  using (exists (
    select 1 from public.submissions s where s.id = submission_id
      and (private.can_manage(s.event_id)
        or (private.is_team_member(s.team_id) and private.team_write_allowed(s.form_id)))
  ));

create function public.save_prizes(p_event uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 40 then
    raise exception 'a prize list is an array of up to 40' using errcode = '22023';
  end if;
  delete from public.tracks
  where event_id = p_event
    and id not in (
      select (item ->> 'id')::uuid from jsonb_array_elements(p_items) item where item ->> 'id' is not null
    );
  get diagnostics v_removed = row_count;

  update public.tracks set name = id::text where event_id = p_event;
  insert into public.tracks (
    id, event_id, name, description_md, prize_md, sponsor_name, sponsor_logo_url,
    max_winners, opt_in, form_id, sort
  )
  select coalesce((item ->> 'id')::uuid, gen_random_uuid()), p_event, btrim(item ->> 'name'),
    coalesce(item ->> 'description_md', ''), coalesce(item ->> 'prize_md', ''),
    nullif(btrim(coalesce(item ->> 'sponsor_name', '')), ''),
    nullif(item ->> 'sponsor_logo_url', ''),
    coalesce((item ->> 'max_winners')::smallint, 1), coalesce((item ->> 'opt_in')::boolean, true),
    nullif(item ->> 'form_id', '')::uuid, (ordinality - 1)::smallint
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality)
  on conflict (id) do update set
    name = excluded.name, description_md = excluded.description_md, prize_md = excluded.prize_md,
    sponsor_name = excluded.sponsor_name, sponsor_logo_url = excluded.sponsor_logo_url,
    max_winners = excluded.max_winners, opt_in = excluded.opt_in, form_id = excluded.form_id,
    sort = excluded.sort;

  perform private.audit(p_event, 'prize.saved', 'event', p_event,
    jsonb_build_object('count', jsonb_array_length(p_items), 'removed', v_removed));
  return v_removed;
end;
$$;

create function public.set_submission_tracks(p_submission uuid, p_tracks uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_manager boolean;
  v_max integer;
  v_wanted uuid[] := coalesce((select array_agg(distinct t) from unnest(p_tracks) t), '{}');
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_manager := private.can_manage(v_sub.event_id);
  if not v_manager and not (private.is_team_member(v_sub.team_id) and private.team_write_allowed(v_sub.form_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(v_wanted) t
    where not exists (
      select 1 from public.tracks k
      where k.id = t and k.event_id = v_sub.event_id and (k.form_id is null or k.form_id = v_sub.form_id)
    )
  ) then
    raise exception 'that prize is not open to this submission' using errcode = '22023';
  end if;

  if v_manager then
    delete from public.submission_tracks where submission_id = p_submission and not (track_id = any (v_wanted));
  else
    if exists (
      select 1 from public.tracks k where k.id = any (v_wanted) and not k.opt_in
        and not exists (select 1 from public.submission_tracks l where l.submission_id = p_submission and l.track_id = k.id)
    ) then
      raise exception 'only organizers place entries in that prize' using errcode = '42501';
    end if;
    v_max := (private.event_setting(v_sub.event_id, 'submissions') ->> 'maxTracks')::integer;
    if v_max is not null and (select count(*) from public.tracks k where k.id = any (v_wanted) and k.opt_in) > v_max then
      raise exception 'a team can enter at most % prizes', v_max using errcode = '22023';
    end if;
    delete from public.submission_tracks l using public.tracks k
    where l.submission_id = p_submission and k.id = l.track_id and k.opt_in and not (l.track_id = any (v_wanted));
  end if;

  insert into public.submission_tracks (event_id, submission_id, track_id)
  select v_sub.event_id, p_submission, t from unnest(v_wanted) t
  on conflict do nothing;

  perform private.audit(v_sub.event_id, 'submission.tracks_set', 'submission', p_submission,
    jsonb_build_object('count', cardinality(v_wanted)));
end;
$$;

grant execute on function public.save_prizes(uuid, jsonb), public.set_submission_tracks(uuid, uuid[])
to authenticated;

create table public.votes (
  event_id uuid not null,
  submission_id uuid not null,
  voter_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (voter_id, submission_id),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index votes_event_id_submission_id_fk_idx on public.votes (event_id, submission_id);
alter table public.votes enable row level security;
create policy votes_select_own on public.votes for select to authenticated
  using (voter_id = (select auth.uid()) or (select private.can_manage(event_id)));

create function public.cast_vote(p_submission uuid)
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
  if not private.network_allowed(v_sub.event_id) then
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

create function public.retract_vote(p_submission uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.submissions where id = p_submission;
  if v_event is null or (select auth.uid()) is null or not private.window_open(v_event, 'voting') then
    raise exception 'voting is not open' using errcode = '42501';
  end if;
  delete from public.votes where submission_id = p_submission and voter_id = (select auth.uid());
  if found then
    perform private.audit(v_event, 'vote.retracted', 'submission', p_submission, '{}');
  end if;
end;
$$;

create function public.vote_counts(p_event uuid)
returns table (submission_id uuid, votes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    private.can_manage(p_event)
    or (
      private.can_view_event(p_event)
      and (
        coalesce((private.event_setting(p_event, 'voting') ->> 'showCounts')::boolean, false)
        or (private.window_open(p_event, 'results') and private.latest_publication(p_event) is not null)
      )
    )
  ) then
    return;
  end if;
  return query
  select v.submission_id, count(*) from public.votes v where v.event_id = p_event group by v.submission_id;
end;
$$;

grant execute on function public.cast_vote(uuid), public.retract_vote(uuid) to authenticated;
grant execute on function public.vote_counts(uuid) to anon, authenticated;

-- The gallery's look and its interactions. A team picks its banner (one of its image files) and card
-- size through set_gallery_look, which the organizers' gallery settings can switch off; likes and
-- comments are off until an organizer turns them on.
create function public.set_gallery_look(p_submission uuid, p_size text, p_banner uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_manager boolean;
  v_settings jsonb;
  v_current uuid;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_manager := private.can_manage(v_sub.event_id);
  if not v_manager and not (private.is_team_member(v_sub.team_id) and v_sub.status <> 'disqualified') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_size not in ('compact', 'standard', 'large') then
    raise exception 'unknown card size' using errcode = '22023';
  end if;
  if p_banner is not null and not exists (
    select 1 from public.submission_files f where f.id = p_banner and f.submission_id = p_submission
  ) then
    raise exception 'that banner isn''t one of this project''s files' using errcode = '22023';
  end if;
  v_settings := private.event_setting(v_sub.event_id, 'gallery');
  select id into v_current from public.submission_files where submission_id = p_submission and is_banner;
  if not v_manager then
    if v_current is distinct from p_banner and not coalesce((v_settings ->> 'teamBanners')::boolean, true) then
      raise exception 'your organizers choose the gallery banners' using errcode = '42501';
    end if;
    if v_sub.card_size is distinct from p_size and not coalesce((v_settings ->> 'teamSizes')::boolean, false) then
      raise exception 'your organizers choose the gallery card sizes' using errcode = '42501';
    end if;
  end if;

  update public.submission_files set is_banner = false where submission_id = p_submission and is_banner;
  if p_banner is not null then
    update public.submission_files set is_banner = true where id = p_banner;
  end if;
  update public.submissions set card_size = p_size where id = p_submission;
  perform private.audit(v_sub.event_id, 'submission.gallery_look_set', 'submission', p_submission,
    jsonb_build_object('size', p_size, 'banner', p_banner is not null));
end;
$$;

create table public.gallery_likes (
  event_id uuid not null,
  submission_id uuid not null,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, submission_id),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index gallery_likes_event_id_submission_id_fk_idx on public.gallery_likes (event_id, submission_id);
alter table public.gallery_likes enable row level security;
create policy gallery_likes_select_own on public.gallery_likes for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage(event_id)));

create table public.gallery_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  author_id uuid not null references public.profiles on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index gallery_comments_event_id_submission_id_fk_idx on public.gallery_comments (event_id, submission_id, created_at);
create index gallery_comments_author_id_fk_idx on public.gallery_comments (author_id);
alter table public.gallery_comments enable row level security;
create policy gallery_comments_select_own on public.gallery_comments for select to authenticated
  using (author_id = (select auth.uid()) or (select private.can_manage(event_id)));

-- The public project a visitor is reacting to, and that the event's gallery settings allow it
create function private.gallery_target(p_submission uuid, p_setting text)
returns public.submissions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or v_sub.status <> 'submitted' or not v_sub.is_public
     or not private.gallery_open(v_sub.event_id) then
    raise exception 'that project isn''t in the gallery' using errcode = '22023';
  end if;
  if not coalesce((private.event_setting(v_sub.event_id, 'gallery') ->> p_setting)::boolean, false) then
    raise exception 'the organizers haven''t turned this on' using errcode = '42501';
  end if;
  return v_sub;
end;
$$;
revoke execute on function private.gallery_target(uuid, text) from anon, authenticated;

create function public.set_gallery_like(p_submission uuid, p_like boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.submissions;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  v_sub := private.gallery_target(p_submission, 'likes');
  if p_like then
    insert into public.gallery_likes (event_id, submission_id, user_id)
    values (v_sub.event_id, p_submission, v_uid)
    on conflict do nothing;
  else
    delete from public.gallery_likes where submission_id = p_submission and user_id = v_uid;
  end if;
end;
$$;

create function public.post_gallery_comment(p_submission uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.submissions;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  v_sub := private.gallery_target(p_submission, 'comments');
  if length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'a comment is 1 to 1000 characters' using errcode = '22023';
  end if;
  insert into public.gallery_comments (event_id, submission_id, author_id, body)
  values (v_sub.event_id, p_submission, v_uid, btrim(p_body))
  returning id into v_id;
  perform private.audit(v_sub.event_id, 'gallery.comment_posted', 'submission', p_submission, '{}');
  return v_id;
end;
$$;

create function public.delete_gallery_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gallery_comments;
begin
  select * into v_row from public.gallery_comments where id = p_comment;
  if v_row.id is null then
    return;
  end if;
  if v_row.author_id is distinct from (select auth.uid()) and not private.can_manage(v_row.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.gallery_comments where id = p_comment;
  perform private.audit(v_row.event_id, 'gallery.comment_removed', 'submission', v_row.submission_id, '{}');
end;
$$;

-- Likes and comments per project, only where the organizers turned them on
create function public.gallery_engagement(p_event uuid)
returns table (submission_id uuid, likes bigint, comments bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'gallery');
  v_likes boolean := coalesce((v_settings ->> 'likes')::boolean, false);
  v_comments boolean := coalesce((v_settings ->> 'comments')::boolean, false);
begin
  if not private.gallery_open(p_event) or not (v_likes or v_comments) then
    return;
  end if;
  return query
  select s.id,
    case when v_likes then (select count(*) from public.gallery_likes l where l.submission_id = s.id) else 0 end,
    case when v_comments then (select count(*) from public.gallery_comments c where c.submission_id = s.id) else 0 end
  from public.submissions s
  where s.event_id = p_event and s.status = 'submitted' and s.is_public;
end;
$$;

create function public.gallery_thread(p_submission uuid)
returns table (id uuid, body text, created_at timestamptz, author_id uuid, author_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  select * into v_sub from public.submissions s where s.id = p_submission;
  if v_sub.id is null or v_sub.status <> 'submitted' or not v_sub.is_public
     or not private.gallery_open(v_sub.event_id)
     or not coalesce((private.event_setting(v_sub.event_id, 'gallery') ->> 'comments')::boolean, false) then
    return;
  end if;
  return query
  select c.id, c.body, c.created_at, c.author_id, p.display_name
  from public.gallery_comments c
  join public.profiles p on p.id = c.author_id
  where c.submission_id = p_submission
  order by c.created_at;
end;
$$;

grant execute on function public.set_gallery_look(uuid, text, uuid),
  public.set_gallery_like(uuid, boolean), public.post_gallery_comment(uuid, text),
  public.delete_gallery_comment(uuid) to authenticated;
grant execute on function public.gallery_engagement(uuid), public.gallery_thread(uuid)
to anon, authenticated;
