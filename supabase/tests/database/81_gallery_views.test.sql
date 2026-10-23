begin;
select plan(3);

select ok(not (private.setting_defaults('gallery') ? 'layout'), 'no organizer layout default');
select ok(not (private.setting_defaults('gallery') ? 'switchLayout'), 'no switchLayout default');
select is(private.setting_defaults('gallery') ->> 'sort', 'newest', 'other gallery defaults remain');

select * from finish();
rollback;
