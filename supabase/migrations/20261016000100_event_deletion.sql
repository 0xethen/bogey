-- org admins can delete an event

-- deletes an event and returns its stored files, which the caller removes through the storage API
create or replace function public.delete_event(p_event uuid, p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_files jsonb;
begin
  select * into v_event from public.events where id = p_event;
  if v_event.id is null or not private.is_org_admin(v_event.org_id) then
    raise exception 'only an organization owner or admin can delete this event' using errcode = '42501';
  end if;
  if p_confirm is distinct from v_event.slug::text then
    raise exception 'type the event''s web address to delete it' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('bucket', o.bucket_id, 'path', o.name)), '[]')
  into v_files
  from storage.objects o
  where o.bucket_id in ('event-assets', 'submissions', 'registrations', 'message-attachments')
    and (storage.foldername(o.name))[1] = p_event::text;
  perform private.audit_org(v_event.org_id, 'event.deleted', 'event', v_event.id,
    jsonb_build_object('name', v_event.name, 'slug', v_event.slug));
  delete from public.events where id = p_event;
  return v_files;
end;
$$;
grant execute on function public.delete_event(uuid, text) to authenticated;
