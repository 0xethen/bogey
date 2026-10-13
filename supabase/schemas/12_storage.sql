insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('branding', 'branding', true, 2 * 1024 * 1024, null),
  (
    'event-assets', 'event-assets', true, 5 * 1024 * 1024,
    array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
  ),
  ('submissions', 'submissions', false, 50 * 1024 * 1024, null),
  ('message-attachments', 'message-attachments', false, 10 * 1024 * 1024, null),
  (
    'registrations', 'registrations', false, 10 * 1024 * 1024,
    array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function private.path_uuid(p_name text, p_index integer)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(p_name))[p_index]::uuid;
exception when others then
  return null;
end;
$$;
grant execute on function private.path_uuid(text, integer) to anon, authenticated;

create policy branding_write on storage.objects for all to authenticated
  using (bucket_id = 'branding' and (select private.is_org_admin(private.path_uuid(name, 1))))
  with check (bucket_id = 'branding' and (select private.is_org_admin(private.path_uuid(name, 1))));

create policy event_assets_write on storage.objects for all to authenticated
  using (bucket_id = 'event-assets' and (select private.can_manage(private.path_uuid(name, 1))))
  with check (bucket_id = 'event-assets' and (select private.can_manage(private.path_uuid(name, 1))));

create policy submissions_read on storage.objects for select to authenticated
  using (
    bucket_id = 'submissions'
    and (
      (select private.is_team_member(private.path_uuid(name, 2)))
      or (select private.has_permission(private.path_uuid(name, 1), 'judging.score'))
    )
  );
create policy submissions_public_read on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'submissions'
    and exists (
      select 1 from public.submission_files f
      join public.submissions s on s.id = f.submission_id
      where f.storage_path = name
        and private.can_read_submission(s.event_id, s.team_id, s.status, s.is_public)
    )
  );
create policy submissions_team_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (select private.is_team_member(private.path_uuid(name, 2)))
    and (select private.team_write_allowed(private.path_uuid(name, 3)))
    and exists (
      select 1 from public.teams t
      join public.submission_forms f on f.event_id = t.event_id
      where t.id = private.path_uuid(name, 2) and t.event_id = private.path_uuid(name, 1)
        and f.id = private.path_uuid(name, 3)
    )
  );
create policy submissions_team_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'submissions'
    and (select private.is_team_member(private.path_uuid(name, 2)))
    and (select private.team_write_allowed(private.path_uuid(name, 3)))
  );
create policy submissions_manage on storage.objects for all to authenticated
  using (bucket_id = 'submissions' and (select private.can_manage(private.path_uuid(name, 1))))
  with check (bucket_id = 'submissions' and (select private.can_manage(private.path_uuid(name, 1))));

create policy message_attachments_read on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and (select private.can_see_clarification(private.path_uuid(name, 2)))
  );
create policy message_attachments_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (select private.can_write_clarification(private.path_uuid(name, 2)))
    and exists (
      select 1 from public.clarifications c
      where c.id = private.path_uuid(name, 2) and c.event_id = private.path_uuid(name, 1)
    )
  );
create policy message_attachments_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'message-attachments'
    and (owner_id = (select auth.uid())::text or (select private.can_manage(private.path_uuid(name, 1))))
  );

-- Announcement files live at <event>/<announcement>/..., uploaded before the
-- announcement is posted (its id is picked up front). Readers need to see it.
create policy announcement_attachments_read on storage.objects for select to authenticated
  using (
    bucket_id = 'message-attachments'
    and (
      owner_id = (select auth.uid())::text
      or exists (
        select 1 from public.announcements a
        where a.id = private.path_uuid(name, 2) and a.event_id = private.path_uuid(name, 1)
      )
    )
  );
create policy announcement_attachments_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'message-attachments'
    and (select private.may_announce(private.path_uuid(name, 1)))
    and not exists (select 1 from public.clarifications c where c.id = private.path_uuid(name, 2))
    and not exists (select 1 from public.announcements a where a.id = private.path_uuid(name, 2))
  );

create policy registrations_read on storage.objects for select to authenticated
  using (
    bucket_id = 'registrations'
    and (
      private.path_uuid(name, 2) = (select auth.uid())
      or (select private.has_permission(private.path_uuid(name, 1), 'people.view'))
    )
  );
create policy registrations_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'registrations'
    and private.path_uuid(name, 2) = (select auth.uid())
    and (select private.can_view_event(private.path_uuid(name, 1)))
  );
create policy registrations_replace on storage.objects for update to authenticated
  using (bucket_id = 'registrations' and private.path_uuid(name, 2) = (select auth.uid()))
  with check (bucket_id = 'registrations' and private.path_uuid(name, 2) = (select auth.uid()));
create policy registrations_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'registrations'
    and (
      private.path_uuid(name, 2) = (select auth.uid())
      or (select private.can_manage(private.path_uuid(name, 1)))
    )
  );
