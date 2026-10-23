begin;
select plan(32);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'rk', 'Runner keys');
insert into public.events (id, org_id, slug, name, kind, visibility, team_size_max) values
  (tests.u('cup'), tests.u('org'), 'rk-cup', 'Cup', 'contest', 'public', 1);
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('cup'), 'plugins', '{"enabled":["challenges"]}');
select tests.create_user(tests.u('amy'), 'amy@rk.test', '{"full_name":"amy"}');
insert into public.event_members (event_id, user_id, role) values (tests.u('cup'), tests.u('amy'), 'participant');
delete from public.teams where event_id = tests.u('cup');
insert into public.teams (id, event_id, name) values (tests.u('team'), tests.u('cup'), 'Amy');
insert into public.team_members (event_id, team_id, user_id) values (tests.u('cup'), tests.u('team'), tests.u('amy'));
insert into public.challenges_problems (id, event_id, label, slug, title, points, checker) values
  (tests.u('p'), tests.u('cup'), 'A', 'a', 'A', 100, 'tokens'),
  (tests.u('q'), tests.u('cup'), 'B', 'b', 'B', 100, 'tokens');
insert into public.challenges_testcases (id, event_id, problem_id, ordinal, is_sample, input, answer) values
  (tests.u('t1'), tests.u('cup'), tests.u('p'), 1, false, 'hidden in', 'hidden answer'),
  (tests.u('t2'), tests.u('cup'), tests.u('q'), 1, false, 'other in', 'other answer');
insert into public.challenges_solutions (id, event_id, problem_id, team_id, language_key, source)
values (tests.u('s'), tests.u('cup'), tests.u('p'), tests.u('team'), 'python', 'print(1)');
-- the oldest in the queue, so it is the one claimed
insert into public.challenges_judgings (id, event_id, solution_id, queued_at)
values (tests.u('j'), tests.u('cup'), tests.u('s'), '2000-01-01');

insert into private.challenges_runner_keys (name, key_hash) values
  ('box', sha256(convert_to('bogey_runner_' || repeat('a', 43), 'UTF8'))),
  ('other', sha256(convert_to('bogey_runner_' || repeat('b', 43), 'UTF8'))),
  ('gone', sha256(convert_to('bogey_runner_' || repeat('c', 43), 'UTF8')));
update private.challenges_runner_keys set revoked_at = now() where name = 'gone';

-- ── no key, a wrong key, a revoked key ───────────────────────────────────

select tests.as_anon();
select throws_ok($$select public.challenges_runner_claim('r1')$$, '42501', 'a runner key is required', 'without a key nothing is claimed');
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}', true);
select throws_ok($$select public.challenges_runner_claim('r1')$$, '42501', null, 'nor with a key that isn''t one');
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_ccccccccccccccccccccccccccccccccccccccccccc"}', true);
select throws_ok($$select public.challenges_runner_claim('r1')$$, '42501', null, 'nor with a revoked key');
select set_config('request.headers', '{"x-bogey-runner-key":"service_role"}', true);
select throws_ok($$select public.challenges_runner_claim('r1')$$, '42501', null, 'nor with something shaped differently');

-- ── a key judges ─────────────────────────────────────────────────────────

select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
select throws_ok($$select public.challenges_runner_claim('r/1')$$, '22023', null, 'the runner id is a plain name');
create temp table claimed as select public.challenges_runner_claim('r1', 999999) as c;
select is((select c ->> 'judging_id' from claimed), tests.u('j')::text, 'a key claims the queued judging');
reset role;
select is((select runner_id from public.challenges_judgings where id = tests.u('j')), 'key:box/r1', 'under the key''s name');
select ok((select lease_expires_at <= now() + interval '3601 seconds' from public.challenges_judgings where id = tests.u('j')), 'with the lease capped at an hour');

select tests.as_anon();
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
select is(
  public.challenges_runner_test_data(tests.u('j'), 'r1', tests.u('t1')),
  '{"input": "hidden in", "answer": "hidden answer"}'::jsonb,
  'it reads the tests of the judging it holds'
);
select throws_ok(
  format('select public.challenges_runner_test_data(%L, %L, %L)', tests.u('j'), 'r1', tests.u('t2')),
  'P0002', null, 'but not another problem''s'
);
select throws_ok(
  format('select public.challenges_runner_test_data(%L, %L, %L)', tests.u('j'), 'r2', tests.u('t1')),
  'P0002', null, 'nor under another runner id of the same key'
);
select is(public.challenges_runner_heartbeat(tests.u('j'), 'r1'), true, 'it keeps its lease');

-- ── another key can't touch it ───────────────────────────────────────────

select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}', true);
select throws_ok(
  format('select public.challenges_runner_test_data(%L, %L, %L)', tests.u('j'), 'r1', tests.u('t1')),
  'P0002', null, 'another key can''t read its tests'
);
select is(public.challenges_runner_heartbeat(tests.u('j'), 'r1'), false, 'or renew its lease');
select is(
  public.challenges_runner_record(tests.u('j'), 'r1', 'WA', null, 1, null, '', '[]'),
  false, 'or record a verdict for it'
);
select public.challenges_runner_release(tests.u('j'), 'r1');
reset role;
select is((select status::text from public.challenges_judgings where id = tests.u('j')), 'running', 'or hand it back');

-- ── nothing else is reachable with a key ─────────────────────────────────

select tests.as_anon();
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
select is((select count(*)::integer from public.challenges_testcases where event_id = tests.u('cup')), 0, 'the tests table shows a key nothing');
select is((select count(*)::integer from public.challenges_solutions where event_id = tests.u('cup')), 0, 'nor the solutions');
select throws_ok($$select count(*) from private.challenges_runner_keys$$, '42501', null, 'nor the keys');
select throws_ok($$select public.challenges_claim_judging('key:box/r1')$$, '42501', null, 'the service-role functions stay closed');
select throws_ok(format('select public.challenges_requeue_judging(%L, %L, %L)', tests.u('j'), 'key:box/r1', 'x'), '42501', null, 'all of them');
select throws_ok($$select * from public.challenges_runner_keys()$$, '42501', null, 'and a key can''t list or make keys');
select throws_ok($$select public.challenges_runner_key_add('mine', repeat('0', 64))$$, '42501', null, 'or add one');
do $$ begin
  update public.challenges_judgings set verdict = 'AC' where id = tests.u('j');
exception when insufficient_privilege then null;
end $$;

reset role;
select is((select verdict from public.challenges_judgings where id = tests.u('j')), null, 'it can''t write judgings directly');

select tests.as_user(tests.u('amy'));
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
select throws_ok($$select public.challenges_runner_claim('r1')$$, '42501', null, 'a signed-in participant can''t use a key either');

-- ── recording ends the lease, and with it the test data ──────────────────

reset role;
select tests.as_anon();
select set_config('request.headers', '{"x-bogey-runner-key":"bogey_runner_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', true);
select is(
  public.challenges_runner_record(tests.u('j'), 'r1', 'AC', null, 12, null, '',
    jsonb_build_array(jsonb_build_object('testcase_id', tests.u('t1'), 'verdict', 'AC', 'time_ms', 12))),
  true, 'the key records its verdict'
);
select throws_ok(
  format('select public.challenges_runner_test_data(%L, %L, %L)', tests.u('j'), 'r1', tests.u('t1')),
  'P0002', null, 'after which the tests are closed to it'
);
reset role;
select is((select verdict::text from public.challenges_judgings where id = tests.u('j')), 'AC', 'the verdict is stored');

-- ── the service role manages keys ────────────────────────────────────────

select set_config('role', 'service_role', true);
select lives_ok(
  format('select public.challenges_runner_key_add(%L, %L)', 'new', encode(sha256(convert_to('bogey_runner_' || repeat('d', 43), 'UTF8')), 'hex')),
  'the CLI adds a key by its hash'
);
select ok((select count(*) = 1 from public.challenges_runner_keys() where name = 'new' and revoked_at is null), 'and lists it');
select is(public.challenges_runner_key_revoke('new'), true, 'and revokes it');
update public.challenges_judgings set runner_id = 'old-box', started_at = now() where id = tests.u('j');
select ok(public.challenges_runner_legacy_judgings() >= 1, 'doctor sees a judging taken with the service key');
reset role;

select * from finish();
rollback;
