-- passkeys can be renamed (GoTrue has no endpoint for it)

-- renames one of the caller's own passkeys; GoTrue has no endpoint for it
create function public.rename_passkey(p_factor uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or char_length(v_name) > 64 then
    raise exception 'A passkey''s name is 1 to 64 characters' using errcode = '22023';
  end if;
  update auth.mfa_factors set friendly_name = v_name, updated_at = now()
  where id = p_factor and user_id = (select auth.uid()) and factor_type = 'webauthn';
  if not found then
    raise exception 'That passkey isn''t yours' using errcode = '42501';
  end if;
exception when unique_violation then
  raise exception 'You already have a passkey with that name' using errcode = '23505';
end;
$$;
grant execute on function public.rename_passkey(uuid, text) to authenticated;
