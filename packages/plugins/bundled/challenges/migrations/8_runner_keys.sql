-- Runner keys (ADR 0033): a credential that can only judge. A runner sends its key in the
-- x-bogey-runner-key header with the anon role; the challenges_runner_* functions below check it and
-- are all it can reach. The service-role functions stay for runners that haven't switched yet.

create table private.challenges_runner_keys (
  name text primary key check (name ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  key_hash bytea not null unique check (length(key_hash) = 32),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table private.challenges_runner_keys enable row level security;
revoke all on private.challenges_runner_keys from public, anon, authenticated, service_role;

-- the runner id a key's calls are recorded under: key:<name>/<the runner's own id>
create function private.challenges_runner_id(p_runner text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  v_key text := v_headers ->> 'x-bogey-runner-key';
  v_row private.challenges_runner_keys;
begin
  if v_key is null or v_key !~ '^bogey_runner_[A-Za-z0-9_-]{43}$' then
    raise exception 'a runner key is required' using errcode = '42501';
  end if;
  select * into v_row from private.challenges_runner_keys
  where key_hash = sha256(convert_to(v_key, 'UTF8')) and revoked_at is null;
  if v_row.name is null then
    raise exception 'this runner key isn''t valid' using errcode = '42501';
  end if;
  if p_runner is null or p_runner !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$' then
    raise exception 'the runner id must be letters, digits, ".", "_" or "-"' using errcode = '22023';
  end if;
  if v_row.last_used_at is null or v_row.last_used_at < now() - interval '1 minute' then
    update private.challenges_runner_keys set last_used_at = now() where name = v_row.name;
  end if;
  return 'key:' || v_row.name || '/' || p_runner;
end;
$$;

revoke execute on function private.challenges_runner_id(text) from public, anon, authenticated, service_role;

-- each wraps the service-role function, so later changes to claiming and recording apply to both

create function public.challenges_runner_claim(p_runner text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.challenges_claim_judging(
    private.challenges_runner_id(p_runner), least(greatest(coalesce(p_lease_seconds, 120), 30), 3600)
  );
end;
$$;

create function public.challenges_runner_heartbeat(p_judging uuid, p_runner text, p_lease_seconds integer default 120)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return coalesce(public.challenges_heartbeat(
    p_judging, private.challenges_runner_id(p_runner), least(greatest(coalesce(p_lease_seconds, 120), 30), 3600)
  ), false);
end;
$$;

create function public.challenges_runner_record(
  p_judging uuid, p_runner text, p_verdict public.challenges_verdict, p_score numeric,
  p_max_time_ms integer, p_max_memory_kb integer, p_compile_output text, p_runs jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.challenges_record_judging(
    p_judging, private.challenges_runner_id(p_runner), p_verdict, p_score,
    p_max_time_ms, p_max_memory_kb, p_compile_output, p_runs
  );
end;
$$;

create function public.challenges_runner_requeue(p_judging uuid, p_runner text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.challenges_requeue_judging(p_judging, private.challenges_runner_id(p_runner), p_reason);
end;
$$;

create function public.challenges_runner_release(p_judging uuid, p_runner text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.challenges_release_judging(p_judging, private.challenges_runner_id(p_runner));
end;
$$;

-- a test's input and answer, only for a judging this runner holds right now
create function public.challenges_runner_test_data(p_judging uuid, p_runner text, p_testcase uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_runner text := private.challenges_runner_id(p_runner);
  v_data jsonb;
begin
  select jsonb_build_object('input', t.input, 'answer', t.answer) into v_data
  from public.challenges_judgings j
  join public.challenges_solutions s on s.id = j.solution_id
  join public.challenges_testcases t on t.problem_id = s.problem_id
  where j.id = p_judging and t.id = p_testcase
    and j.runner_id = v_runner and j.status = 'running' and j.lease_expires_at > now();
  if v_data is null then
    raise exception 'no such test in a judging this runner holds' using errcode = 'P0002';
  end if;
  return v_data;
end;
$$;

revoke execute on function
  public.challenges_runner_claim(text, integer),
  public.challenges_runner_heartbeat(uuid, text, integer),
  public.challenges_runner_record(uuid, text, public.challenges_verdict, numeric, integer, integer, text, jsonb),
  public.challenges_runner_requeue(uuid, text, text),
  public.challenges_runner_release(uuid, text),
  public.challenges_runner_test_data(uuid, text, uuid)
from public, authenticated;
grant execute on function
  public.challenges_runner_claim(text, integer),
  public.challenges_runner_heartbeat(uuid, text, integer),
  public.challenges_runner_record(uuid, text, public.challenges_verdict, numeric, integer, integer, text, jsonb),
  public.challenges_runner_requeue(uuid, text, text),
  public.challenges_runner_release(uuid, text),
  public.challenges_runner_test_data(uuid, text, uuid)
to anon, service_role;

-- managing keys: the CLI (`bogey runner key`) with the service role. The CLI makes the key and sends
-- only its SHA-256, so the database never sees the key itself.

create function public.challenges_runner_key_add(p_name text, p_key_sha256 text, p_replace boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'the key hash must be 64 hex digits' using errcode = '22023';
  end if;
  if p_replace then
    insert into private.challenges_runner_keys (name, key_hash) values (p_name, decode(p_key_sha256, 'hex'))
    on conflict (name) do update set
      key_hash = excluded.key_hash, created_at = now(), last_used_at = null, revoked_at = null;
  else
    insert into private.challenges_runner_keys (name, key_hash) values (p_name, decode(p_key_sha256, 'hex'));
  end if;
end;
$$;

create function public.challenges_runner_key_revoke(p_name text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  update private.challenges_runner_keys set revoked_at = now()
  where name = p_name and revoked_at is null
  returning true;
$$;

create function public.challenges_runner_keys()
returns table (name text, created_at timestamptz, last_used_at timestamptz, revoked_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select k.name, k.created_at, k.last_used_at, k.revoked_at
  from private.challenges_runner_keys k
  order by k.name;
$$;

-- judgings a runner took with the service key in the last p_days days; doctor reports them
create function public.challenges_runner_legacy_judgings(p_days integer default 7)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.challenges_judgings
  where runner_id is not null and runner_id not like 'key:%'
    and started_at > now() - make_interval(days => greatest(p_days, 1));
$$;

revoke execute on function
  public.challenges_runner_key_add(text, text, boolean),
  public.challenges_runner_key_revoke(text),
  public.challenges_runner_keys(),
  public.challenges_runner_legacy_judgings(integer)
from public, anon, authenticated;
grant execute on function
  public.challenges_runner_key_add(text, text, boolean),
  public.challenges_runner_key_revoke(text),
  public.challenges_runner_keys(),
  public.challenges_runner_legacy_judgings(integer)
to service_role;
