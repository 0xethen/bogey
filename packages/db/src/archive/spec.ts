import type { Tables } from "../types.ts";

type TableName =
  | "events"
  | "event_windows"
  | "divisions"
  | "tracks"
  | "event_pages"
  | "settings"
  | "onboarding_forms"
  | "event_members"
  | "event_role_grants"
  | "registrations"
  | "teams"
  | "team_members"
  | "announcements"
  | "announcement_audiences"
  | "session_slots"
  | "session_categories"
  | "event_sessions"
  | "session_hosts"
  | "session_signups"
  | "session_attendance"
  | "submission_forms"
  | "submission_items"
  | "submissions"
  | "submission_tracks"
  | "submission_files"
  | "votes"
  | "judging_rounds"
  | "round_entries"
  | "ranking_inputs"
  | "rubrics"
  | "criteria"
  | "submission_rubrics"
  | "judging_flags"
  | "deliberation_notes"
  | "judge_assignments"
  | "scores"
  | "feedback"
  | "judge_conflicts"
  | "awards"
  | "result_publications"
  | "checkins"
  | "audit_log";

type Column<T extends TableName> = keyof Tables<T> & string;

export type Ref = TableName | "user";

export interface TableSpec {
  table: TableName;
  id: string | null;
  event: string;
  refs: Readonly<Record<string, Ref>>;
  dates: readonly string[];
  clear: readonly string[];
  omit: readonly string[];
  replace: boolean;
  people: boolean;
  exportOnly: boolean;
}

interface Options<T extends TableName> {
  id?: Column<T> | null;
  event?: Column<T>;
  refs?: { [C in Column<T>]?: Ref };
  dates?: readonly Column<T>[];
  clear?: readonly Column<T>[];
  omit?: readonly Column<T>[];
  replace?: boolean;
  people?: boolean;
  exportOnly?: boolean;
}

function table<T extends TableName>(name: T, options: Options<T> = {}): TableSpec {
  return {
    table: name,
    id: options.id === undefined ? (name === "events" ? "id" : null) : options.id,
    event: options.event ?? (name === "events" ? "id" : "event_id"),
    refs: Object.fromEntries(
      Object.entries<Ref | undefined>(options.refs ?? {}).flatMap(([column, ref]) =>
        ref ? [[column, ref]] : [],
      ),
    ),
    dates: options.dates ?? [],
    clear: options.clear ?? [],
    omit: options.omit ?? [],
    replace: options.replace ?? false,
    people: options.people ?? false,
    exportOnly: options.exportOnly ?? false,
  };
}

export const ARCHIVE_TABLES: readonly TableSpec[] = [
  table("events", {
    dates: ["starts_at", "ends_at"],
    clear: ["created_by"],
  }),
  table("event_windows", { dates: ["opens_at", "closes_at"], clear: ["updated_by"] }),
  table("divisions", { id: "id" }),
  table("submission_forms", { id: "id" }),
  table("tracks", { id: "id", refs: { form_id: "submission_forms" } }),
  table("submission_items", { id: "id", refs: { form_id: "submission_forms" } }),
  table("judging_rounds", { id: "id", refs: { form_id: "submission_forms" }, replace: true }),
  table("rubrics", { id: "id" }),
  table("criteria", { id: "id", refs: { round_id: "judging_rounds", rubric_id: "rubrics" } }),
  table("event_pages", { id: "id" }),
  table("settings", { id: "id", clear: ["updated_by", "org_id"] }),
  table("onboarding_forms"),
  table("session_slots", { id: "id", dates: ["starts_at", "ends_at"] }),
  table("session_categories", { id: "id" }),
  table("event_sessions", {
    id: "id",
    refs: { slot_id: "session_slots", category_id: "session_categories" },
    dates: ["starts_at", "ends_at"],
  }),
  table("event_members", {
    refs: { user_id: "user", division_id: "divisions", added_by: "user" },
    people: true,
  }),
  table("event_role_grants", { refs: { user_id: "user", granted_by: "user" }, people: true }),
  table("registrations", {
    id: "id",
    refs: { user_id: "user", division_id: "divisions", reviewed_by: "user" },
    clear: ["invite_link_id"],
    dates: ["reviewed_at"],
    people: true,
  }),
  table("teams", {
    id: "id",
    refs: { division_id: "divisions", created_by: "user" },
    omit: ["invite_code"],
    dates: ["locked_at"],
    replace: true,
    people: true,
  }),
  table("team_members", {
    refs: { team_id: "teams", user_id: "user" },
    dates: ["joined_at"],
    people: true,
  }),
  table("announcements", {
    id: "id",
    refs: { author_id: "user" },
    dates: ["publish_at", "notified_at", "deleted_at"],
    people: true,
  }),
  table("announcement_audiences", {
    id: "id",
    refs: {
      announcement_id: "announcements",
      division_id: "divisions",
      team_id: "teams",
      session_id: "event_sessions",
    },
    people: true,
  }),
  table("session_hosts", { refs: { session_id: "event_sessions", user_id: "user" }, people: true }),
  table("session_signups", {
    refs: { slot_id: "session_slots", session_id: "event_sessions", user_id: "user" },
    people: true,
  }),
  table("session_attendance", {
    refs: { session_id: "event_sessions", user_id: "user", marked_by: "user" },
    people: true,
  }),
  table("submissions", {
    id: "id",
    refs: {
      form_id: "submission_forms",
      team_id: "teams",
      submitted_by: "user",
      deletion_requested_by: "user",
    },
    dates: ["submitted_at", "deletion_requested_at"],
    people: true,
  }),
  table("submission_tracks", {
    refs: { submission_id: "submissions", track_id: "tracks" },
    people: true,
  }),
  table("submission_files", {
    id: "id",
    refs: { submission_id: "submissions" },
    people: true,
  }),
  table("votes", { refs: { submission_id: "submissions", voter_id: "user" }, people: true }),
  table("round_entries", {
    refs: { round_id: "judging_rounds", submission_id: "submissions" },
    people: true,
  }),
  table("ranking_inputs", {
    refs: { round_id: "judging_rounds", submission_id: "submissions" },
    people: true,
  }),
  table("judge_assignments", {
    id: "id",
    refs: { judge_id: "user", submission_id: "submissions", round_id: "judging_rounds" },
    people: true,
  }),
  table("scores", {
    id: "id",
    refs: {
      submission_id: "submissions",
      judge_id: "user",
      criterion_id: "criteria",
      round_id: "judging_rounds",
    },
    people: true,
  }),
  table("feedback", {
    id: "id",
    refs: { submission_id: "submissions", judge_id: "user", round_id: "judging_rounds" },
    people: true,
  }),
  table("judge_conflicts", {
    refs: { judge_id: "user", team_id: "teams", declared_by: "user" },
    people: true,
  }),
  table("submission_rubrics", {
    refs: { submission_id: "submissions", rubric_id: "rubrics", set_by: "user" },
    people: true,
  }),
  table("judging_flags", {
    id: "id",
    refs: {
      submission_id: "submissions",
      round_id: "judging_rounds",
      raised_by: "user",
      resolved_by: "user",
    },
    dates: ["resolved_at"],
    people: true,
  }),
  table("deliberation_notes", {
    id: "id",
    refs: { flag_id: "judging_flags", author_id: "user" },
    people: true,
  }),
  table("awards", {
    id: "id",
    refs: {
      form_id: "submission_forms",
      track_id: "tracks",
      division_id: "divisions",
      submission_id: "submissions",
      created_by: "user",
    },
    people: true,
  }),
  table("result_publications", {
    id: "id",
    refs: { published_by: "user" },
    dates: ["published_at"],
    people: true,
  }),
  table("checkins", {
    refs: { user_id: "user", checked_in_by: "user" },
    dates: ["checked_in_at", "checked_out_at"],
    people: true,
  }),
  table("audit_log", { id: "id", refs: { actor_id: "user" }, exportOnly: true, people: true }),
];

export const ARCHIVE_FORMAT = 1;
