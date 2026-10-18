-- settings_for for each of a list of events, keyed by event id: the events list reads what its
-- plugins show beside each name in one call. Each event gets only what its own check lets through.
create function public.settings_for_events(p_namespaces text[], p_events uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.id, public.settings_for(p_namespaces, null, e.id)), '{}')
  from (select distinct unnest(p_events[1:200]) as id) e;
$$;
grant execute on function public.settings_for_events(text[], uuid[]) to anon, authenticated;
