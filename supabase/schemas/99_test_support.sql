create schema if not exists tests;
revoke all on schema tests from public, anon, authenticated;
grant usage on schema tests to service_role;

create function tests.create_user(p_id uuid, p_email text, p_meta jsonb default '{}')
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
    p_meta, '{"provider":"email","providers":["email"]}', now(), now());
  return v_id;
end;
$$;

create function tests.u(p_suffix text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select md5('bogey-test:' || p_suffix)::uuid;
$$;

create function tests.as_user(p_user uuid, p_aal text default 'aal2')
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create function tests.as_anon()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on function tests.u(text) to anon, authenticated, service_role;
