import { expect, test } from "vite-plus/test";
import {
  buildManifest,
  planImport,
  remapJson,
  shiftTo,
  type ArchiveData,
  type Row,
} from "../src/archive/engine.ts";

function archive(): ArchiveData {
  const tables = new Map<string, Row[]>([
    [
      "events",
      [
        {
          id: "e1",
          org_id: "o-old",
          slug: "fall",
          name: "Fall",
          starts_at: "2026-10-09T13:00:00.000Z",
          ends_at: "2026-10-10T13:00:00.000Z",
          visibility: "public",
          created_by: "u1",
        },
      ],
    ],
    [
      "event_windows",
      [
        {
          event_id: "e1",
          key: "judging",
          opens_at: "2026-10-10T00:00:00.000Z",
          closes_at: null,
          updated_by: "u1",
        },
      ],
    ],
    ["submission_forms", [{ id: "f1", event_id: "e1", key: "project" }]],
    ["tracks", [{ id: "tr1", event_id: "e1", name: "Best", form_id: "f1" }]],
    ["judging_rounds", [{ id: "r1", event_id: "e1", form_id: "f1", ordinal: 1 }]],
    ["event_members", [{ event_id: "e1", user_id: "u1", role: "participant" }]],
    ["teams", [{ id: "t1", event_id: "e1", name: "A", invite_code: "abc" }]],
    [
      "team_members",
      [
        { event_id: "e1", team_id: "t1", user_id: "u1" },
        { event_id: "e1", team_id: "t1", user_id: "ghost" },
      ],
    ],
    [
      "submissions",
      [
        {
          id: "s1",
          event_id: "e1",
          form_id: "f1",
          team_id: "t1",
          answers: { pic: { path: "e1/t1/f1/a.png" } },
          submitted_by: "ghost",
        },
      ],
    ],
    [
      "submission_files",
      [{ id: "sf1", event_id: "e1", submission_id: "s1", storage_path: "e1/t1/f1/a.png" }],
    ],
    [
      "result_publications",
      [{ id: "rp1", event_id: "e1", rows: [{ submission_id: "s1", rank: 1 }], awards: [] }],
    ],
    [
      "announcements",
      [
        {
          id: "an1",
          event_id: "e1",
          also_notify: true,
          publish_at: "2026-10-09T12:00:00.000Z",
          author_id: "u1",
        },
      ],
    ],
  ]);
  return {
    manifest: buildManifest(
      {
        org: { slug: "o", name: "O" },
        event: { slug: "fall", name: "Fall" },
        people: [{ id: "u1", email: "a@x.test", displayName: "A" }],
        exportedAt: "2026-10-11T00:00:00Z",
      },
      tables,
    ),
    tables,
  };
}

let counter = 0;
const options = (people: boolean) => ({
  orgId: "o-new",
  slug: "fall-2027",
  shiftMs: 0,
  people,
  users: new Map([["u1", "u-new"]]),
  newId: () => `new-${++counter}`,
});

test("the manifest counts rows and lists the files rows point at", () => {
  const { manifest } = archive();
  expect(manifest.tables.teams).toBe(1);
  expect(manifest.files).toEqual([{ bucket: "submissions", path: "e1/t1/f1/a.png" }]);
});

test("without people only the setup comes back, under new ids, as a draft", () => {
  const plan = planImport(archive(), options(false));
  expect(plan.steps.map((step) => step.table)).toEqual([
    "events",
    "event_windows",
    "submission_forms",
    "tracks",
    "judging_rounds",
  ]);
  const event = plan.steps[0]!.rows[0]!;
  expect(event).toMatchObject({
    org_id: "o-new",
    slug: "fall-2027",
    visibility: "draft",
    created_by: null,
  });
  expect(event.id).toBe(plan.eventId);
  const track = plan.steps.find((step) => step.table === "tracks")!.rows[0]!;
  const form = plan.steps.find((step) => step.table === "submission_forms")!.rows[0]!;
  expect(track.form_id).toBe(form.id);
  expect(track.event_id).toBe(plan.eventId);
  expect(plan.steps.find((step) => step.table === "judging_rounds")!.replace).toBe(true);
});

test("with people, rows follow their parents and people are mapped", () => {
  const plan = planImport(archive(), options(true));
  const rows = (table: string) => plan.steps.find((step) => step.table === table)?.rows ?? [];
  const team = rows("teams")[0]!;
  expect(team).not.toHaveProperty("invite_code");
  expect(rows("team_members")).toHaveLength(1);
  expect(rows("team_members")[0]).toMatchObject({ team_id: team.id, user_id: "u-new" });
  expect(plan.skipped.team_members).toBe(1);
  const submission = rows("submissions")[0]!;
  expect(submission.team_id).toBe(team.id);
  expect(submission.submitted_by).toBeNull();
  expect(rows("announcements")[0]).toMatchObject({ also_notify: false, author_id: "u-new" });
});

test("files move with the ids in their paths, and snapshots point at the new rows", () => {
  const plan = planImport(archive(), options(true));
  const submission = plan.steps.find((step) => step.table === "submissions")!.rows[0]!;
  const file = plan.steps.find((step) => step.table === "submission_files")!.rows[0]!;
  expect(plan.files).toHaveLength(1);
  expect(plan.files[0]!.to).toBe(file.storage_path);
  expect(String(file.storage_path)).toMatch(
    new RegExp(`^${plan.eventId}/new-\\d+/new-\\d+/a.png$`),
  );
  expect(JSON.stringify(submission.answers)).toContain(String(file.storage_path));
  const published = plan.steps.find((step) => step.table === "result_publications")!.rows[0]!;
  expect(JSON.stringify(published.rows)).toContain(String(submission.id));
  expect(JSON.stringify(published.rows)).not.toContain('"s1"');
});

test("dates shift together", () => {
  const data = archive();
  const shiftMs = shiftTo(data, "2027-10-08T13:00:00.000Z");
  const plan = planImport(data, { ...options(false), shiftMs });
  expect(plan.steps[0]!.rows[0]).toMatchObject({
    starts_at: "2027-10-08T13:00:00.000Z",
    ends_at: "2027-10-09T13:00:00.000Z",
  });
  expect(plan.steps[1]!.rows[0]).toMatchObject({
    opens_at: "2027-10-09T00:00:00.000Z",
    closes_at: null,
  });
});

test("an archive from a newer format is refused", () => {
  const data = archive();
  expect(() =>
    planImport({ ...data, manifest: { ...data.manifest, format: 99 } }, options(false)),
  ).toThrow(/format 99/);
  expect(() => shiftTo(data, "not a date")).toThrow(/not a date/);
});

test("ids inside JSON and paths are replaced, other text is left alone", () => {
  const map = new Map([
    ["a", "A"],
    ["b", "B"],
  ]);
  expect(remapJson({ x: ["a", { y: "a/b/file.png" }], z: "plain", n: 3 }, map)).toEqual({
    x: ["A", { y: "A/B/file.png" }],
    z: "plain",
    n: 3,
  });
});
