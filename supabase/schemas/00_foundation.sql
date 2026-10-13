set check_function_bodies = off;

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault with schema vault;

create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role, supabase_auth_admin;

alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

create type public.org_status as enum ('active', 'restricted', 'suspended');
create type public.org_role as enum ('member', 'admin', 'owner');
create type public.theme_pref as enum ('system', 'light', 'dark');
create type public.setting_scope as enum ('instance', 'org', 'event');

create type public.event_kind as enum ('hackathon', 'contest', 'custom');
create type public.event_visibility as enum ('draft', 'unlisted', 'public');
create type public.window_override as enum ('open', 'closed');
create type public.page_audience as enum ('members', 'public');

create type public.event_role as enum ('participant', 'staff', 'judge', 'organizer');
create type public.member_status as enum ('active', 'removed');
create type public.registration_source as enum ('import', 'link', 'self', 'invite');
create type public.registration_status as enum ('pending', 'approved', 'rejected', 'withdrawn', 'waitlisted');
create type public.team_role as enum ('captain', 'member');

create type public.announcement_severity as enum ('info', 'warning', 'urgent');
create type public.clarification_status as enum ('open', 'answered', 'closed');
create type public.clarification_visibility as enum ('private', 'public');

create type public.submission_status as enum ('draft', 'submitted', 'disqualified');
create type public.assignment_status as enum ('assigned', 'started', 'done', 'skipped');
create type public.feedback_visibility as enum ('judges', 'team');

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
