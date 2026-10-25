-- checkin_gate: checkin.requiredToEnter keeps a participant out of the whole event (a core event gate)
-- until they're checked in, and counts as checking in before competing

create or replace function private.event_gate(p_event uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_reason text;
begin
  if private.real_event_role(p_event) is distinct from 'participant'
     or coalesce(private.real_org_role(private.event_org(p_event)) >= 'admin', false) then
    return null;
  end if;
  -- checkin.requiredToEnter: nothing in the event until they're checked in at the desk
  if coalesce((private.event_setting(p_event, 'checkin') ->> 'requiredToEnter')::boolean, false)
     and not private.checked_in(p_event, (select auth.uid())) then
    return 'checkin.required';
  end if;
  for v_key in
    select jsonb_array_elements_text(s.value -> 'enabled')
    from public.settings s
    where s.scope = 'event' and s.event_id = p_event and s.namespace = 'plugins'
      and jsonb_typeof(s.value -> 'enabled') = 'array'
  loop
    if to_regprocedure(format('private.%I(uuid)', v_key || '_gate')) is not null
       and private.plugin_enabled(p_event, v_key) then
      execute format('select private.%I($1)', v_key || '_gate') into v_reason using p_event;
      if v_reason is not null then
        return v_key || '.' || v_reason;
      end if;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function private.check_in_ok(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not (
      coalesce((private.event_setting(p_event, 'checkin') ->> 'requiredToCompete')::boolean, false)
      or coalesce((private.event_setting(p_event, 'checkin') ->> 'requiredToEnter')::boolean, false)
    )
    or private.event_role(p_event) is distinct from 'participant'
    or private.checked_in(p_event, (select auth.uid()));
$$;
