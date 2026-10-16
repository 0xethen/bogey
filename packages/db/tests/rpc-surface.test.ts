import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const SIGNED_OUT = {
  calendar_feed:
    "a calendar app polls with a secret token and no session; unknown tokens get nothing",
  public_profile:
    "a portfolio page for signed-out visitors; shows a person only when their profile is public",
  public_announcements:
    "the feeds list a public event's announcements for everyone, which signed-out readers can't select",
  verify_certificate:
    "anyone with a certificate's code can see it and that it is genuine; revoked ones say so",
  event_agenda: "an agenda shared before approval, without hidden sessions or who hosts them",
  open_event:
    "opens a public event by its address; an unlisted one only to signed-in visitors, who are remembered",
  vote_counts: "counts votes only when the event lets the caller see them",
  invite_link_view: "the join page shows an invite before sign-in",
  org_for_host: "resolves the org from the hostname before sign-in",
  report_page: "anyone can report a public page; a trigger-free insert into a table nobody reads",
  suspended_org_for_host: "the suspension notice shows before sign-in",
  settings_for: "the sign-in page reads branding and sign-up settings",
};

const SIGNED_IN = {
  ...SIGNED_OUT,
  admin_mfa_status:
    "reads platform_admins and the instance setting to say whether a second factor is needed",
  event_archive_people:
    "org admins read the emails of an event's members for its archive; checked inside",
  portfolios_enabled: "reads the instance setting the Account page needs to offer a public page",
  my_certificates:
    "lists what the caller may claim, from check-ins, submissions, awards and their role",
  claim_certificate: "issues the caller one certificate they are eligible for, with a random code",
  issue_certificates:
    "organizers issue everyone's certificates in one step, notify them and audit it",
  revoke_certificate: "organizers withdraw a certificate and it is audited",
  save_certificate_template:
    "organizers (or org admins) set the wording of one kind of certificate",
  event_certificates:
    "organizers read every certificate of an event with its wording, to print them",
  create_calendar_token: "makes the caller's calendar token and stores only its hash",
  revoke_calendar_token: "deletes the caller's calendar token",
  create_webhook: "checks org admin or event manager, makes the signing secret and audits",
  update_webhook: "checks the caller manages the webhook, stops queued sends when it is disabled",
  delete_webhook: "checks the caller manages the webhook and audits it",
  rotate_webhook_secret: "makes a new signing secret, shown once, and audits it",
  resend_webhook_delivery: "queues a finished delivery again for someone who manages the webhook",
  advance_submissions:
    "moves entries into the next round, creates it, audits and tells the finalists",
  declare_conflict: "a judge bars themself from a team; moves their assignments and audits it",
  set_conflicts: "organizers record conflicts by judge email and team name in bulk",
  remove_conflict: "organizers lift a conflict and audit it",
  judge_calibration: "organizers read every judge's scoring pattern",
  team_scores: "teams read the averages judges gave them once results are published and shared",
  venue_code: "staff read the rotating self check-in code, made from a secret in Vault",
  my_badge: "the caller reads their own badge code, made on first use, which nobody can list",
  check_in: "staff look up a code they can't read; a person checks themself in with the venue code",
  undo_check_in: "staff undo a check-in and it is audited",
  check_out: "staff mark someone as left and it is audited",
  checkin_roster: "staff read everyone's email and check-in status",
  badge_sheet: "staff read every badge code to print them",
  check_in_walk_in: "staff register an email off the roster, then check them in",
  assign_tables: "numbers the expo tables across a form's entries and audits it",
  skip_submission:
    "a judge sets an absent team aside; creates the assignment row judges can't insert",
  cast_vote: "checks the voting window, who may vote, the cap and own-team rule, then audits",
  retract_vote: "takes back the caller's vote while voting is open and audits it",
  assign_round_robin: "organizers assign judges across teams they can't all read",
  cancel_submission_deletion: "clears a field teams can't write directly",
  check_in_session: "matches a code the caller can't read and records attendance",
  choose_session: "checks the slot kind, window and capacity, then audits the pick",
  choose_team_option:
    "sets the caller's own registration, which they can't write, to a team their import offered",
  complete_identity_setup: "sets event_members.identity_setup_at, which members can't write",
  create_event: "creates the event and its default windows and forms together",
  create_org: "platform admins only; checked inside",
  create_team: "creates the team and its captain membership together",
  delete_account: "platform admins only; deletes the auth user",
  delete_event: "org admins and the CLI only; returns the files to remove from storage",
  delete_submission: "applies the event's deletion policy for teams",
  email_hook_status: "platform admins only; reads the send-email hook's recent mail",
  event_agenda: "reads the agenda with seat counts and the caller's own picks and check-ins",
  event_blocked_access: "organizers see refused writes in an audit log only org admins read",
  event_attendance: "staff read every participant's attendance",
  event_network_status: "tells a member whether their network may change submissions",
  import_roster: "organizers import registrations and accounts together",
  inherited_settings: "reads the levels above a scope for its editors",
  instance_admins: "platform admins only; reads across orgs",
  instance_deletion_requests: "platform admins only; reads auth.users emails",
  instance_orgs: "platform admins only; reads across orgs",
  instance_reports: "platform admins only; reads reports across orgs",
  instance_people: "platform admins only; reads auth.users emails across orgs",
  instance_overview: "platform admins only; counts across orgs",
  remove_window: "refuses windows forms or pages still use, and audits the removal",
  org_limits:
    "an org admin or platform admin reads the org's limits and what it has used, including storage",
  notify_event:
    "a plugin tells event members something; checks the plugin, the caller's permission and the recipients",
  join_team: "joins by invite code, which members can't read",
  team_preview: "shows a code's team before joining, which members can't read",
  leave_session_slot: "drops the caller's pick while sign-ups are open",
  leave_team: "removes membership and hands off captaincy",
  disband_team: "a member deletes their whole team, as the event's teams.disband allows",
  new_team_code: "a captain replaces their team's invite code, which they can't write directly",
  choose_division:
    "participants move themselves between divisions the event lets them pick and leave",
  set_division: "organizers move someone, and a team of just them, between divisions",
  post_announcement: "posts with its audience rows in one transaction and audits it",
  clone_event: "copies one event's setup into a new one across many tables, for org admins",
  upload_limit_mb:
    "members read their org's upload cap, which is an instance or platform-admin setting",
  review_registrations: "approves or declines many registrations in one audited step, with a note",
  log_export: "records an export after checking the caller manages the event",
  log_event: "writes the audit log after checking the caller's event",
  preview_results: "organizers read scores across judges",
  publish_results: "snapshots results, which nobody writes directly",
  record_blocked_access: "audits a network refusal after the refused write rolled back",
  register_for_event: "creates the registration with the server-side status",
  roster_overlaps: "organizers see which other events a roster email is in",
  save_agenda: "replaces the agenda in one transaction and audits it",
  save_session_levels: "replaces session types' levels in one transaction and audits it",
  save_submission_form: "replaces a form's items in one transaction and audits it",
  save_awards: "replaces the drafted awards in one transaction and audits it",
  clear_event_data:
    "organizers' bulk clean-ups across tables, confirmed by the event's address and audited",
  set_submission_rubric:
    "checks who may pick a project's rubric (organizers, judges, its team) per the judging settings, and audits it",
  flag_submission:
    "a judge who may deliberate on a project flags it, once at a time, and it's audited",
  resolve_flag: "closes a flag for the judges deliberating on it, and audits it",
  add_deliberation_note: "adds a note to an open flag the caller deliberates on",
  save_prizes: "replaces the prize list in one transaction and audits it",
  set_submission_tracks: "applies the prize cap and opt-in rules, and audits the choice",
  save_criteria: "replaces the criteria list in one transaction",
  session_code: "check-in codes are readable only by whoever takes attendance",
  session_roster: "hosts read names of participants they can't otherwise see",
  set_attendance: "hosts and staff mark attendance, which nobody writes directly",
  set_org_limits: "platform admins only; the overrides table has no client policy",
  set_org_status: "platform admins only",
  set_report_handled: "platform admins only",
  set_platform_admin: "platform admins only; looks up auth.users",
  set_secret: "writes to Vault, which no client role can",
  set_team_membership: "organizers move people between teams",
  save_team_seeker: "the caller's own card on the team board, when the board is on",
  team_board_people:
    "lists people looking for a team, which members can't read directly, without anyone who isn't looking",
  save_team_opening: "the caller's team's post on the team board",
  team_board_openings:
    "lists teams looking for people with their size, which participants can't count",
  request_to_join_team: "asks a team with an open post and notifies its captain",
  invite_to_team: "invites someone who is looking and notifies them",
  team_requests_inbox: "the requests and invitations that involve the caller, with names",
  answer_team_request:
    "the captain or the invited person accepts or declines; joining inserts the membership members can't",
  withdraw_team_request: "the sender takes back a pending request or invitation",
  team_matching_overview:
    "organizers read everyone without a team with their cards, for the matcher",
  apply_team_matching: "organizers create the proposed teams and move people in one audited step",
  set_windows: "updates windows and audits the change together",
  submit_project: "changes status, which teams can't write directly",
  withdraw_registration: "sets the status, which registrants can't write directly",
};

const schemas = join(import.meta.dirname, "../../../supabase/schemas");
const sql = readdirSync(schemas)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(join(schemas, file), "utf8"))
  .join("\n");

const definers = [...sql.matchAll(/create function public\.(\w+)\(([\s\S]*?)\nas \$\$/g)]
  .filter((match) => /\bsecurity definer\b/.test(match[2]!))
  .map((match) => match[1]!);

function grantedTo(role: string): Set<string> {
  const names = new Set<string>();
  for (const grant of sql.matchAll(/grant execute on function([\s\S]*?)\bto\b([^;]+);/g)) {
    if (!new RegExp(`\\b${role}\\b`).test(grant[2]!)) continue;
    for (const name of grant[1]!.matchAll(/public\.(\w+)\(/g)) names.add(name[1]!);
  }
  return names;
}

test("every SECURITY DEFINER function signed-in users can call is listed", () => {
  const callable = grantedTo("authenticated");
  const exposed = definers.filter((name) => callable.has(name)).sort();
  expect(exposed).toEqual(Object.keys(SIGNED_IN).sort());
});

test("only the listed SECURITY DEFINER functions are callable signed out", () => {
  const callable = grantedTo("anon");
  const exposed = definers.filter((name) => callable.has(name)).sort();
  expect(exposed).toEqual(Object.keys(SIGNED_OUT).sort());
});
