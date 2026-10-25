-- permission_event_sets: policies ask for the caller's permitted events once per statement instead of once per row

create or replace function private.events_where(p_permission text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.id), '{}')
  from (
    select e.id from public.events e
    join public.org_members m on m.org_id = e.org_id
    where m.user_id = (select auth.uid()) and m.role >= 'admin'
    union
    select em.event_id from public.event_members em
    where em.user_id = (select auth.uid()) and em.status = 'active'
  ) c
  where private.has_permission(c.id, p_permission);
$$;

create or replace function private.can_see_profile(p_user uuid, p_people_view uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user = (select auth.uid())
    or private.shares_org(p_user)
    or exists (
      select 1
      from public.event_members mine
      join public.event_members theirs on theirs.event_id = mine.event_id
      where mine.user_id = (select auth.uid()) and mine.status = 'active'
        and theirs.user_id = p_user and theirs.status = 'active'
    )
    or exists (
      select 1
      from public.event_members mine
      join public.events e on e.id = mine.event_id
      join public.org_members admin on admin.org_id = e.org_id and admin.user_id = p_user
      where mine.user_id = (select auth.uid()) and mine.status = 'active' and admin.role >= 'admin'
    )
    or exists (
      select 1 from public.event_members theirs
      where theirs.user_id = p_user and theirs.event_id = any (p_people_view)
    )
    or exists (
      select 1 from public.registrations r
      where r.user_id = p_user and r.event_id = any (p_people_view)
    );
$$;

grant execute on function
  private.view_as(),
  private.is_platform_admin(),
  private.real_org_role(uuid),
  private.org_role(uuid),
  private.is_org_member(uuid),
  private.is_org_admin(uuid),
  private.event_org(uuid),
  private.real_event_role(uuid),
  private.real_holds_permission(uuid, text),
  private.previewed_role(uuid),
  private.event_role(uuid),
  private.holds_permission(uuid, text),
  private.event_gate(uuid),
  private.has_permission(uuid, text),
  private.can_manage(uuid),
  private.events_where(text),
  private.window_open(uuid, text),
  private.can_view_event(uuid),
  private.section_open(uuid, text),
  private.is_public_event(uuid),
  private.my_team(uuid),
  private.is_team_member(uuid),
  private.shares_org(uuid),
  private.can_see_profile(uuid, uuid[])
to anon, authenticated, service_role;

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (private.can_see_profile(id, (select private.events_where('people.view'))::uuid[]));

drop policy event_visitors_select on public.event_visitors;
create policy event_visitors_select on public.event_visitors for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_windows_write_insert on public.event_windows;
create policy event_windows_write_insert on public.event_windows for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_windows_write_update on public.event_windows;
create policy event_windows_write_update on public.event_windows for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_windows_write_delete on public.event_windows;
create policy event_windows_write_delete on public.event_windows for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy divisions_write_insert on public.divisions;
create policy divisions_write_insert on public.divisions for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy divisions_write_update on public.divisions;
create policy divisions_write_update on public.divisions for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy divisions_write_delete on public.divisions;
create policy divisions_write_delete on public.divisions for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy tracks_write_insert on public.tracks;
create policy tracks_write_insert on public.tracks for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy tracks_write_update on public.tracks;
create policy tracks_write_update on public.tracks for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy tracks_write_delete on public.tracks;
create policy tracks_write_delete on public.tracks for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_pages_select on public.event_pages;
create policy event_pages_select on public.event_pages for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (
      (window_key is null or (select private.window_open(event_id, window_key)))
      and (
        (audience = 'public' and (select private.is_public_event(event_id)))
        or (event_id = any ((select private.events_where('event.view'))::uuid[]))
      )
    )
  );

drop policy event_pages_write_insert on public.event_pages;
create policy event_pages_write_insert on public.event_pages for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_pages_write_update on public.event_pages;
create policy event_pages_write_update on public.event_pages for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_pages_write_delete on public.event_pages;
create policy event_pages_write_delete on public.event_pages for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy settings_select on public.settings;
create policy settings_select on public.settings for select to anon, authenticated
  using (
    case scope
      when 'instance' then not private.is_admin_only_namespace(namespace)
        or (select private.is_platform_admin())
      when 'org' then private.is_public_namespace(namespace) or (select private.is_org_member(org_id))
      when 'event' then (select private.can_view_event(event_id))
        and (private.is_public_namespace(namespace)
          or (event_id = any ((select private.events_where('event.view'))::uuid[]))
          or (namespace = 'about' and (select private.section_open(event_id, 'about')))
          or (private.is_gate_namespace(namespace)
            and (select private.holds_permission(event_id, 'event.view'))))
    end
  );

drop policy event_members_insert on public.event_members;
create policy event_members_insert on public.event_members for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_members_update on public.event_members;
create policy event_members_update on public.event_members for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_members_delete on public.event_members;
create policy event_members_delete on public.event_members for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_role_grants_select on public.event_role_grants;
create policy event_role_grants_select on public.event_role_grants for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('people.view'))::uuid[])));

drop policy event_role_grants_write_insert on public.event_role_grants;
create policy event_role_grants_write_insert on public.event_role_grants for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_role_grants_write_update on public.event_role_grants;
create policy event_role_grants_write_update on public.event_role_grants for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_role_grants_write_delete on public.event_role_grants;
create policy event_role_grants_write_delete on public.event_role_grants for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy onboarding_forms_write_insert on public.onboarding_forms;
create policy onboarding_forms_write_insert on public.onboarding_forms for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy onboarding_forms_write_update on public.onboarding_forms;
create policy onboarding_forms_write_update on public.onboarding_forms for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy onboarding_forms_write_delete on public.onboarding_forms;
create policy onboarding_forms_write_delete on public.onboarding_forms for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy invite_links_manage on public.invite_links;
create policy invite_links_manage on public.invite_links for all to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy registrations_select on public.registrations;
create policy registrations_select on public.registrations for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id = any ((select private.events_where('people.view'))::uuid[]))
  );

drop policy registrations_write_insert on public.registrations;
create policy registrations_write_insert on public.registrations for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy registrations_write_update on public.registrations;
create policy registrations_write_update on public.registrations for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy registrations_write_delete on public.registrations;
create policy registrations_write_delete on public.registrations for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy teams_select on public.teams;
create policy teams_select on public.teams for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (
      (event_id = any ((select private.events_where('event.view'))::uuid[]))
      and not (select private.hides_team_names(event_id))
    )
    or (
      (select private.is_public_event(event_id))
      and (select private.window_open(event_id, 'gallery'))
      and not (select private.hides_team_names(event_id))
    )
  );

drop policy teams_manage_insert on public.teams;
create policy teams_manage_insert on public.teams for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
    or
    (
      locked_at is null
      and (select private.window_open(event_id, 'teams'))
      and (select private.network_allowed(event_id, 'teams'))
      and exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid()) and tm.role = 'captain'
      )
    )
  )
  with check (
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
    or
    (
      locked_at is null
      and (select private.window_open(event_id, 'teams'))
      and exists (
      select 1 from public.team_members tm
      where tm.team_id = teams.id and tm.user_id = (select auth.uid()) and tm.role = 'captain'
      )
    )
  );

drop policy teams_manage_delete on public.teams;
create policy teams_manage_delete on public.teams for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy team_members_select on public.team_members;
create policy team_members_select on public.team_members for select to authenticated
  using (
    (select private.is_team_member(team_id))
    or (event_id = any ((select private.events_where('people.view'))::uuid[]))
  );

drop policy team_members_manage_insert on public.team_members;
create policy team_members_manage_insert on public.team_members for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy team_members_manage_update on public.team_members;
create policy team_members_manage_update on public.team_members for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy team_members_manage_delete on public.team_members;
create policy team_members_manage_delete on public.team_members for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy event_members_select on public.event_members;
create policy event_members_select on public.event_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id = any ((select private.events_where('people.view'))::uuid[]))
    or exists (
      select 1 from public.team_members mine
      join public.team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = event_members.user_id
        and mine.event_id = event_members.event_id
    )
  );

drop policy team_seekers_select on public.team_seekers;
create policy team_seekers_select on public.team_seekers for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy team_requests_select on public.team_requests;
create policy team_requests_select on public.team_requests for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or user_id = (select auth.uid()) or (select private.is_team_member(team_id)));

drop policy announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (
      deleted_at is null
      and publish_at <= now()
      and (event_id = any ((select private.events_where('event.view'))::uuid[]))
      and (everyone or private.in_announcement_audience(id, event_id))
    )
  );

drop policy announcements_write_update on public.announcements;
create policy announcements_write_update on public.announcements for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy announcements_write_delete on public.announcements;
create policy announcements_write_delete on public.announcements for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy announcement_audiences_select on public.announcement_audiences;
create policy announcement_audiences_select on public.announcement_audiences for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy chat_blocks_select on public.chat_blocks;
create policy chat_blocks_select on public.chat_blocks for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or user_id = (select auth.uid())
    or (team_id is not null and private.is_team_member(team_id))
  );

drop policy clarifications_insert on public.clarifications;
create policy clarifications_insert on public.clarifications for insert to authenticated
  with check (
    (select private.chat_allows(event_id, 'enabled'))
    and (
      (
        audience = 'staff'
        and (select private.chat_allows(event_id, 'staff'))
        and ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (select private.event_role(event_id)) = 'judge')
      )
      or (audience <> 'staff' and (event_id = any ((select private.events_where('event.manage'))::uuid[])))
      or (
        audience = 'judges'
        and team_id is not null
        and (select private.event_role(event_id)) = 'judge'
        and (select private.chat_allows(event_id, 'judges'))
      )
      or (
        (event_id = any ((select private.events_where('event.compete'))::uuid[]))
        and not (select private.chat_blocked(event_id))
        and (select private.chat_allows(event_id, 'participants'))
        and (audience = 'organizers' or (audience = 'judges' and (select private.chat_allows(event_id, 'judges'))))
      )
    )
  );

drop policy clarifications_manage on public.clarifications;
create policy clarifications_manage on public.clarifications for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (event_id = any ((select private.events_where('clarifications.answer'))::uuid[])));

drop policy clarification_messages_select on public.clarification_messages;
create policy clarification_messages_select on public.clarification_messages for select to authenticated
  using ((select private.can_see_clarification(clarification_id)) and (deleted_at is null or (event_id = any ((select private.events_where('event.manage'))::uuid[]))));

drop policy clarification_messages_moderate on public.clarification_messages;
create policy clarification_messages_moderate on public.clarification_messages for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy session_hosts_select on public.session_hosts;
create policy session_hosts_select on public.session_hosts for select to authenticated
  using ((event_id = any ((select private.events_where('event.view'))::uuid[])));

drop policy submission_forms_select on public.submission_forms;
create policy submission_forms_select on public.submission_forms for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.view'))::uuid[]))
    or (select private.gallery_open(event_id))
  );

drop policy submission_forms_write_insert on public.submission_forms;
create policy submission_forms_write_insert on public.submission_forms for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_forms_write_update on public.submission_forms;
create policy submission_forms_write_update on public.submission_forms for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_forms_write_delete on public.submission_forms;
create policy submission_forms_write_delete on public.submission_forms for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_form_divisions_select on public.submission_form_divisions;
create policy submission_form_divisions_select on public.submission_form_divisions for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.view'))::uuid[]))
    or (select private.gallery_open(event_id))
  );

drop policy submission_form_divisions_write_insert on public.submission_form_divisions;
create policy submission_form_divisions_write_insert on public.submission_form_divisions for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_form_divisions_write_delete on public.submission_form_divisions;
create policy submission_form_divisions_write_delete on public.submission_form_divisions for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_items_select on public.submission_items;
create policy submission_items_select on public.submission_items for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.view'))::uuid[]))
    or (select private.gallery_open(event_id))
  );

drop policy submission_items_write_insert on public.submission_items;
create policy submission_items_write_insert on public.submission_items for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_items_write_update on public.submission_items;
create policy submission_items_write_update on public.submission_items for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_items_write_delete on public.submission_items;
create policy submission_items_write_delete on public.submission_items for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submissions_insert on public.submissions;
create policy submissions_insert on public.submissions for insert to authenticated
  with check (
    (
      status = 'draft'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
      and (select private.form_reaches_team(form_id, team_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy submissions_update on public.submissions;
create policy submissions_update on public.submissions for update to authenticated
  using (
    (
      status <> 'disqualified'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  )
  with check (
    (
      status <> 'disqualified'
      and (select private.is_team_member(team_id))
      and (select private.team_write_allowed(form_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy submissions_manage_delete on public.submissions;
create policy submissions_manage_delete on public.submissions for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_tracks_write_insert on public.submission_tracks;
create policy submission_tracks_write_insert on public.submission_tracks for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_tracks_write_update on public.submission_tracks;
create policy submission_tracks_write_update on public.submission_tracks for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_tracks_write_delete on public.submission_tracks;
create policy submission_tracks_write_delete on public.submission_tracks for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy votes_select_own on public.votes;
create policy votes_select_own on public.votes for select to authenticated
  using (voter_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy gallery_likes_select_own on public.gallery_likes;
create policy gallery_likes_select_own on public.gallery_likes for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy gallery_comments_select_own on public.gallery_comments;
create policy gallery_comments_select_own on public.gallery_comments for select to authenticated
  using (author_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy ranking_inputs_select on public.ranking_inputs;
create policy ranking_inputs_select on public.ranking_inputs for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy judge_conflicts_select on public.judge_conflicts;
create policy judge_conflicts_select on public.judge_conflicts for select to authenticated
  using (judge_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy judge_pins_select on public.judge_pins;
create policy judge_pins_select on public.judge_pins for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy judging_panels_select on public.judging_panels;
create policy judging_panels_select on public.judging_panels for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (event_id = any ((select private.events_where('judging.score'))::uuid[])));

drop policy panel_judges_select on public.panel_judges;
create policy panel_judges_select on public.panel_judges for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (event_id = any ((select private.events_where('judging.score'))::uuid[])));

drop policy panel_slots_select on public.panel_slots;
create policy panel_slots_select on public.panel_slots for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])) or (event_id = any ((select private.events_where('judging.score'))::uuid[])));

drop policy judging_rounds_update on public.judging_rounds;
create policy judging_rounds_update on public.judging_rounds for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy round_entries_select on public.round_entries;
create policy round_entries_select on public.round_entries for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (event_id = any ((select private.events_where('judging.score'))::uuid[]))
    or exists (
      select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
  );

drop policy criteria_write_insert on public.criteria;
create policy criteria_write_insert on public.criteria for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy criteria_write_update on public.criteria;
create policy criteria_write_update on public.criteria for update to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy criteria_write_delete on public.criteria;
create policy criteria_write_delete on public.criteria for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy submission_rubrics_select on public.submission_rubrics;
create policy submission_rubrics_select on public.submission_rubrics for select to authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (event_id = any ((select private.events_where('judging.score'))::uuid[]))
    or exists (
      select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
  );

drop policy judge_assignments_select on public.judge_assignments;
create policy judge_assignments_select on public.judge_assignments for select to authenticated
  using (judge_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy judge_assignments_update on public.judge_assignments;
create policy judge_assignments_update on public.judge_assignments for update to authenticated
  using (
    (judge_id = (select auth.uid()))
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  )
  with check (
    (judge_id = (select auth.uid()))
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy judge_assignments_manage_insert on public.judge_assignments;
create policy judge_assignments_manage_insert on public.judge_assignments for insert to authenticated
  with check ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy judge_assignments_manage_delete on public.judge_assignments;
create policy judge_assignments_manage_delete on public.judge_assignments for delete to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy scores_select on public.scores;
create policy scores_select on public.scores for select to authenticated
  using (
    judge_id = (select auth.uid())
    or (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or private.in_deliberation(event_id, submission_id)
  );

drop policy scores_insert on public.scores;
create policy scores_insert on public.scores for insert to authenticated
  with check (
    (
      judge_id = (select auth.uid())
      and (event_id = any ((select private.events_where('judging.score'))::uuid[]))
      and (select private.round_window_open(round_id))
      and not (select private.has_conflict(judge_id, submission_id))
      and exists (select 1 from public.submissions s where s.id = submission_id and s.status = 'submitted')
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy scores_update on public.scores;
create policy scores_update on public.scores for update to authenticated
  using (
    (
      judge_id = (select auth.uid())
      and (select private.round_window_open(round_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  )
  with check (
    (
      judge_id = (select auth.uid())
      and (event_id = any ((select private.events_where('judging.score'))::uuid[]))
      and (select private.round_window_open(round_id))
      and not (select private.has_conflict(judge_id, submission_id))
      and exists (select 1 from public.submissions s where s.id = submission_id and s.status = 'submitted')
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy scores_delete on public.scores;
create policy scores_delete on public.scores for delete to authenticated
  using (
    (
      judge_id = (select auth.uid())
      and (select private.round_window_open(round_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy feedback_select on public.feedback;
create policy feedback_select on public.feedback for select to authenticated
  using (
    judge_id = (select auth.uid())
    or (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or private.in_deliberation(event_id, submission_id)
    or (
      visibility = 'team'
      and ((select private.event_setting(event_id, 'judging')) ->> 'shareWithTeams') in ('feedback', 'scores')
      and (select private.window_open(event_id, 'results'))
      and (select private.latest_publication(event_id)) is not null
      and exists (select 1 from public.submissions s where s.id = submission_id and private.is_team_member(s.team_id))
    )
  );

drop policy feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert to authenticated
  with check (
    (
      judge_id = (select auth.uid())
      and (event_id = any ((select private.events_where('judging.score'))::uuid[]))
      and (select private.round_window_open(round_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy feedback_update on public.feedback;
create policy feedback_update on public.feedback for update to authenticated
  using (
    (judge_id = (select auth.uid()) and (select private.round_window_open(round_id)))
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  )
  with check (
    (
      judge_id = (select auth.uid())
      and (event_id = any ((select private.events_where('judging.score'))::uuid[]))
      and (select private.round_window_open(round_id))
    )
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy feedback_delete on public.feedback;
create policy feedback_delete on public.feedback for delete to authenticated
  using (
    (judge_id = (select auth.uid()) and (select private.round_window_open(round_id)))
    or
    ((event_id = any ((select private.events_where('event.manage'))::uuid[])))
  );

drop policy awards_select on public.awards;
create policy awards_select on public.awards for select to authenticated
  using ((event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy result_publications_select on public.result_publications;
create policy result_publications_select on public.result_publications for select to anon, authenticated
  using (
    (event_id = any ((select private.events_where('event.manage'))::uuid[]))
    or (
      (select private.window_open(event_id, 'results'))
      and ((select private.is_public_event(event_id)) or (event_id = any ((select private.events_where('event.view'))::uuid[])))
      and id = (select private.latest_publication(event_id))
    )
  );

drop policy sheet_completions_select on public.sheet_completions;
create policy sheet_completions_select on public.sheet_completions for select to authenticated
  using (judge_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy checkins_select on public.checkins;
create policy checkins_select on public.checkins for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('people.checkin'))::uuid[])));

drop policy webhooks_select on public.webhooks;
create policy webhooks_select on public.webhooks for select to authenticated
  using ((select private.is_org_admin(org_id)) or (event_id is not null and (event_id = any ((select private.events_where('event.manage'))::uuid[]))));

drop policy webhook_deliveries_select on public.webhook_deliveries;
create policy webhook_deliveries_select on public.webhook_deliveries for select to authenticated
  using ((select private.is_org_admin(org_id)) or (event_id is not null and (event_id = any ((select private.events_where('event.manage'))::uuid[]))));

drop policy certificate_templates_select on public.certificate_templates;
create policy certificate_templates_select on public.certificate_templates for select to authenticated
  using (
    (select private.is_org_admin(org_id))
    or (event_id is not null and (event_id = any ((select private.events_where('event.manage'))::uuid[])))
    or (event_id is null and (select private.manages_org_event(org_id)))
  );

drop policy certificates_select on public.certificates;
create policy certificates_select on public.certificates for select to authenticated
  using (user_id = (select auth.uid()) or (event_id = any ((select private.events_where('event.manage'))::uuid[])));

drop policy tags_select on public.tags;
create policy tags_select on public.tags for select to authenticated
  using (
    (event_id is null and (select private.is_org_member(org_id)))
    or (event_id is not null and (event_id = any ((select private.events_where('event.view'))::uuid[])))
    or (select private.is_org_admin(org_id))
  );

drop policy tag_holders_select on public.tag_holders;
create policy tag_holders_select on public.tag_holders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (event_id is null and (select private.is_org_member(org_id)))
    or (event_id is not null and (event_id = any ((select private.events_where('people.view'))::uuid[])))
    or (select private.is_org_admin(org_id))
  );

drop function private.can_see_profile(uuid);
