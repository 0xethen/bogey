-- Certificate designs: certificate_templates keeps a layout (background and positioned layers) in
-- place of its Markdown wording; existing wording becomes stacked text boxes, so nothing changes
-- for people until an organizer edits it. Uploads live in event-assets, and files nothing points
-- to any more are queued for the app to remove.

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

-- mirrors certificateLayoutFromMarkdown in packages/utils/src/certificate.ts
create function private.certificate_layout_from_md(p_body text, p_orientation text, p_background text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_w numeric := case when p_orientation = 'portrait' then 210 else 297 end;
  v_h numeric := case when p_orientation = 'portrait' then 297 else 210 end;
  v_qr_y numeric := v_h - 14 - 22;
  v_blocks jsonb;
  v_block jsonb;
  v_total numeric;
  v_y numeric;
  v_layers jsonb := '[]';
begin
  select coalesce(jsonb_agg(jsonb_build_object('text', b.text, 'size', b.size, 'bold', b.level > 0,
      'h', round(b.size * 25.4 / 72 * 1.25 * (length(b.text) - length(replace(b.text, E'\n', '')) + 1) + 2, 1))
      order by b.i), '[]')
  into v_blocks
  from (
    select p.i,
      coalesce(substring(p.block from '^#{1,6}\s+(.*)$'), p.block) as text,
      coalesce(length(substring(p.block from '^(#{1,6})\s')), 0) as level,
      case coalesce(length(substring(p.block from '^(#{1,6})\s')), 0)
        when 0 then 14 when 1 then 32 when 2 then 24 else 18 end as size
    from (
      select btrim(t.block, E' \t\r\n') as block, t.i
      from regexp_split_to_table(coalesce(p_body, ''), E'\n\\s*\n') with ordinality t(block, i)
    ) p
    where p.block <> ''
    order by p.i
    limit 30
  ) b;
  select coalesce(sum((e ->> 'h')::numeric), 0) + 4 * greatest(jsonb_array_length(v_blocks) - 1, 0)
  into v_total from jsonb_array_elements(v_blocks) e;
  v_y := round(greatest(15, 15 + ((v_qr_y - 6 - 15) - v_total) / 2), 1);
  for v_block in select e from jsonb_array_elements(v_blocks) with ordinality x(e, i) order by i loop
    v_layers := v_layers || jsonb_build_array(jsonb_build_object(
      'id', 'text-' || (jsonb_array_length(v_layers) + 1), 'type', 'text', 'x', 20, 'y', v_y, 'w', v_w - 40,
      'h', v_block -> 'h', 'text', v_block ->> 'text', 'size', v_block -> 'size', 'font', 'sans',
      'bold', v_block -> 'bold', 'italic', false, 'align', 'center', 'color', '#000000'));
    v_y := round(v_y + (v_block ->> 'h')::numeric + 4, 1);
  end loop;
  v_layers := v_layers || jsonb_build_array(
    jsonb_build_object('id', 'qr', 'type', 'qr', 'x', round((v_w - 22) / 2, 1), 'y', v_qr_y, 'w', 22, 'h', 22),
    jsonb_build_object('id', 'link', 'type', 'text', 'x', 20, 'y', v_h - 13, 'w', v_w - 40, 'h', 5,
      'text', '{{link}}', 'size', 7, 'font', 'sans', 'bold', false, 'italic', false, 'align', 'center',
      'color', '#555555'));
  return jsonb_build_object(
    'background', jsonb_build_object(
      'color', '#ffffff',
      'image', case when p_background is null then null else jsonb_build_object('url', p_background) end,
      'frame', true),
    'layers', v_layers);
end;
$$;

alter table public.certificate_templates add column layout jsonb;
update public.certificate_templates
set layout = private.certificate_layout_from_md(body_md, orientation, background_url);
alter table public.certificate_templates
  alter column layout set not null,
  add constraint certificate_templates_layout_check
    check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 65536);
alter table public.certificate_templates drop column body_md, drop column background_url;
drop function private.certificate_layout_from_md(text, text, text);

drop policy certificate_templates_select on public.certificate_templates;
create policy certificate_templates_select on public.certificate_templates for select to authenticated
  using (
    (select private.is_org_admin(org_id))
    or (event_id is not null and (select private.can_manage(event_id)))
    or (event_id is null and (select private.manages_org_event(org_id)))
  );

drop function public.save_certificate_template(uuid, uuid, text, text, text, text);

-- org/<org>/... holds what belongs to the organization rather than one event (its certificate designs)
create policy event_assets_org_write on storage.objects for all to authenticated
  using (
    bucket_id = 'event-assets' and (storage.foldername(name))[1] = 'org'
    and (select private.is_org_admin(private.path_uuid(name, 2)))
  )
  with check (
    bucket_id = 'event-assets' and (storage.foldername(name))[1] = 'org'
    and (select private.is_org_admin(private.path_uuid(name, 2)))
  );

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

create or replace function private.certificate_json(p_id uuid)
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
