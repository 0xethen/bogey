-- operator_key_upserts: saving one instance setting upserts the whole row, which fires the insert
-- trigger even when the row exists; the guard now compares with that row, so keeping appUrl as it
-- is no longer reads as changing it

create or replace function private.guard_operator_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row public.settings := case when tg_op = 'DELETE' then old else new end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}' else old.value end;
  v_new jsonb := case when tg_op = 'DELETE' then '{}' else new.value end;
  v_key text;
begin
  if v_row.scope = 'instance' and current_user in ('anon', 'authenticated') then
    -- an upsert fires the insert trigger even when the row exists, so compare with that row
    if tg_op = 'INSERT' then
      select s.value into v_old from public.settings s
      where s.scope = 'instance' and s.namespace = v_row.namespace;
      v_old := coalesce(v_old, '{}');
    end if;
    foreach v_key in array private.operator_keys(v_row.namespace) loop
      if (v_old -> v_key) is distinct from (v_new -> v_key) then
        raise exception '%.% can no longer be changed in the app. Set it in bogey.config.ts or with the CLI',
          v_row.namespace, v_key using errcode = '42501';
      end if;
    end loop;
  end if;
  return v_row;
end;
$$;
