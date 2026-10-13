create function public.challenges_ctf_seed_demo(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_now timestamptz := date_trunc('hour', now());
  v_warm uuid;
  v_dyn uuid;
  v_hard uuid;
  v_re uuid;
  v_a uuid;
  v_b uuid;
  v_c uuid;
begin
  delete from public.events where org_id = p_org and slug = 'demo-ctf';

  insert into public.events (org_id, slug, name, short_name, kind, description_md, timezone,
    starts_at, ends_at, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-ctf', 'Demo CTF', 'CTF', 'custom',
    'Four challenges, dynamic scoring and a hint. Flags for the demo: flag{hello}, flag{xor}, flag{sqli}, and any flag{<8 hex>}.',
    'America/New_York', v_now - interval '1 hour', v_now + interval '5 hours', 'public', 1, 4)
  returning id into v_event;

  insert into public.event_windows (event_id, key, opens_at, closes_at) values
    (v_event, 'registration', v_now - interval '7 days', v_now + interval '5 hours'),
    (v_event, 'challenges.contest', v_now - interval '1 hour', v_now + interval '5 hours'),
    (v_event, 'challenges.scoreboard', v_now - interval '1 hour', null);
  insert into public.settings (scope, event_id, namespace, value) values
    ('event', v_event, 'registration', '{"mode":"open"}'),
    ('event', v_event, 'plugins', '{"enabled":["challenges"]}'),
    ('event', v_event, 'plugin.challenges', '{"format":"ctf","attemptsPerMinute":5}');

  insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, sort)
  values (v_event, 'Warm-up', 'misc', 'The flag is `flag{hello}`. Type it in.', 'static', 50, 50, 20, 0)
  returning id into v_warm;
  insert into public.ctf_flags (challenge_id, flag_kind, flag_hash, case_sensitive)
  values (v_warm, 'static', private.ctf_hash(v_warm, 'flag{hello}', true), true);

  insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, sort)
  values (v_event, 'Single-byte XOR', 'crypto', E'`130419` was XORed with one byte. Recover the word and wrap it: `flag{word}`.', 'dynamic', 500, 100, 5, 1)
  returning id into v_dyn;
  insert into public.ctf_flags (challenge_id, flag_kind, flag_hash, case_sensitive)
  values (v_dyn, 'static', private.ctf_hash(v_dyn, 'flag{xor}', false), false);
  insert into public.ctf_hints (event_id, challenge_id, ordinal, cost, content_md)
  values (v_event, v_dyn, 1, 25, 'The key is a letter. Try them all.');

  insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, sort)
  values (v_event, 'Login bypass', 'web', 'Log in as admin without the password.', 'dynamic', 400, 100, 5, 2)
  returning id into v_hard;
  insert into public.ctf_flags (challenge_id, flag_kind, flag_hash, case_sensitive)
  values (v_hard, 'static', private.ctf_hash(v_hard, 'flag{sqli}', true), true);

  insert into public.ctf_challenges (event_id, title, category, description_md, scoring, points_initial, points_min, decay, sort)
  values (v_event, 'Per-team flag', 'misc', 'Each team gets its own flag, but they all look like `flag{` plus eight hex digits.', 'static', 150, 150, 20, 3)
  returning id into v_re;
  insert into public.ctf_flags (challenge_id, flag_kind, flag_regex, case_sensitive)
  values (v_re, 'regex', 'flag\{[0-9a-f]{8}\}', true);

  insert into public.teams (event_id, name) values (v_event, 'Null Pointers') returning id into v_a;
  insert into public.teams (event_id, name) values (v_event, 'Stack Smashers') returning id into v_b;
  insert into public.teams (event_id, name) values (v_event, 'Rubber Ducks') returning id into v_c;

  insert into public.ctf_solves (event_id, challenge_id, team_id, solved_at) values
    (v_event, v_warm, v_a, v_now - interval '50 minutes'),
    (v_event, v_warm, v_b, v_now - interval '45 minutes'),
    (v_event, v_warm, v_c, v_now - interval '30 minutes'),
    (v_event, v_dyn, v_a, v_now - interval '25 minutes'),
    (v_event, v_dyn, v_b, v_now - interval '10 minutes'),
    (v_event, v_hard, v_b, v_now - interval '5 minutes');
end;
$$;

revoke execute on function public.challenges_ctf_seed_demo(uuid) from authenticated;
grant execute on function public.challenges_ctf_seed_demo(uuid) to service_role;

create function public.challenges_seed_demo(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cup uuid;
  v_ioi uuid;
  v_golf uuid;
  v_p uuid;
  v_now timestamptz := date_trunc('hour', now());
begin
  delete from public.events where org_id = p_org and slug in ('demo-cup', 'demo-ioi', 'demo-golf');

  insert into public.events (org_id, slug, name, short_name, kind, description_md, timezone,
    starts_at, ends_at, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-cup', 'Demo Cup', 'Cup', 'contest',
    'Three problems, three hours, ICPC rules. Solo.', 'America/New_York',
    v_now - interval '1 hour', v_now + interval '2 hours', 'public', 1, 1)
  returning id into v_cup;

  insert into public.event_windows (event_id, key, opens_at, closes_at) values
    (v_cup, 'registration', v_now - interval '7 days', v_now + interval '2 hours'),
    (v_cup, 'challenges.contest', v_now - interval '1 hour', v_now + interval '2 hours'),
    (v_cup, 'challenges.scoreboard', v_now - interval '1 hour', null),
    (v_cup, 'lockdown.armed', v_now - interval '1 hour', v_now + interval '2 hours');

  insert into public.settings (scope, event_id, namespace, value) values
    ('event', v_cup, 'registration', '{"mode":"open"}'),
    ('event', v_cup, 'plugins', '{"enabled":["challenges","lockdown"]}'),
    ('event', v_cup, 'plugin.challenges', '{"scoring":"icpc","penaltyMinutes":20,"freezeMinutes":60}'),
    ('event', v_cup, 'plugin.lockdown', '{"mode":"monitor"}');

  insert into public.challenges_problems (event_id, label, slug, title, statement_md, time_limit_ms) values
    (v_cup, 'A', 'sum', 'Sum', E'Read two integers *a* and *b* and print *a* + *b*.\n\n**Input:** one line, `a b`, each at most 10⁹ in size.', 1000)
  returning id into v_p;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer) values
    (v_cup, v_p, 1, true, E'1 2\n', E'3\n'), (v_cup, v_p, 2, false, E'-5 5\n', E'0\n'),
    (v_cup, v_p, 3, false, E'1000000000 1000000000\n', E'2000000000\n');

  insert into public.challenges_problems (event_id, label, slug, title, statement_md, time_limit_ms) values
    (v_cup, 'B', 'reverse', 'Reverse', E'Print the input line reversed.', 1000)
  returning id into v_p;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer) values
    (v_cup, v_p, 1, true, E'bogey\n', E'yegob\n'), (v_cup, v_p, 2, false, E'racecar\n', E'racecar\n'),
    (v_cup, v_p, 3, false, E'ab\n', E'ba\n');

  insert into public.challenges_problems (event_id, label, slug, title, statement_md, time_limit_ms, checker, checker_tolerance) values
    (v_cup, 'C', 'average', 'Average', E'Given *n* and then *n* numbers, print their mean. Answers within 10⁻⁶ (absolute or relative) are accepted.', 2000, 'float', 1e-6)
  returning id into v_p;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer) values
    (v_cup, v_p, 1, true, E'3\n1 2 3\n', E'2\n'), (v_cup, v_p, 2, false, E'2\n1 2\n', E'1.5\n');

  insert into public.challenges_solutions (event_id, problem_id, language_key, source, expected_verdict, jury_label)
  select v_cup, id, 'python', E'a, b = map(int, input().split())\nprint(a + b)\n', 'AC', 'reference'
  from public.challenges_problems where event_id = v_cup and slug = 'sum';

  insert into public.events (org_id, slug, name, short_name, kind, description_md, timezone,
    starts_at, ends_at, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-ioi', 'Demo IOI', 'IOI', 'contest',
    'One problem scored by subtasks. Solo.', 'America/New_York',
    v_now - interval '1 hour', v_now + interval '2 hours', 'public', 1, 1)
  returning id into v_ioi;

  insert into public.event_windows (event_id, key, opens_at, closes_at) values
    (v_ioi, 'registration', v_now - interval '7 days', v_now + interval '2 hours'),
    (v_ioi, 'challenges.contest', v_now - interval '1 hour', v_now + interval '2 hours'),
    (v_ioi, 'challenges.scoreboard', v_now - interval '1 hour', null);

  insert into public.settings (scope, event_id, namespace, value) values
    ('event', v_ioi, 'registration', '{"mode":"open"}'),
    ('event', v_ioi, 'plugins', '{"enabled":["challenges"]}'),
    ('event', v_ioi, 'plugin.challenges', '{"scoring":"ioi","freezeMinutes":0}');

  insert into public.challenges_problems (event_id, label, slug, title, statement_md, time_limit_ms, points, test_groups) values
    (v_ioi, 'A', 'count-up', 'Count up', E'Read *n* and print the numbers from 1 to *n*, separated by spaces.\n\nSubtask 1 (30 points): *n* ≤ 5. Subtask 2 (70 points): *n* ≤ 1000.', 1000, 100,
      '{"small":{"aggregation":"sum","stopOnFail":false},"big":{"aggregation":"min","stopOnFail":true}}')
  returning id into v_p;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, group_key, points, input, answer) values
    (v_ioi, v_p, 1, true, null, null, E'3\n', E'1 2 3\n'),
    (v_ioi, v_p, 2, false, 'small', 15, E'1\n', E'1\n'),
    (v_ioi, v_p, 3, false, 'small', 15, E'5\n', E'1 2 3 4 5\n'),
    (v_ioi, v_p, 4, false, 'big', 70, E'1000\n', (select string_agg(n::text, ' ' order by n) || E'\n' from generate_series(1, 1000) n)),
    (v_ioi, v_p, 5, false, 'big', 70, E'999\n', (select string_agg(n::text, ' ' order by n) || E'\n' from generate_series(1, 999) n));

  insert into public.events (org_id, slug, name, short_name, kind, description_md, timezone,
    starts_at, ends_at, visibility, team_size_min, team_size_max)
  values (p_org, 'demo-golf', 'Demo Golf', 'Golf', 'contest',
    'Shortest source wins. Solo.', 'America/New_York',
    v_now - interval '1 hour', v_now + interval '2 hours', 'public', 1, 1)
  returning id into v_golf;

  insert into public.event_windows (event_id, key, opens_at, closes_at) values
    (v_golf, 'registration', v_now - interval '7 days', v_now + interval '2 hours'),
    (v_golf, 'challenges.contest', v_now - interval '1 hour', v_now + interval '2 hours'),
    (v_golf, 'challenges.scoreboard', v_now - interval '1 hour', null);

  insert into public.settings (scope, event_id, namespace, value) values
    ('event', v_golf, 'registration', '{"mode":"open"}'),
    ('event', v_golf, 'plugins', '{"enabled":["challenges"]}'),
    ('event', v_golf, 'plugin.challenges', '{"scoring":"golf","golfMeasure":"characters","golfPoints":"ratio","freezeMinutes":0}');

  insert into public.challenges_problems (event_id, label, slug, title, statement_md, time_limit_ms, points) values
    (v_golf, 'A', 'ten', 'Ten', E'Print the numbers from 1 to 10, one per line. There is no input.', 1000, 100)
  returning id into v_p;
  insert into public.challenges_testcases (event_id, problem_id, ordinal, is_sample, input, answer) values
    (v_golf, v_p, 1, true, '', E'1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
  perform public.challenges_ctf_seed_demo(p_org);
end;
$$;

revoke execute on function public.challenges_seed_demo(uuid) from authenticated;
grant execute on function public.challenges_seed_demo(uuid) to service_role;
