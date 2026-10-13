create table public.certificate_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs on delete cascade,
  event_id uuid references public.events on delete cascade,
  kind text not null check (kind in ('participation', 'award', 'judge', 'volunteer')),
  body_md text not null check (length(body_md) between 1 and 2000),
  orientation text not null default 'landscape' check (orientation in ('landscape', 'portrait')),
  background_url text check (background_url ~ '^https://' and length(background_url) <= 500),
  updated_at timestamptz not null default now()
);
create unique index certificate_templates_event_kind_idx on public.certificate_templates (event_id, kind) where event_id is not null;
create unique index certificate_templates_org_kind_idx on public.certificate_templates (org_id, kind) where event_id is null;
create index certificate_templates_event_id_fk_idx on public.certificate_templates (event_id);
alter table public.certificate_templates enable row level security;
create policy certificate_templates_select on public.certificate_templates for select to authenticated
  using ((select private.is_org_admin(org_id)) or (event_id is not null and (select private.can_manage(event_id))));

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

create function private.certificate_options(p_event uuid, p_user uuid)
returns table (kind text, award_id uuid, label text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.event_role;
begin
  if not coalesce((private.event_setting(p_event, 'certificates') ->> 'enabled')::boolean, false) then
    return;
  end if;
  select m.role into v_role from public.event_members m
  where m.event_id = p_event and m.user_id = p_user and m.status = 'active';
  if v_role is null then
    return;
  end if;
  if v_role = 'participant' then
    if exists (select 1 from public.checkins c where c.event_id = p_event and c.user_id = p_user)
      or exists (
        select 1 from public.submissions s
        join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
        where s.event_id = p_event and s.status = 'submitted') then
      return query select 'participation'::text, null::uuid, ''::text;
    end if;
    if private.latest_publication(p_event) is not null then
      return query
      select 'award'::text, a.id, a.label
      from public.awards a
      join public.submissions s on s.id = a.submission_id
      join public.team_members tm on tm.team_id = s.team_id and tm.user_id = p_user
      where a.event_id = p_event;
    end if;
  elsif v_role = 'judge' then
    return query select 'judge'::text, null::uuid, ''::text;
  elsif v_role = 'staff' then
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

create function public.save_certificate_template(
  p_org uuid, p_event uuid, p_kind text, p_body_md text, p_orientation text default 'landscape', p_background_url text default null
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
  if btrim(coalesce(p_body_md, '')) = '' then
    delete from public.certificate_templates t
    where t.org_id = p_org and t.event_id is not distinct from p_event and t.kind = p_kind;
  elsif p_event is null then
    insert into public.certificate_templates (org_id, event_id, kind, body_md, orientation, background_url)
    values (p_org, null, p_kind, p_body_md, p_orientation, nullif(btrim(p_background_url), ''))
    on conflict (org_id, kind) where event_id is null do update set
      body_md = excluded.body_md, orientation = excluded.orientation, background_url = excluded.background_url, updated_at = now();
  else
    insert into public.certificate_templates (org_id, event_id, kind, body_md, orientation, background_url)
    values (p_org, p_event, p_kind, p_body_md, p_orientation, nullif(btrim(p_background_url), ''))
    on conflict (event_id, kind) where event_id is not null do update set
      body_md = excluded.body_md, orientation = excluded.orientation, background_url = excluded.background_url, updated_at = now();
  end if;
  if p_event is not null then
    perform private.audit(p_event, 'certificate.template_saved', 'event', p_event, jsonb_build_object('kind', p_kind));
  else
    perform private.audit_org(p_org, 'certificate.template_saved', 'org', p_org, jsonb_build_object('kind', p_kind));
  end if;
end;
$$;
revoke execute on function public.save_certificate_template(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_certificate_template(uuid, uuid, text, text, text, text) to authenticated;

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
    'body', t.body_md, 'orientation', coalesce(t.orientation, 'landscape'), 'background', t.background_url)
  from public.certificates c
  join public.events e on e.id = c.event_id
  join public.orgs o on o.id = e.org_id
  left join lateral (
    select ct.body_md, ct.orientation, ct.background_url from public.certificate_templates ct
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
