-- gallery: teams pick a banner and card size; organizers can turn on likes and comments

alter table public.submissions
  add column card_size text not null default 'standard' check (card_size in ('compact', 'standard', 'large'));
alter table public.submission_files add column is_banner boolean not null default false;
create unique index submission_files_banner_idx on public.submission_files (submission_id) where is_banner;

create or replace function private.guard_submission_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and (new.status, new.submitted_at, new.submitted_by, new.team_id, new.event_id, new.form_id,
          new.deletion_requested_at, new.deletion_requested_by, new.table_label)
       is distinct from (old.status, old.submitted_at, old.submitted_by, old.team_id, old.event_id, old.form_id,
          old.deletion_requested_at, old.deletion_requested_by, old.table_label) then
    raise exception 'use submit_project or delete_submission to change a submission''s status' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and new.card_size is distinct from old.card_size then
    raise exception 'use set_gallery_look to change how your project looks in the gallery' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and not private.can_manage(old.event_id)
     and new.is_public is distinct from old.is_public
     and (private.event_setting(old.event_id, 'submissions') ->> 'publicToggle')::boolean is false then
    raise exception 'your organizers don''t let teams change gallery visibility' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.guard_file_banner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not private.can_manage(new.event_id)
     and ((tg_op = 'INSERT' and new.is_banner) or (tg_op = 'UPDATE' and new.is_banner is distinct from old.is_banner)) then
    raise exception 'use set_gallery_look to pick a gallery banner' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger submission_files_guard_banner before insert or update on public.submission_files
  for each row execute function private.guard_file_banner();

-- The gallery's look and its interactions. A team picks its banner (one of its image files) and card
-- size through set_gallery_look, which the organizers' gallery settings can switch off; likes and
-- comments are off until an organizer turns them on.
create function public.set_gallery_look(p_submission uuid, p_size text, p_banner uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
  v_manager boolean;
  v_settings jsonb;
  v_current uuid;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_manager := private.can_manage(v_sub.event_id);
  if not v_manager and not (private.is_team_member(v_sub.team_id) and v_sub.status <> 'disqualified') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_size not in ('compact', 'standard', 'large') then
    raise exception 'unknown card size' using errcode = '22023';
  end if;
  if p_banner is not null and not exists (
    select 1 from public.submission_files f where f.id = p_banner and f.submission_id = p_submission
  ) then
    raise exception 'that banner isn''t one of this project''s files' using errcode = '22023';
  end if;
  v_settings := private.event_setting(v_sub.event_id, 'gallery');
  select id into v_current from public.submission_files where submission_id = p_submission and is_banner;
  if not v_manager then
    if v_current is distinct from p_banner and not coalesce((v_settings ->> 'teamBanners')::boolean, true) then
      raise exception 'your organizers choose the gallery banners' using errcode = '42501';
    end if;
    if v_sub.card_size is distinct from p_size and not coalesce((v_settings ->> 'teamSizes')::boolean, false) then
      raise exception 'your organizers choose the gallery card sizes' using errcode = '42501';
    end if;
  end if;

  update public.submission_files set is_banner = false where submission_id = p_submission and is_banner;
  if p_banner is not null then
    update public.submission_files set is_banner = true where id = p_banner;
  end if;
  update public.submissions set card_size = p_size where id = p_submission;
  perform private.audit(v_sub.event_id, 'submission.gallery_look_set', 'submission', p_submission,
    jsonb_build_object('size', p_size, 'banner', p_banner is not null));
end;
$$;

create table public.gallery_likes (
  event_id uuid not null,
  submission_id uuid not null,
  user_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, submission_id),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index gallery_likes_event_id_submission_id_fk_idx on public.gallery_likes (event_id, submission_id);
alter table public.gallery_likes enable row level security;
create policy gallery_likes_select_own on public.gallery_likes for select to authenticated
  using (user_id = (select auth.uid()) or (select private.can_manage(event_id)));

create table public.gallery_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  submission_id uuid not null,
  author_id uuid not null references public.profiles on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (event_id, submission_id) references public.submissions (event_id, id) on delete cascade
);
create index gallery_comments_event_id_submission_id_fk_idx on public.gallery_comments (event_id, submission_id, created_at);
create index gallery_comments_author_id_fk_idx on public.gallery_comments (author_id);
alter table public.gallery_comments enable row level security;
create policy gallery_comments_select_own on public.gallery_comments for select to authenticated
  using (author_id = (select auth.uid()) or (select private.can_manage(event_id)));

-- The public project a visitor is reacting to, and that the event's gallery settings allow it
create function private.gallery_target(p_submission uuid, p_setting text)
returns public.submissions
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  select * into v_sub from public.submissions where id = p_submission;
  if v_sub.id is null or v_sub.status <> 'submitted' or not v_sub.is_public
     or not private.gallery_open(v_sub.event_id) then
    raise exception 'that project isn''t in the gallery' using errcode = '22023';
  end if;
  if not coalesce((private.event_setting(v_sub.event_id, 'gallery') ->> p_setting)::boolean, false) then
    raise exception 'the organizers haven''t turned this on' using errcode = '42501';
  end if;
  return v_sub;
end;
$$;
revoke execute on function private.gallery_target(uuid, text) from anon, authenticated;

create function public.set_gallery_like(p_submission uuid, p_like boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.submissions;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  v_sub := private.gallery_target(p_submission, 'likes');
  if p_like then
    insert into public.gallery_likes (event_id, submission_id, user_id)
    values (v_sub.event_id, p_submission, v_uid)
    on conflict do nothing;
  else
    delete from public.gallery_likes where submission_id = p_submission and user_id = v_uid;
  end if;
end;
$$;

create function public.post_gallery_comment(p_submission uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sub public.submissions;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  v_sub := private.gallery_target(p_submission, 'comments');
  if length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    raise exception 'a comment is 1 to 1000 characters' using errcode = '22023';
  end if;
  insert into public.gallery_comments (event_id, submission_id, author_id, body)
  values (v_sub.event_id, p_submission, v_uid, btrim(p_body))
  returning id into v_id;
  perform private.audit(v_sub.event_id, 'gallery.comment_posted', 'submission', p_submission, '{}');
  return v_id;
end;
$$;

create function public.delete_gallery_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.gallery_comments;
begin
  select * into v_row from public.gallery_comments where id = p_comment;
  if v_row.id is null then
    return;
  end if;
  if v_row.author_id is distinct from (select auth.uid()) and not private.can_manage(v_row.event_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.gallery_comments where id = p_comment;
  perform private.audit(v_row.event_id, 'gallery.comment_removed', 'submission', v_row.submission_id, '{}');
end;
$$;

-- Likes and comments per project, only where the organizers turned them on
create function public.gallery_engagement(p_event uuid)
returns table (submission_id uuid, likes bigint, comments bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_settings jsonb := private.event_setting(p_event, 'gallery');
  v_likes boolean := coalesce((v_settings ->> 'likes')::boolean, false);
  v_comments boolean := coalesce((v_settings ->> 'comments')::boolean, false);
begin
  if not private.gallery_open(p_event) or not (v_likes or v_comments) then
    return;
  end if;
  return query
  select s.id,
    case when v_likes then (select count(*) from public.gallery_likes l where l.submission_id = s.id) else 0 end,
    case when v_comments then (select count(*) from public.gallery_comments c where c.submission_id = s.id) else 0 end
  from public.submissions s
  where s.event_id = p_event and s.status = 'submitted' and s.is_public;
end;
$$;

create function public.gallery_thread(p_submission uuid)
returns table (id uuid, body text, created_at timestamptz, author_id uuid, author_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.submissions;
begin
  select * into v_sub from public.submissions s where s.id = p_submission;
  if v_sub.id is null or v_sub.status <> 'submitted' or not v_sub.is_public
     or not private.gallery_open(v_sub.event_id)
     or not coalesce((private.event_setting(v_sub.event_id, 'gallery') ->> 'comments')::boolean, false) then
    return;
  end if;
  return query
  select c.id, c.body, c.created_at, c.author_id, p.display_name
  from public.gallery_comments c
  join public.profiles p on p.id = c.author_id
  where c.submission_id = p_submission
  order by c.created_at;
end;
$$;

grant execute on function public.set_gallery_look(uuid, text, uuid),
  public.set_gallery_like(uuid, boolean), public.post_gallery_comment(uuid, text),
  public.delete_gallery_comment(uuid) to authenticated;
grant execute on function public.gallery_engagement(uuid), public.gallery_thread(uuid)
to anon, authenticated;
