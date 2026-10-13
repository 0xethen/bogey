begin;
select plan(19);

insert into public.orgs (id, slug, name) values (tests.u('org'), 'alpha', 'Alpha');
insert into public.events (id, org_id, slug, name, visibility, team_size_min, team_size_max)
values (tests.u('ev'), tests.u('org'), 'ev', 'Ev', 'public', 1, 4);
insert into public.event_windows (event_id, key, override) values
  (tests.u('ev'), 'challenges.contest', 'open'), (tests.u('ev'), 'challenges.scoreboard', 'open');
insert into public.settings (scope, event_id, namespace, value) values
  ('event', tests.u('ev'), 'plugins', '{"enabled":["challenges"]}'),
  ('event', tests.u('ev'), 'plugin.challenges', '{"format":"ctf","attemptsPerMinute":3}');
select tests.create_user(tests.u(n), n || '@t.test') from unnest(array['own','pa','pb','pc']) n;
insert into public.org_members (org_id, user_id, role) values (tests.u('org'), tests.u('own'), 'owner');
insert into public.event_members (event_id, user_id, role)
select tests.u('ev'), tests.u(n), 'participant' from unnest(array['pa','pb','pc']) n;
insert into public.teams (id, event_id, name) values
  (tests.u('ta'), tests.u('ev'), 'A'), (tests.u('tb'), tests.u('ev'), 'B'), (tests.u('tc'), tests.u('ev'), 'C');
insert into public.team_members (event_id, team_id, user_id) values
  (tests.u('ev'), tests.u('ta'), tests.u('pa')), (tests.u('ev'), tests.u('tb'), tests.u('pb')),
  (tests.u('ev'), tests.u('tc'), tests.u('pc'));

select tests.as_user(tests.u('pa'));
select throws_ok($$select public.ctf_save_challenge(tests.u('ev'), null, '{"title":"x","flag_kind":"static","flag":"f"}')$$, '42501', null, 'participants can''t add challenges');
reset role;
select tests.as_user(tests.u('own'));
create temp table made (name text primary key, id uuid) on commit drop;
grant all on made to authenticated;
insert into made values
  ('web', public.ctf_save_challenge(tests.u('ev'), null,
    '{"title":"Web","category":"web","scoring":"dynamic","points_initial":500,"points_min":100,"decay":4,"flag_kind":"static","flag":"flag{Web}","case_sensitive":false,"hints":[{"cost":30,"content_md":"look at cookies"}]}')),
  ('re', public.ctf_save_challenge(tests.u('ev'), null,
    '{"title":"Pattern","flag_kind":"regex","flag":"flag\\{[0-9]{3}\\}","points_initial":100}'));
select throws_ok($$select public.ctf_save_challenge(tests.u('ev'), null, '{"title":"Bad","flag_kind":"regex","flag":"("}')$$, '2201B', null, 'a regular expression has to be valid');
reset role;

select is((select count(*)::integer from public.ctf_flags where flag_hash like '%flag%'), 0, 'a flag is stored hashed');

select tests.as_user(tests.u('pa'));
select is((select count(*)::integer from public.ctf_flags), 0, 'flags can''t be read');
select is((select count(*)::integer from public.ctf_challenges), 0, 'nor the challenge table, only the function');
select is((select count(*)::integer from public.ctf_challenges_for_team(tests.u('ev'))), 2, 'the function lists challenges');
select is((select content_md from public.ctf_challenges_for_team(tests.u('ev')) c, jsonb_to_recordset(c.hints) as h(ordinal int, content_md text) where c.title = 'Web'),
  null, 'a locked hint shows no text');
select is(public.ctf_submit_flag((select id from made where name = 'web'), 'nope'), 'incorrect', 'a wrong flag');
select is(public.ctf_submit_flag((select id from made where name = 'web'), 'FLAG{web}'), 'correct', 'an insensitive flag matches in any case');
select is(public.ctf_submit_flag((select id from made where name = 'web'), 'FLAG{web}'), 'solved', 'solving twice is a no-op');
select is(public.ctf_submit_flag((select id from made where name = 're'), 'flag{123}'), 'correct', 'a pattern flag matches');
select is(public.ctf_submit_flag((select id from made where name = 're'), 'xflag{123}x'), 'solved', 'already solved, whatever is sent');
reset role;

select tests.as_user(tests.u('pb'));
select is(public.ctf_unlock_hint((select id from made where name = 'web'), 1::smallint), 'look at cookies', 'a hint unlocks');
select public.ctf_submit_flag((select id from made where name = 'web'), 'a');
select public.ctf_submit_flag((select id from made where name = 'web'), 'b');
select public.ctf_submit_flag((select id from made where name = 'web'), 'c');
select throws_ok($$select public.ctf_submit_flag((select id from made where name = 'web'), 'd')$$, '54000', null, 'wrong flags are rate limited');
reset role;
update public.ctf_attempts set created_at = now() - interval '2 minutes';
select tests.as_user(tests.u('pb'));
select is(public.ctf_submit_flag((select id from made where name = 'web'), 'flag{web}'), 'correct', 'and allowed again a minute later');

select is((select points from public.ctf_challenges_for_team(tests.u('ev')) where title = 'Web'), 475, 'dynamic points fall with solves');
select is((select score from public.ctf_scoreboard(tests.u('ev')) where team_name = 'B'), 445, 'a team''s score is points less hints');
select is((select first_bloods from public.ctf_scoreboard(tests.u('ev')) where team_name = 'A'), 2, 'first blood goes to the first solver');
reset role;

update public.event_windows set override = 'closed' where event_id = tests.u('ev') and key = 'challenges.scoreboard';
select tests.as_user(tests.u('pc'));
select throws_ok($$select * from public.ctf_scoreboard(tests.u('ev'))$$, '42501', null, 'players see no board while it''s closed');
reset role;

select * from finish();
rollback;
