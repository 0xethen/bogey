create table public.event_members (
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role public.event_role not null default 'participant',
  division_id uuid,
  status public.member_status not null default 'active',
  added_by uuid references public.profiles on delete set null,
  identity_setup_at timestamptz,
  teams_left smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete set null (division_id)
);
create index event_members_user_id_idx on public.event_members (user_id);
create index event_members_division_idx on public.event_members (event_id, division_id);

create trigger event_members_touch before update on public.event_members
  for each row execute function private.touch_updated_at();

create function private.ensure_org_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'participant' or new.status <> 'active' then
    return new;
  end if;
  insert into public.org_members (org_id, user_id, invited_by)
  values (private.event_org(new.event_id), new.user_id, new.added_by)
  on conflict do nothing;
  return new;
end;
$$;

create trigger event_members_ensure_org_member
  after insert or update of role, status on public.event_members
  for each row execute function private.ensure_org_member();

create table public.roles (
  key text primary key check (key ~ '^([a-z]+|[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*)$'),
  label text not null check (length(btrim(label)) > 0),
  source text check (source is null or source ~ '^[a-z][a-z0-9-]*$'),
  check ((source is null) = (position('.' in key) = 0))
);

insert into public.roles (key, label) values
  ('participant', 'Participant'),
  ('staff', 'Staff'),
  ('judge', 'Judge'),
  ('organizer', 'Organizer');

create table public.role_permissions (
  role_key text not null references public.roles (key) on delete cascade,
  permission text not null check (permission ~ '^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'),
  primary key (role_key, permission)
);

insert into public.role_permissions (role_key, permission) values
  ('participant', 'event.view'),
  ('participant', 'event.compete'),
  ('staff', 'event.view'),
  ('staff', 'people.view'),
  ('judge', 'event.view'),
  ('judge', 'judging.score');

create table public.event_role_grants (
  event_id uuid not null,
  user_id uuid not null,
  role_key text not null references public.roles (key) on delete cascade check (position('.' in role_key) > 0),
  granted_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, role_key),
  foreign key (event_id, user_id) references public.event_members on delete cascade
);

create table public.onboarding_forms (
  event_id uuid primary key references public.events on delete cascade,
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create function private.bump_form_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fields is distinct from old.fields then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger onboarding_forms_version before update on public.onboarding_forms
  for each row execute function private.bump_form_version();

create function private.check_onboarding_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_field jsonb;
  v_key text;
  v_kind text;
  v_when jsonb;
  v_seen jsonb := '{}';
begin
  if jsonb_array_length(new.fields) > 50 then
    raise exception 'a form has at most 50 questions' using errcode = '22023';
  end if;
  for v_field in select value from jsonb_array_elements(new.fields) loop
    if jsonb_typeof(v_field) <> 'object' then
      raise exception 'a question must be an object' using errcode = '22023';
    end if;
    v_key := v_field ->> 'key';
    v_kind := v_field ->> 'kind';
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception '"%" is not a valid question key', v_key using errcode = '22023';
    end if;
    if v_seen ? v_key then
      raise exception 'two questions use the key "%"', v_key using errcode = '22023';
    end if;
    if length(coalesce(v_field ->> 'label', '')) not between 1 and 200 then
      raise exception 'question "%" needs a label of up to 200 characters', v_key using errcode = '22023';
    end if;
    if v_kind is null or v_kind not in (
      'text', 'longtext', 'select', 'multiselect', 'boolean', 'email', 'url', 'phone', 'date', 'number',
      'consent', 'file'
    ) then
      raise exception 'question "%" has an unknown type', v_key using errcode = '22023';
    end if;
    if v_kind in ('select', 'multiselect')
       and (jsonb_typeof(v_field -> 'options') is distinct from 'array' or jsonb_array_length(v_field -> 'options') = 0) then
      raise exception 'question "%" needs options', v_key using errcode = '22023';
    end if;
    if v_kind = 'consent' and length(btrim(coalesce(v_field ->> 'text', ''))) not between 1 and 5000 then
      raise exception 'question "%" needs the text people agree to', v_key using errcode = '22023';
    end if;
    v_when := v_field -> 'showWhen';
    if v_when is not null then
      if jsonb_typeof(v_when) <> 'object' or not (v_seen ? coalesce(v_when ->> 'field', '')) then
        raise exception 'question "%" can only depend on a question above it', v_key using errcode = '22023';
      end if;
      if v_when ? 'ageUnder' then
        if v_seen ->> (v_when ->> 'field') <> 'date' or jsonb_typeof(v_when -> 'ageUnder') <> 'number' then
          raise exception 'question "%" needs a date question for its age condition', v_key using errcode = '22023';
        end if;
      elsif jsonb_typeof(v_when -> 'in') is distinct from 'array' then
        raise exception 'question "%" needs the answers that show it', v_key using errcode = '22023';
      end if;
    end if;
    v_seen := v_seen || jsonb_build_object(v_key, v_kind);
  end loop;
  return new;
end;
$$;

create trigger onboarding_forms_check before insert or update of fields on public.onboarding_forms
  for each row execute function private.check_onboarding_fields();

create table public.invite_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  label text not null default '',
  auto_approve boolean not null default false,
  capacity integer check (capacity > 0),
  division_id uuid,
  opens_at timestamptz,
  closes_at timestamptz,
  disabled_at timestamptz,
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, id),
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete set null (division_id)
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  email extensions.citext not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  full_name text,
  user_id uuid references public.profiles on delete set null,
  source public.registration_source not null,
  role public.event_role not null default 'participant',
  invite_link_id uuid,
  division_id uuid,
  team_hint text,
  team_options text[] not null default '{}' check (cardinality(team_options) <= 10),
  session_picks uuid[] not null default '{}' check (cardinality(session_picks) <= 50),
  answers jsonb not null default '{}' check (jsonb_typeof(answers) = 'object'),
  form_version integer,
  status public.registration_status not null default 'pending',
  reviewed_by uuid references public.profiles on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, email),
  foreign key (event_id, invite_link_id) references public.invite_links (event_id, id) on delete set null (invite_link_id),
  foreign key (event_id, division_id) references public.divisions (event_id, id) on delete set null (division_id)
);
create index registrations_user_id_idx on public.registrations (user_id) where user_id is not null;
create index registrations_email_idx on public.registrations (email);
create index registrations_status_idx on public.registrations (event_id, status);

create trigger registrations_touch before update on public.registrations
  for each row execute function private.touch_updated_at();

create function private.prepare_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select id into new.user_id from auth.users where email = new.email::text;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and (select auth.uid()) is not null
     and coalesce(current_setting('bogey.promoting', true), '') <> 'on' then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

create trigger registrations_prepare before insert or update on public.registrations
  for each row execute function private.prepare_registration();

create function private.sync_registration_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    return new;
  end if;

  if new.status = 'approved' then
    insert into public.event_members (event_id, user_id, role, division_id, added_by)
    values (new.event_id, new.user_id, new.role, new.division_id, new.reviewed_by)
    on conflict (event_id, user_id) do update
      set status = 'active',
          role = excluded.role,
          division_id = coalesce(excluded.division_id, public.event_members.division_id);
    if new.team_hint is not null and new.role = 'participant' then
      perform private.apply_team_hint(new.event_id, new.user_id, new.team_hint);
    end if;
    if cardinality(new.session_picks) > 0 then
      perform private.apply_session_picks(new.event_id, new.user_id, new.session_picks);
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'approved' then
    update public.event_members set status = 'removed'
    where event_id = new.event_id and user_id = new.user_id;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform private.audit(new.event_id, 'registration.' || new.status::text, 'registration', new.id,
      jsonb_build_object('email', new.email));
  end if;
  return new;
end;
$$;

create trigger registrations_sync_membership after insert or update on public.registrations
  for each row execute function private.sync_registration_membership();

create function public.import_roster(p_event uuid, p_rows jsonb, p_notify boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_email extensions.citext;
  v_existing public.registrations;
  v_user uuid;
  v_added integer := 0;
  v_updated integer := 0;
  v_linked integer := 0;
  v_asked integer := 0;
  v_options text[];
  v_division uuid;
  v_sessions uuid[];
  v_answers jsonb;
  v_fields jsonb := coalesce((select f.fields from public.onboarding_forms f where f.event_id = p_event), '[]');
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can import people' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'import at most 2000 rows at a time' using errcode = '22023';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_email := lower(trim(v_row ->> 'email'))::extensions.citext;
    select * into v_existing from public.registrations where event_id = p_event and email = v_email;

    v_options := array(
      select distinct left(trim(o), 60) from jsonb_array_elements_text(
        case when jsonb_typeof(v_row -> 'teamOptions') = 'array' then v_row -> 'teamOptions' else '[]' end
      ) o
      where trim(o) <> ''
      limit 10
    );
    v_division := (
      select d.id from public.divisions d
      where d.event_id = p_event and d.id::text = v_row ->> 'division'
    );
    v_sessions := array(
      select s.id from public.event_sessions s
      where s.event_id = p_event
        and s.id::text in (select jsonb_array_elements_text(
          case when jsonb_typeof(v_row -> 'sessions') = 'array' then v_row -> 'sessions' else '[]' end
        ))
      limit 50
    );
    v_answers := case when jsonb_typeof(v_row -> 'answers') = 'object' then v_row -> 'answers' else '{}' end;
    if length(v_answers::text) > 20000 then
      raise exception 'answers for % are too long', v_email using errcode = '22023';
    end if;
    -- a column named like a registration question ("School", "Why did you join") is filed under
    -- that question's key, so it lines up with what people answer themselves or at the kiosk
    v_answers := (
      select coalesce(jsonb_object_agg(coalesce(q.key, a.key), a.value), '{}')
      from jsonb_each(v_answers) a
      left join lateral (
        select field ->> 'key' as key from jsonb_array_elements(v_fields) field
        where regexp_replace(lower(a.key), '[^a-z0-9]+', '', 'g') in (
          regexp_replace(lower(field ->> 'key'), '[^a-z0-9]+', '', 'g'),
          regexp_replace(lower(field ->> 'label'), '[^a-z0-9]+', '', 'g'))
        limit 1
      ) q on true
    );
    insert into public.registrations (
      event_id, email, full_name, source, role, team_hint, team_options, division_id,
      session_picks, answers, status
    )
    values (
      p_event, v_email, nullif(trim(v_row ->> 'name'), ''), 'import',
      coalesce(nullif(v_row ->> 'role', ''), 'participant')::public.event_role,
      case when cardinality(v_options) = 0 then nullif(trim(v_row ->> 'team'), '') end,
      v_options, v_division, v_sessions, v_answers, 'approved'
    )
    on conflict (event_id, email) do update set
      full_name = coalesce(excluded.full_name, public.registrations.full_name),
      role = excluded.role,
      team_hint = coalesce(excluded.team_hint, public.registrations.team_hint),
      team_options = case
        when cardinality(excluded.team_options) > 0 then excluded.team_options
        when excluded.team_hint is not null then '{}'
        else public.registrations.team_options end,
      division_id = coalesce(excluded.division_id, public.registrations.division_id),
      session_picks = case when cardinality(excluded.session_picks) > 0
        then excluded.session_picks else public.registrations.session_picks end,
      answers = public.registrations.answers || excluded.answers,
      status = 'approved'
    returning user_id into v_user;
    if cardinality(v_options) > 0 then v_asked := v_asked + 1; end if;

    if v_existing.id is null then v_added := v_added + 1; else v_updated := v_updated + 1; end if;
    if p_notify and v_existing.id is null then
      if v_user is not null then
        perform private.notify(array[v_user], p_event, 'registration.approved', 'You''re in', null,
          '/events/' || (select slug from public.events where id = p_event), '{}');
      else
        perform private.enqueue_email(private.event_org(p_event), p_event, null, v_email::text, 'event.invite',
          jsonb_build_object('event', (select name from public.events where id = p_event),
            'path', '/events/' || (select slug from public.events where id = p_event)));
      end if;
    end if;
    if v_user is not null then v_linked := v_linked + 1; end if;
  end loop;

  perform private.audit(p_event, 'registration.imported', 'event', p_event,
    jsonb_build_object('added', v_added, 'updated', v_updated, 'asked', v_asked));
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'linked', v_linked, 'asked', v_asked);
end;
$$;
grant execute on function public.import_roster(uuid, jsonb, boolean) to authenticated;

create function public.choose_team_option(p_event uuid, p_team text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations;
  v_choice text;
begin
  select * into v_reg from public.registrations
  where event_id = p_event and user_id = (select auth.uid()) and status = 'approved';
  if v_reg.id is null or cardinality(v_reg.team_options) = 0 then
    raise exception 'there is no team to choose' using errcode = 'P0001';
  end if;
  if p_team is not null then
    select o into v_choice from unnest(v_reg.team_options) o where lower(o) = lower(trim(p_team));
    if v_choice is null then
      raise exception 'pick one of the teams you were offered' using errcode = '22023';
    end if;
  end if;
  update public.registrations set team_options = '{}', team_hint = v_choice where id = v_reg.id;
  perform private.audit(p_event, 'registration.team_chosen', 'registration', v_reg.id,
    jsonb_build_object('team', v_choice));
end;
$$;
grant execute on function public.choose_team_option(uuid, text) to authenticated;

create function public.roster_overlaps(p_event uuid)
returns table (
  email extensions.citext, other_event_id uuid, other_event_name text,
  other_status public.registration_status, other_full_name text, full_name text, name_differs boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.email, o.event_id, e.name, o.status, o.full_name, r.full_name,
    coalesce(lower(trim(o.full_name)), '') <> coalesce(lower(trim(r.full_name)), '')
      and o.full_name is not null and r.full_name is not null
  from public.registrations r
  join public.registrations o on o.email = r.email and o.event_id <> r.event_id
  join public.events e on e.id = o.event_id
  where r.event_id = p_event
    and e.org_id = private.event_org(p_event)
    and private.can_manage(p_event)
  order by r.email, e.starts_at desc nulls last;
$$;
grant execute on function public.roster_overlaps(uuid) to authenticated;


create function public.complete_identity_setup(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_members set identity_setup_at = coalesce(identity_setup_at, now())
  where event_id = p_event and user_id = (select auth.uid()) and status = 'active';
  if not found then
    raise exception 'you are not a member of this event' using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.complete_identity_setup(uuid) to authenticated;


create function public.invite_link_view(p_token text)
returns table (
  event_id uuid, event_name text, event_slug extensions.citext, org_name text,
  label text, is_open boolean, form jsonb, starts_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.name, e.slug, o.name, l.label,
    l.disabled_at is null
      and (l.opens_at is null or l.opens_at <= now())
      and (l.closes_at is null or now() < l.closes_at)
      and (l.capacity is null or (
        select count(*) from public.registrations r where r.invite_link_id = l.id
      ) < l.capacity),
    private.fields_for(f.fields,
      coalesce(private.registrant_division(e.id, (select auth.uid())), l.division_id),
      private.held_tags(e.id, (select auth.uid()))),
    (e.starts_at at time zone e.timezone)::date
  from public.invite_links l
  join public.events e on e.id = l.event_id
  join public.orgs o on o.id = e.org_id
  left join public.onboarding_forms f on f.event_id = e.id
  where l.token = p_token and e.visibility <> 'draft' and o.status <> 'suspended';
$$;
grant execute on function public.invite_link_view(text) to anon, authenticated;

create function private.age_on(p_birth text, p_on date)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_birth !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return extract(year from age(p_on, p_birth::date))::integer;
exception when others then
  return null;
end;
$$;

create function private.clean_registration_answers(p_event uuid, p_fields jsonb, p_answers jsonb, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_on date := coalesce(
    (select (e.starts_at at time zone e.timezone)::date from public.events e where e.id = p_event),
    current_date);
  v_field jsonb;
  v_key text;
  v_label text;
  v_kind text;
  v_required boolean;
  v_when jsonb;
  v_ref jsonb;
  v_answer jsonb;
  v_text text;
  v_age integer;
  v_object record;
  v_shown jsonb := '{}';
  v_out jsonb := '{}';
begin
  if jsonb_typeof(p_answers) is distinct from 'object' then
    raise exception 'answers must be an object' using errcode = '22023';
  end if;
  for v_field in select value from jsonb_array_elements(coalesce(p_fields, '[]')) loop
    v_key := v_field ->> 'key';
    v_label := v_field ->> 'label';
    v_kind := v_field ->> 'kind';
    v_required := coalesce((v_field ->> 'required')::boolean, false);
    v_when := v_field -> 'showWhen';

    if v_when is not null then
      continue when not (v_shown ? (v_when ->> 'field'));
      v_ref := p_answers -> (v_when ->> 'field');
      if v_when ? 'ageUnder' then
        v_age := private.age_on(v_ref #>> '{}', v_on);
        continue when v_age is null or v_age >= (v_when ->> 'ageUnder')::integer;
      else
        continue when not coalesce(
          (jsonb_typeof(v_ref) in ('string', 'boolean') and (v_when -> 'in') @> jsonb_build_array(v_ref))
          or (jsonb_typeof(v_ref) = 'array' and exists (
            select 1 from jsonb_array_elements(v_ref) as picked
            where (v_when -> 'in') @> jsonb_build_array(picked))),
          false);
      end if;
    end if;
    v_shown := v_shown || jsonb_build_object(v_key, true);

    v_answer := p_answers -> v_key;
    if v_answer is null
       or v_answer = 'null'::jsonb
       or v_answer = '""'::jsonb
       or v_answer = '[]'::jsonb
       or (v_kind = 'boolean' and v_answer = 'false'::jsonb)
       or (v_kind = 'consent' and coalesce(v_answer ->> 'accepted', '') <> 'true') then
      if v_required then
        raise exception 'answer "%" is required', v_label using errcode = '23502';
      end if;
      continue;
    end if;

    if v_kind in ('text', 'longtext', 'email', 'url', 'phone', 'date', 'select') then
      if jsonb_typeof(v_answer) <> 'string' then
        raise exception 'answer "%" must be text', v_label using errcode = '22023';
      end if;
      v_text := btrim(v_answer #>> '{}');
    end if;

    case v_kind
      when 'text' then
        if length(v_text) > 500 then
          raise exception 'answer "%" is too long', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'longtext' then
        if length(v_text) > 5000 then
          raise exception 'answer "%" is too long', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'email' then
        if length(v_text) > 254 or v_text !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
          raise exception 'answer "%" should be an email address', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'url' then
        if length(v_text) > 2000 or v_text !~ '^https?://\S+$' then
          raise exception 'answer "%" should be a full http(s) link', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'phone' then
        if v_text !~ '^\+?[0-9 ()\-.]{6,24}$' or length(regexp_replace(v_text, '\D', '', 'g')) < 6 then
          raise exception 'answer "%" should be a phone number', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'date' then
        if private.age_on(v_text, v_on) is null or v_text < '1900-01-01' or v_text > '2100-12-31' then
          raise exception 'answer "%" should be a date', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'select' then
        if not ((v_field -> 'options') @> to_jsonb(v_text)) then
          raise exception 'answer "%" is not one of the options', v_label using errcode = '22023';
        end if;
        v_answer := to_jsonb(v_text);
      when 'multiselect' then
        if jsonb_typeof(v_answer) <> 'array' or jsonb_array_length(v_answer) > 50 or exists (
          select 1 from jsonb_array_elements(v_answer) as picked
          where jsonb_typeof(picked) <> 'string' or not ((v_field -> 'options') @> jsonb_build_array(picked))
        ) then
          raise exception 'answer "%" has a choice that is not an option', v_label using errcode = '22023';
        end if;
      when 'boolean' then
        if jsonb_typeof(v_answer) <> 'boolean' then
          raise exception 'answer "%" must be yes or no', v_label using errcode = '22023';
        end if;
      when 'number' then
        if jsonb_typeof(v_answer) <> 'number'
           or (v_field ? 'min' and (v_answer #>> '{}')::numeric < (v_field ->> 'min')::numeric)
           or (v_field ? 'max' and (v_answer #>> '{}')::numeric > (v_field ->> 'max')::numeric) then
          raise exception 'answer "%" is not an allowed number', v_label using errcode = '22023';
        end if;
      when 'consent' then
        v_answer := jsonb_build_object(
          'accepted', true,
          'at', now(),
          'textHash', encode(extensions.digest(coalesce(v_field ->> 'text', ''), 'sha256'), 'hex'));
      when 'file' then
        v_text := v_answer ->> 'path';
        if jsonb_typeof(v_answer) <> 'object' or v_text is null
           or v_text not like p_event::text || '/' || p_user::text || '/%' then
          raise exception 'answer "%" needs a file you uploaded', v_label using errcode = '22023';
        end if;
        select o.name, o.metadata into v_object from storage.objects o
        where o.bucket_id = 'registrations' and o.name = v_text;
        if v_object.name is null then
          raise exception 'answer "%" needs a file you uploaded', v_label using errcode = '22023';
        end if;
        v_answer := jsonb_build_object(
          'path', v_text,
          'name', left(coalesce(v_answer ->> 'name', 'file'), 200),
          'size', coalesce((v_object.metadata ->> 'size')::bigint, 0),
          'type', coalesce(v_object.metadata ->> 'mimetype', 'application/octet-stream'));
      else
        raise exception 'unknown question type "%"', v_kind using errcode = '22023';
    end case;

    v_out := v_out || jsonb_build_object(v_key, v_answer);
  end loop;
  if length(v_out::text) > 20000 then
    raise exception 'answers are too long' using errcode = '22023';
  end if;
  return v_out;
end;
$$;
revoke execute on function private.clean_registration_answers(uuid, jsonb, jsonb, uuid) from anon, authenticated;
revoke execute on function private.age_on(text, date) from anon, authenticated;

create function private.participants_approved(p_event uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.registrations
  where event_id = p_event and status = 'approved' and role = 'participant';
$$;
revoke execute on function private.participants_approved(uuid) from anon, authenticated;

create function private.event_full(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((private.event_setting(p_event, 'registration') ->> 'capacity')::integer, 0) > 0
    and private.participants_approved(p_event)
      >= (private.event_setting(p_event, 'registration') ->> 'capacity')::integer;
$$;
revoke execute on function private.event_full(uuid) from anon, authenticated;

create function private.promote_waitlist(p_event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting jsonb := private.event_setting(p_event, 'registration');
  v_capacity integer := coalesce((v_setting ->> 'capacity')::integer, 0);
  v_next public.registrations;
  v_count integer := 0;
begin
  if v_capacity = 0 or coalesce((v_setting ->> 'autoPromote')::boolean, false) is not true then
    return 0;
  end if;
  perform set_config('bogey.promoting', 'on', true);
  while private.participants_approved(p_event) < v_capacity loop
    select * into v_next from public.registrations
    where event_id = p_event and status = 'waitlisted' and role = 'participant'
    order by created_at, id
    limit 1
    for update skip locked;
    exit when not found;
    update public.registrations set status = 'approved' where id = v_next.id;
    perform private.audit(p_event, 'registration.promoted', 'registration', v_next.id,
      jsonb_build_object('email', v_next.email));
    v_count := v_count + 1;
  end loop;
  perform set_config('bogey.promoting', '', true);
  return v_count;
end;
$$;
revoke execute on function private.promote_waitlist(uuid) from anon, authenticated;

create function private.registrations_promote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'approved' and old.role = 'participant' then
    if tg_op = 'DELETE' or new.status <> 'approved' or new.role <> 'participant' then
      perform private.promote_waitlist(old.event_id);
    end if;
  end if;
  return null;
end;
$$;
create trigger registrations_promote after update or delete on public.registrations
  for each row execute function private.registrations_promote();

create function private.settings_promote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope = 'event' and new.namespace = 'registration' then
    perform private.promote_waitlist(new.event_id);
  end if;
  return null;
end;
$$;
create trigger settings_promote after insert or update on public.settings
  for each row execute function private.settings_promote();

create function private.notify_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_kind text;
  v_title text;
  v_note text := nullif(coalesce(current_setting('bogey.review_note', true), ''), '');
begin
  if new.user_id is null or new.source = 'import' or (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select slug into v_slug from public.events where id = new.event_id;
  select k, t into v_kind, v_title from (values
    ('pending', 'registration.received', 'Registration received'),
    ('approved', 'registration.approved', 'Registration approved'),
    ('rejected', 'registration.rejected', 'Registration declined'),
    ('waitlisted', 'registration.waitlisted', 'You''re on the waitlist')
  ) as m (s, k, t) where m.s = new.status::text;
  if v_kind is null then
    return null;
  end if;
  perform private.notify(array[new.user_id], new.event_id, v_kind, v_title, v_note,
    '/events/' || v_slug, jsonb_build_object('note', coalesce(v_note, '')));
  return null;
end;
$$;
create trigger registrations_notify after insert or update of status on public.registrations
  for each row execute function private.notify_registration();

create function public.register_for_event(
  p_event uuid, p_answers jsonb default '{}', p_token text default null, p_full_name text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email extensions.citext;
  v_link public.invite_links;
  v_form public.onboarding_forms;
  v_mode text := private.event_setting(p_event, 'registration') ->> 'mode';
  v_status public.registration_status;
  v_answers jsonb;
  v_row public.registrations;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;

  if p_token is not null then
    select * into v_link from public.invite_links where token = p_token and event_id = p_event;
    if v_link.id is null or not (select is_open from public.invite_link_view(p_token)) then
      raise exception 'this invite link is closed' using errcode = 'P0001';
    end if;
    v_status := case when v_link.auto_approve then 'approved' else 'pending' end;
  else
    if not private.can_view_event(p_event) or not private.window_open(p_event, 'registration') then
      raise exception 'registration is closed' using errcode = 'P0001';
    end if;
    if v_mode = 'invite' then
      raise exception 'this event is invite-only' using errcode = 'P0001';
    end if;
    v_status := case when v_mode = 'open' then 'approved' else 'pending' end;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event::text, 0));
  if private.event_full(p_event) and not exists (
    select 1 from public.registrations where event_id = p_event and email = v_email and status = 'approved'
  ) then
    v_status := 'waitlisted';
  end if;

  select * into v_form from public.onboarding_forms where event_id = p_event;
  v_answers := private.clean_registration_answers(p_event,
    private.fields_for(v_form.fields,
      coalesce(private.registrant_division(p_event, v_uid), v_link.division_id),
      private.held_tags(p_event, v_uid)),
    p_answers, v_uid);

  insert into public.registrations (
    event_id, email, full_name, user_id, source, invite_link_id, division_id,
    answers, form_version, status
  )
  values (
    p_event, v_email, p_full_name, v_uid,
    (case when v_link.id is null then 'self' else 'link' end)::public.registration_source,
    v_link.id, v_link.division_id, v_answers, v_form.version, v_status
  )
  on conflict (event_id, email) do update set
    answers = excluded.answers,
    form_version = excluded.form_version,
    status = case
      when public.registrations.status in ('rejected', 'approved') then public.registrations.status
      else excluded.status
    end
  returning * into v_row;

  return v_row;
end;
$$;
grant execute on function public.register_for_event(uuid, jsonb, text, text) to authenticated;

create function public.withdraw_registration(p_event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team uuid := private.my_team(p_event);
begin
  update public.registrations set status = 'withdrawn'
  where event_id = p_event and user_id = v_user and status in ('pending', 'approved', 'waitlisted');
  update public.event_members set status = 'removed'
  where event_id = p_event and user_id = v_user and role = 'participant' and status = 'active';
  if v_team is not null then
    delete from public.team_members where team_id = v_team and user_id = v_user;
    perform private.audit(p_event, 'team.left', 'team', v_team, '{}');
  end if;
end;
$$;
grant execute on function public.withdraw_registration(uuid) to authenticated;

create function public.review_registrations(
  p_event uuid, p_ids uuid[], p_status public.registration_status, p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.can_manage(p_event) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'registrations can be approved or declined' using errcode = '22023';
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'review at most 500 at a time' using errcode = '22023';
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    raise exception 'keep the note under 1000 characters' using errcode = '22023';
  end if;
  perform set_config('bogey.review_note', coalesce(trim(p_note), ''), true);
  update public.registrations set status = p_status
  where event_id = p_event and id = any (p_ids)
    and status in ('pending', 'waitlisted',
      (case p_status when 'approved' then 'rejected' else 'approved' end)::public.registration_status);
  get diagnostics v_count = row_count;
  perform set_config('bogey.review_note', '', true);
  perform private.audit(p_event, 'registration.bulk_reviewed', null, null,
    jsonb_build_object('status', p_status, 'count', v_count, 'note', coalesce(trim(p_note), '') <> ''));
  return v_count;
end;
$$;
grant execute on function public.review_registrations(uuid, uuid[], public.registration_status, text) to authenticated;

create index invite_links_event_id_division_id_fk_idx on public.invite_links (event_id, division_id);
create index registrations_event_id_division_id_fk_idx on public.registrations (event_id, division_id);
create index registrations_event_id_invite_link_id_fk_idx on public.registrations (event_id, invite_link_id);
create index event_members_added_by_fk_idx on public.event_members (added_by);
create index event_role_grants_granted_by_fk_idx on public.event_role_grants (granted_by);
create index event_role_grants_role_key_fk_idx on public.event_role_grants (role_key);
create index invite_links_created_by_fk_idx on public.invite_links (created_by);
create index registrations_reviewed_by_fk_idx on public.registrations (reviewed_by);

alter table public.event_members enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.event_role_grants enable row level security;
alter table public.onboarding_forms enable row level security;
alter table public.invite_links enable row level security;
alter table public.registrations enable row level security;

create policy event_members_insert on public.event_members for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy event_members_update on public.event_members for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy event_members_delete on public.event_members for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy roles_select on public.roles for select to anon, authenticated
  using (true);

create policy role_permissions_select on public.role_permissions for select to anon, authenticated
  using (true);

create policy event_role_grants_select on public.event_role_grants for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('people.view'))::uuid[])));
create policy event_role_grants_write_insert on public.event_role_grants for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy event_role_grants_write_update on public.event_role_grants for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy event_role_grants_write_delete on public.event_role_grants for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

-- Extension roles a member holds on top of their event role, replaced as a set.
create function public.set_role_grants(p_event uuid, p_user uuid, p_roles text[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'Only organizers can change roles.' using errcode = '42501';
  end if;
  delete from public.event_role_grants
  where event_id = p_event and user_id = p_user and role_key <> all (p_roles);
  insert into public.event_role_grants (event_id, user_id, role_key, granted_by)
  select p_event, p_user, r.key, (select auth.uid())
  from unnest(p_roles) as r (key)
  on conflict do nothing;
end;
$$;
revoke execute on function public.set_role_grants(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_role_grants(uuid, uuid, text[]) to authenticated;

create policy onboarding_forms_select on public.onboarding_forms for select to anon, authenticated
  using ((select private.can_view_event(event_id)));
create policy onboarding_forms_write_insert on public.onboarding_forms for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy onboarding_forms_write_update on public.onboarding_forms for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy onboarding_forms_write_delete on public.onboarding_forms for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy invite_links_manage on public.invite_links for all to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

create policy registrations_select on public.registrations for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id = any ((select private.events_where('people.view'))::uuid[]))
  );
create policy registrations_write_insert on public.registrations for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy registrations_write_update on public.registrations for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));
create policy registrations_write_delete on public.registrations for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

alter publication supabase_realtime add table public.registrations;
