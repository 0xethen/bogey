-- event organizers read their organization's designs, to see what their event falls back to
create function private.manages_org_event(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.events e where e.org_id = p_org and private.can_manage(e.id));
$$;
grant execute on function private.manages_org_event(uuid) to authenticated;

create table public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  kind text not null check (kind in ('participation', 'award', 'judge', 'volunteer')),
  -- the design: background and positioned layers in millimetres (packages/utils/src/certificate.ts)
  layout jsonb not null check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 65536),
  orientation text not null default 'landscape' check (orientation in ('landscape', 'portrait')),
  updated_at timestamptz not null default now()
);
create unique index certificate_templates_event_kind_idx on public.certificate_templates (event_id, kind) where event_id is not null;
create unique index certificate_templates_org_kind_idx on public.certificate_templates (org_id, kind) where event_id is null;
create index certificate_templates_event_id_fk_idx on public.certificate_templates (event_id);
alter table public.certificate_templates enable row level security;
create policy certificate_templates_select on public.certificate_templates for select to authenticated
  using (
    (select private.is_org_admin(org_id))
    or (event_id is not null and (select private.can_manage(event_id)))
    or (event_id is null and (select private.manages_org_event(org_id)))
  );

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('participation', 'award', 'judge', 'volunteer')),
  award_id uuid references public.awards on delete set null,
  label text not null default '' check (length(label) <= 140),
  recipient_name text not null check (length(recipient_name) between 1 and 80),
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{10}$'),
  issued_by uuid references public.profiles on delete set null,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index certificates_person_idx on public.certificates
  (event_id, user_id, kind, coalesce(award_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index certificates_user_id_idx on public.certificates (user_id);
create index certificates_award_id_fk_idx on public.certificates (award_id);
create index certificates_issued_by_fk_idx on public.certificates (issued_by);
alter table public.certificates enable row level security;
create policy certificates_select on public.certificates for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage(event_id)));

select private.hide_suspended_org('public.certificate_templates');
select private.hide_suspended_org('public.certificates');

create function private.certificate_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_code text := '';
begin
  for v_i in 0 .. 9 loop
    v_code := v_code || substr(c_alphabet, (get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- what p_user can claim: nothing while certificates are off, and only the kinds the event gives
-- (certificates.kinds; every kind when it isn't set)
create function private.certificate_options(p_event uuid, p_user uuid)
returns table (kind text, award_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'certificates');
  v_kinds jsonb := case when jsonb_typeof(v_settings -> 'kinds') = 'array' then v_settings -> 'kinds' end;
  v_role public.event_role;
begin
  if not coalesce((v_settings ->> 'enabled')::boolean, false) then
    return;
  end if;
  select m.role into v_role from public.event_members m
  where m.event_id = p_event and m.user_id = p_user and m.status = 'active';
  if v_role is null then
    return;
  end if;
  if v_role = 'participant' then
    if (v_kinds is null or v_kinds ? 'participation') and (
      exists (select 1 from public.checkins c where c.event_id = p_event and c.user_id = p_user)
      or exists (
        select 1 from public.submissions s
        join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
        where s.event_id = p_event and s.status = 'submitted')) then
      return query select 'participation'::text, null::uuid, ''::text;
    end if;
    if (v_kinds is null or v_kinds ? 'award') and private.latest_publication(p_event) is not null then
      return query
      select 'award'::text, a.id, a.label
      from public.awards a
      join public.submissions s on s.id = a.submission_id
      join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
      where a.event_id = p_event;
    end if;
  elsif v_role = 'judge' and (v_kinds is null or v_kinds ? 'judge') then
    return query select 'judge'::text, null::uuid, ''::text;
  elsif v_role = 'staff' and (v_kinds is null or v_kinds ? 'volunteer') then
    return query select 'volunteer'::text, null::uuid, ''::text;
  end if;
end;
$$;
revoke execute on function private.certificate_options(uuid, uuid) from public, anon, authenticated;

create function private.issue_certificate(p_event uuid, p_user uuid, p_kind text, p_award uuid, p_label text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_name text;
begin
  select c.code into v_code from public.certificates c
  where c.event_id = p_event and c.user_id = p_user and c.kind = p_kind
    and c.award_id is not distinct from p_award and c.revoked_at is null;
  if v_code is not null then
    return v_code;
  end if;
  select display_name into v_name from public.profiles where id = p_user;
  delete from public.certificates c
  where c.event_id = p_event and c.user_id = p_user and c.kind = p_kind and c.award_id is not distinct from p_award;
  loop
    v_code := private.certificate_code();
    begin
      insert into public.certificates (event_id, user_id, kind, award_id, label, recipient_name, code, issued_by)
      values (p_event, p_user, p_kind, p_award, p_label, v_name, v_code, (select auth.uid()));
      return v_code;
    exception when unique_violation then
      if exists (select 1 from public.certificates c
        where c.event_id = p_event and c.user_id = p_user and c.kind = p_kind and c.award_id is not distinct from p_award) then
        raise;
      end if;
    end;
  end loop;
end;
$$;
revoke execute on function private.issue_certificate(uuid, uuid, text, uuid, text) from public, anon, authenticated;

create function public.my_certificates(p_event uuid)
returns table (kind text, award_id uuid, label text, code text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select o.kind, o.award_id, o.label,
    (select c.code from public.certificates c
     where c.event_id = p_event and c.user_id = (select auth.uid()) and c.kind = o.kind
       and c.award_id is not distinct from o.award_id and c.revoked_at is null)
  from private.certificate_options(p_event, (select auth.uid())) o
  order by o.kind, o.label;
end;
$$;
revoke execute on function public.my_certificates(uuid) from public, anon;
grant execute on function public.my_certificates(uuid) to authenticated;

create function public.claim_certificate(p_event uuid, p_kind text, p_award uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option record;
begin
  select * into v_option from private.certificate_options(p_event, (select auth.uid())) o
  where o.kind = p_kind and o.award_id is not distinct from p_award;
  if v_option.kind is null then
    raise exception 'there is no such certificate for you yet' using errcode = '42501';
  end if;
  return private.issue_certificate(p_event, (select auth.uid()), v_option.kind, v_option.award_id, v_option.label);
end;
$$;
revoke execute on function public.claim_certificate(uuid, text, uuid) from public, anon;
grant execute on function public.claim_certificate(uuid, text, uuid) to authenticated;

create function public.issue_certificates(p_event uuid, p_kinds text[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person record;
  v_option record;
  v_before text;
  v_count integer := 0;
  v_slug text;
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can issue certificates' using errcode = '42501';
  end if;
  select slug into v_slug from public.events where id = p_event;
  for v_person in select m.user_id from public.event_members m where m.event_id = p_event and m.status = 'active' loop
    for v_option in select * from private.certificate_options(p_event, v_person.user_id) o
      where p_kinds is null or o.kind = any (p_kinds)
    loop
      select c.code into v_before from public.certificates c
      where c.event_id = p_event and c.user_id = v_person.user_id and c.kind = v_option.kind
        and c.award_id is not distinct from v_option.award_id and c.revoked_at is null;
      if v_before is null then
        perform private.issue_certificate(p_event, v_person.user_id, v_option.kind, v_option.award_id, v_option.label);
        v_count := v_count + 1;
        perform private.notify(array[v_person.user_id], p_event, 'certificate.issued',
          'Your certificate is ready', '', '/events/' || v_slug || '/certificates', '{}');
      end if;
    end loop;
  end loop;
  perform private.audit(p_event, 'certificate.issued', 'event', p_event, jsonb_build_object('count', v_count));
  return v_count;
end;
$$;
revoke execute on function public.issue_certificates(uuid, text[]) from public, anon;
grant execute on function public.issue_certificates(uuid, text[]) to authenticated;

create function public.revoke_certificate(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
begin
  select event_id into v_event from public.certificates where id = p_id;
  if v_event is null or not private.can_manage(v_event) then
    raise exception 'only organizers can revoke certificates' using errcode = '42501';
  end if;
  update public.certificates set revoked_at = now() where id = p_id and revoked_at is null;
  perform private.audit(v_event, 'certificate.revoked', 'certificate', p_id, '{}');
end;
$$;
revoke execute on function public.revoke_certificate(uuid) from public, anon;
grant execute on function public.revoke_certificate(uuid) to authenticated;

-- where a design's uploads live in event-assets: <event>/certificates/<kind> or org/<org>/certificates/<kind>
create function private.certificate_folder(p_org uuid, p_event uuid, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_event is null then 'org/' || p_org::text else p_event::text end || '/certificates/' || p_kind;
$$;

-- the stored files a design points to (its background and image layers)
create function private.certificate_layout_paths(p_layout jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct p.path) filter (where p.path is not null), '{}')
  from (
    select p_layout #>> '{background,image,path}' as path
    union all
    select l #>> '{image,path}'
    from jsonb_array_elements(
      case when jsonb_typeof(p_layout -> 'layers') = 'array' then p_layout -> 'layers' else '[]' end) l
    where l ->> 'type' = 'image'
  ) p;
$$;

create function private.check_certificate_image(p_image jsonb, p_folder text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_url text := p_image ->> 'url';
  v_path text := p_image ->> 'path';
begin
  if p_image is null or jsonb_typeof(p_image) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_image) <> 'object' or v_url is null or length(v_url) > 500 then
    raise exception 'a picture needs an address' using errcode = '22023';
  end if;
  if v_path is null then
    if v_url !~ '^https://' then
      raise exception 'a picture''s address needs to start with https://' using errcode = '22023';
    end if;
  elsif not starts_with(v_path, p_folder || '/') or v_path ~ '\.\.|//'
    or v_url !~ '^https?://' or right(v_url, length(v_path) + 1) <> '/' || v_path then
    raise exception 'that picture belongs somewhere else' using errcode = '22023';
  end if;
end;
$$;

create function private.check_certificate_layout(p_layout jsonb, p_folder text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_layer jsonb;
begin
  if jsonb_typeof(p_layout) is distinct from 'object' or jsonb_typeof(p_layout -> 'layers') is distinct from 'array'
    or jsonb_typeof(p_layout -> 'background') is distinct from 'object' then
    raise exception 'that isn''t a certificate design' using errcode = '22023';
  end if;
  if jsonb_array_length(p_layout -> 'layers') > 40 then
    raise exception 'a certificate holds up to 40 layers' using errcode = '22023';
  end if;
  if pg_column_size(p_layout) > 65536 then
    raise exception 'that design is too big' using errcode = '22023';
  end if;
  perform private.check_certificate_image(p_layout #> '{background,image}', p_folder);
  for v_layer in select * from jsonb_array_elements(p_layout -> 'layers') loop
    if v_layer ->> 'type' is null or v_layer ->> 'type' not in ('text', 'image', 'qr')
      or jsonb_typeof(v_layer -> 'x') is distinct from 'number' or jsonb_typeof(v_layer -> 'y') is distinct from 'number'
      or jsonb_typeof(v_layer -> 'w') is distinct from 'number' or jsonb_typeof(v_layer -> 'h') is distinct from 'number' then
      raise exception 'a layer of that design is broken' using errcode = '22023';
    end if;
    if v_layer ->> 'type' = 'text' and length(coalesce(v_layer ->> 'text', '')) > 1000 then
      raise exception 'a text box holds up to 1000 characters' using errcode = '22023';
    end if;
    if v_layer ->> 'type' = 'image' then
      if jsonb_typeof(v_layer -> 'image') is distinct from 'object' then
        raise exception 'a picture needs an address' using errcode = '22023';
      end if;
      perform private.check_certificate_image(v_layer -> 'image', p_folder);
    end if;
  end loop;
end;
$$;

-- the same design pointing at another folder's copies of its files
create function private.move_certificate_image(p_image jsonb, p_from text, p_to text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_image) = 'object' and starts_with(coalesce(p_image ->> 'path', ''), p_from) then
      p_image || jsonb_build_object(
        'path', p_to || substr(p_image ->> 'path', length(p_from) + 1),
        'url', left(p_image ->> 'url', length(p_image ->> 'url') - length(p_image ->> 'path'))
          || p_to || substr(p_image ->> 'path', length(p_from) + 1))
    else p_image
  end;
$$;

create function private.move_certificate_layout(p_layout jsonb, p_from text, p_to text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_layout || jsonb_build_object(
    'background', coalesce(p_layout -> 'background', '{}') || jsonb_build_object(
      'image', private.move_certificate_image(p_layout #> '{background,image}', p_from, p_to)),
    'layers', (
      select coalesce(jsonb_agg(
        case when e.l ->> 'type' = 'image'
          then e.l || jsonb_build_object('image', private.move_certificate_image(e.l -> 'image', p_from, p_to))
          else e.l end order by e.i), '[]')
      from jsonb_array_elements(
        case when jsonb_typeof(p_layout -> 'layers') = 'array' then p_layout -> 'layers' else '[]' end
      ) with ordinality e(l, i)));
$$;

-- p_layout null goes back to the organization's design, or the standard one
create function public.save_certificate_template(
  p_org uuid, p_kind text, p_layout jsonb, p_orientation text default 'landscape', p_event uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_event is null then
    if not private.is_org_admin(p_org) then
      raise exception 'only organization admins can edit the organization''s certificates' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.events e where e.id = p_event and e.org_id = p_org) then
      raise exception 'that event is not in this organization' using errcode = '22023';
    end if;
    if not private.can_manage(p_event) then
      raise exception 'only organizers can edit certificates' using errcode = '42501';
    end if;
  end if;
  if p_layout is null then
    delete from public.certificate_templates t
    where t.org_id = p_org and t.event_id is not distinct from p_event and t.kind = p_kind;
  else
    perform private.check_certificate_layout(p_layout, private.certificate_folder(p_org, p_event, p_kind));
    if p_event is null then
      insert into public.certificate_templates (org_id, event_id, kind, layout, orientation)
      values (p_org, null, p_kind, p_layout, p_orientation)
      on conflict (org_id, kind) where event_id is null do update set
        layout = excluded.layout, orientation = excluded.orientation, updated_at = now();
    else
      insert into public.certificate_templates (org_id, event_id, kind, layout, orientation)
      values (p_org, p_event, p_kind, p_layout, p_orientation)
      on conflict (event_id, kind) where event_id is not null do update set
        layout = excluded.layout, orientation = excluded.orientation, updated_at = now();
    end if;
  end if;
  if p_event is not null then
    perform private.audit(p_event, 'certificate.template_saved', 'event', p_event, jsonb_build_object('kind', p_kind));
  else
    perform private.audit_org(p_org, 'certificate.template_saved', 'org', p_org, jsonb_build_object('kind', p_kind));
  end if;
end;
$$;
revoke execute on function public.save_certificate_template(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.save_certificate_template(uuid, text, jsonb, text, uuid) to authenticated;

-- gives an event its own copy of the organization's design; returns the files the caller copies
-- ({from, to} in event-assets) so deleting either never breaks the other
create function public.copy_certificate_template(p_event uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_source public.certificate_templates;
  v_from text;
  v_to text;
  v_files jsonb;
begin
  select org_id into v_org from public.events where id = p_event;
  if v_org is null or not private.can_manage(p_event) then
    raise exception 'only organizers can edit certificates' using errcode = '42501';
  end if;
  if exists (select 1 from public.certificate_templates t where t.event_id = p_event and t.kind = p_kind) then
    raise exception 'this event already has its own design' using errcode = '23505';
  end if;
  select * into v_source from public.certificate_templates t
  where t.org_id = v_org and t.event_id is null and t.kind = p_kind;
  if v_source.id is null then
    raise exception 'the organization has no design for these yet' using errcode = 'P0002';
  end if;
  v_from := private.certificate_folder(v_org, null, p_kind) || '/';
  v_to := private.certificate_folder(v_org, p_event, p_kind) || '/';
  select coalesce(jsonb_agg(jsonb_build_object('from', p, 'to', v_to || substr(p, length(v_from) + 1))), '[]')
  into v_files
  from unnest(private.certificate_layout_paths(v_source.layout)) p
  where starts_with(p, v_from);
  insert into public.certificate_templates (org_id, event_id, kind, layout, orientation)
  values (v_org, p_event, p_kind, private.move_certificate_layout(v_source.layout, v_from, v_to), v_source.orientation);
  perform private.audit(p_event, 'certificate.template_saved', 'event', p_event,
    jsonb_build_object('kind', p_kind, 'from', 'org'));
  return v_files;
end;
$$;
revoke execute on function public.copy_certificate_template(uuid, text) from public, anon;
grant execute on function public.copy_certificate_template(uuid, text) to authenticated;

-- files the app removes through the Storage API (SQL can't delete the stored bytes)
create table private.storage_orphans (
  bucket text not null,
  path text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, path)
);

-- a saved design lists what it no longer points to: files the old version used, and uploads in its
-- folder nothing used for a day (an edit that was discarded); a deleted design lists its folder
create function private.certificate_template_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text[] := '{}';
  v_new text[] := '{}';
  v_folder text;
begin
  if tg_op <> 'INSERT' then
    v_old := private.certificate_layout_paths(old.layout);
    v_folder := private.certificate_folder(old.org_id, old.event_id, old.kind);
  end if;
  if tg_op <> 'DELETE' then
    v_new := private.certificate_layout_paths(new.layout);
    v_folder := private.certificate_folder(new.org_id, new.event_id, new.kind);
  end if;
  insert into private.storage_orphans (bucket, path)
  select 'event-assets', p from unnest(v_old) p where p <> all (v_new)
  union
  select 'event-assets', o.name from storage.objects o
  where o.bucket_id = 'event-assets' and starts_with(o.name, v_folder || '/')
    and (tg_op = 'DELETE' or (o.name <> all (v_new) and o.created_at < now() - interval '1 day'))
  on conflict do nothing;
  return null;
end;
$$;
create trigger certificate_template_files
  after insert or update of layout or delete on public.certificate_templates
  for each row execute function private.certificate_template_files();

-- an organization's own folder (and its branding) goes with it
create function private.org_files_orphaned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.storage_orphans (bucket, path)
  select o.bucket_id, o.name from storage.objects o
  where (o.bucket_id = 'event-assets' and starts_with(o.name, 'org/' || old.id::text || '/'))
    or (o.bucket_id = 'branding' and starts_with(o.name, old.id::text || '/'))
  on conflict do nothing;
  return old;
end;
$$;
create trigger org_files_orphaned before delete on public.orgs
  for each row execute function private.org_files_orphaned();

-- hands the app up to p_limit queued files to remove, skipping any a design points to again
create function public.claim_storage_orphans(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_files jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'only the app removes stored files' using errcode = '42501';
  end if;
  with picked as (
    delete from private.storage_orphans q
    where (q.bucket, q.path) in (
      select s.bucket, s.path from private.storage_orphans s
      order by s.queued_at limit greatest(1, least(coalesce(p_limit, 500), 1000))
      for update skip locked)
    returning q.bucket, q.path
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', p.bucket, 'path', p.path)), '[]')
  into v_files
  from picked p
  where exists (select 1 from storage.objects o where o.bucket_id = p.bucket and o.name = p.path)
    and not exists (
      select 1 from public.certificate_templates t
      where p.bucket = 'event-assets' and p.path = any (private.certificate_layout_paths(t.layout)));
  return v_files;
end;
$$;
revoke execute on function public.claim_storage_orphans(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_orphans(integer) to service_role;

-- pg_cron pokes the app to remove queued files, signed like the email drain
create function private.sweep_storage_orphans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := private.instance_setting('tenancy') ->> 'appUrl';
  v_waiting integer;
  v_ts text := extract(epoch from now())::bigint::text;
begin
  select count(*) into v_waiting from private.storage_orphans;
  if v_url is null or v_waiting = 0 then
    return 0;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/storage/sweep',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-bogey-timestamp', v_ts,
      'x-bogey-signature', encode(extensions.hmac(v_ts, private.email_drain_secret(), 'sha256'), 'hex'))
  );
  return v_waiting;
end;
$$;
revoke execute on function private.sweep_storage_orphans() from anon, authenticated;

select cron.schedule('bogey-storage-sweep', '*/10 * * * *', 'select private.sweep_storage_orphans()');

create function private.certificate_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'code', c.code, 'name', c.recipient_name, 'kind', c.kind, 'label', c.label,
    'issuedAt', c.issued_at, 'revoked', c.revoked_at is not null,
    'event', e.name, 'eventSlug', e.slug, 'startsAt', e.starts_at, 'endsAt', e.ends_at, 'org', o.name,
    'layout', t.layout, 'orientation', coalesce(t.orientation, 'landscape'))
  from public.certificates c
  join public.events e on e.id = c.event_id
  join public.orgs o on o.id = e.org_id
  left join lateral (
    select ct.layout, ct.orientation from public.certificate_templates ct
    where ct.org_id = e.org_id and ct.kind = c.kind and (ct.event_id = e.id or ct.event_id is null)
    order by ct.event_id is null limit 1) t on true
  where c.id = p_id;
$$;
revoke execute on function private.certificate_json(uuid) from public, anon, authenticated;

create function public.verify_certificate(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.certificate_json(c.id) from public.certificates c where c.code = upper(btrim(p_code));
$$;
revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

create function public.event_certificates(p_event uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_manage(p_event) then
    raise exception 'only organizers can print certificates' using errcode = '42501';
  end if;
  return query
  select private.certificate_json(c.id) from public.certificates c
  where c.event_id = p_event and c.revoked_at is null order by c.recipient_name, c.kind;
end;
$$;
revoke execute on function public.event_certificates(uuid) from public, anon;
grant execute on function public.event_certificates(uuid) to authenticated;
