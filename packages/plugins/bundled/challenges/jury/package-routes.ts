import { strToU8 } from "fflate";
import type { PluginServerContext } from "@bogey/plugins/runtime";
import type { Json } from "@bogey/db/types";
import type { ChallengesDatabase } from "../db.ts";
import {
  PackageError,
  extensionFor,
  readPackage,
  safeFileName,
  writePackage,
  type PackageFile,
  type PackageSolution,
  type PackageTest,
  type ParsedPackage,
  type ProblemPackage,
} from "../format/package-format.ts";

const BUCKET = "attachments";
const BATCH_BYTES = 4 * 1024 * 1024;

type Db = ReturnType<typeof clientOf>;
const clientOf = (ctx: PluginServerContext) => ctx.supabaseFor<ChallengesDatabase>();

const reply = (status: number, body: Record<string, unknown>): Response =>
  Response.json(body, { status });

const slugify = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug === "" ? "problem" : slug;
};

const bytesOf = (text: string) => strToU8(text).length;

function batches<T extends { input: string; answer: string }>(rows: Tuple<T>): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const row of rows) {
    const weight = bytesOf(row.input) + bytesOf(row.answer) + 200;
    if (current.length > 0 && size + weight > BATCH_BYTES) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += weight;
  }
  if (current.length > 0) out.push(current);
  return out;
}

async function writeTests(
  db: Db,
  eventId: string,
  problemId: string,
  tests: Tuple<PackageTest>,
): Promise<void> {
  const removed = await db.from("challenges_testcases").delete().eq("problem_id", problemId);
  if (removed.error) throw new Error(removed.error.message);
  let ordinal = 0;
  const rows = tests.map((test) => ({
    event_id: eventId,
    problem_id: problemId,
    ordinal: ++ordinal,
    is_sample: test.isSample,
    group_key: test.groupKey,
    points: test.points,
    input: test.input,
    answer: test.answer,
  }));
  for (const batch of batches(rows)) {
    const { error } = await db.from("challenges_testcases").insert(batch);
    if (error) throw new Error(error.message);
  }
}

async function writeAttachments(
  ctx: PluginServerContext,
  db: Db,
  eventId: string,
  problemId: string,
  files: Tuple<PackageFile>,
): Promise<void> {
  for (const file of files) {
    const path = `${eventId}/${problemId}/${file.name}`;
    const upload = await ctx.supabase.storage.from(BUCKET).upload(path, file.bytes, {
      upsert: true,
      contentType: "application/octet-stream",
    });
    if (upload.error) throw new Error(upload.error.message);
    const { error } = await db
      .from("challenges_attachments")
      .upsert(
        { event_id: eventId, problem_id: problemId, name: file.name, storage_path: path },
        { onConflict: "storage_path" },
      );
    if (error) throw new Error(error.message);
  }
}

function problemValues(read: ParsedPackage) {
  const groups: Json = Object.fromEntries(
    Object.entries(read.groups).map(([key, rule]) => [
      key,
      { aggregation: rule.aggregation, stopOnFail: rule.stopOnFail },
    ]),
  );
  return {
    title: read.name,
    statement_md: read.statementMd,
    time_limit_ms: read.timeLimitMs,
    memory_limit_mb: read.memoryLimitMb,
    output_limit_kb: read.outputLimitKb,
    checker: read.checker,
    checker_tolerance: read.tolerance,
    checker_source: read.validator?.source ?? null,
    checker_language: read.validator?.language ?? null,
    test_groups: groups,
    ...(read.points === null ? {} : { points: read.points }),
  };
}

export async function importPackage(request: Request, ctx: PluginServerContext): Promise<Response> {
  if (!ctx.user) return reply(401, { error: "Sign in first." });
  if (!ctx.eventId) return reply(400, { error: "Name the event with ?event=." });
  const eventId = ctx.eventId;
  const params = new URL(request.url).searchParams;
  const replace = params.get("replace");
  const label = (params.get("label") ?? "").trim();
  if (!replace && label === "") return reply(400, { error: "Give the problem an ID." });

  let read: ParsedPackage;
  try {
    read = readPackage(await ctx.body());
  } catch (error) {
    if (error instanceof PackageError) return reply(400, { error: error.message });
    throw error;
  }

  const db = clientOf(ctx);
  const warnings = [...read.warnings];

  const languages = await db.from("challenges_languages").select("key").eq("enabled", true);
  if (languages.error) return reply(500, { error: "Couldn't load the languages." });
  const known = new Set(languages.data.map((language) => language.key));
  if (read.validator && !known.has(read.validator.language)) {
    return reply(400, {
      error: `The checker's language (${read.validator.language}) isn't enabled.`,
    });
  }
  const solutions = read.solutions.filter((solution) => {
    if (known.has(solution.language)) return true;
    warnings.push(
      `A jury solution in ${solution.language} was skipped: that language isn't enabled.`,
    );
    return false;
  });

  let problemId: string;
  let slug: string;
  let created = false;
  if (replace) {
    const found = await db
      .from("challenges_problems")
      .select("id, slug")
      .eq("id", replace)
      .eq("event_id", eventId)
      .maybeSingle();
    if (!found.data) return reply(404, { error: "That problem isn't in this event." });
    const { error } = await db
      .from("challenges_problems")
      .update(problemValues(read))
      .eq("id", replace);
    if (error) return reply(400, { error: error.message });
    problemId = replace;
    slug = found.data.slug;
  } else {
    const base = (params.get("slug") ?? "").trim() || slugify(read.name);
    let made: { id: string; slug: string } | null = null;
    for (let attempt = 1; attempt <= 5 && !made; attempt++) {
      const candidate = attempt === 1 ? base : `${base.slice(0, 58)}-${attempt}`;
      const { data, error } = await db
        .from("challenges_problems")
        .insert({
          event_id: eventId,
          label,
          slug: candidate,
          visible: false,
          ...problemValues(read),
        })
        .select("id, slug")
        .single();
      if (data) {
        made = data;
        break;
      }
      if (error?.code !== "23505")
        return reply(400, { error: error?.message ?? "Couldn't add it." });
      if (!error.message.includes("slug")) {
        return reply(409, { error: "Another problem already has that ID." });
      }
    }
    if (!made) return reply(409, { error: "Another problem already has that URL name." });
    problemId = made.id;
    slug = made.slug;
    created = true;
  }

  try {
    await writeTests(db, eventId, problemId, read.tests);
    await writeAttachments(ctx, db, eventId, problemId, read.attachments);
    let added = 0;
    for (const solution of solutions) {
      const { error } = await db.rpc("challenges_add_jury_solution", {
        p_problem: problemId,
        p_language: solution.language,
        p_source: solution.source,
        p_expected: solution.expected,
        p_label: solution.label,
      });
      if (error)
        warnings.push(`The jury solution "${solution.label}" wasn't added: ${error.message}`);
      else added++;
    }
    const logged = await db.rpc("challenges_log_package", {
      p_problem: problemId,
      p_imported: true,
      p_tests: read.tests.length,
    });
    if (logged.error) throw new Error(logged.error.message);
    return reply(200, {
      problemId,
      slug,
      tests: read.tests.length,
      attachments: read.attachments.length,
      solutions: added,
      warnings,
    });
  } catch (error) {
    if (created) await db.from("challenges_problems").delete().eq("id", problemId);
    return reply(400, { error: error instanceof Error ? error.message : "The import failed." });
  }
}

export async function exportPackage(request: Request, ctx: PluginServerContext): Promise<Response> {
  if (!ctx.user) return reply(401, { error: "Sign in first." });
  if (!ctx.eventId) return reply(400, { error: "Name the event with ?event=." });
  const problemId = new URL(request.url).searchParams.get("problem");
  if (!problemId) return reply(400, { error: "Name the problem with ?problem=." });
  const db = clientOf(ctx);

  const problem = await db
    .from("challenges_problems")
    .select(
      "id, slug, title, statement_md, time_limit_ms, memory_limit_mb, output_limit_kb, checker, checker_tolerance",
    )
    .eq("id", problemId)
    .eq("event_id", ctx.eventId)
    .maybeSingle();
  if (!problem.data) return reply(404, { error: "That problem isn't in this event." });
  const row = problem.data;

  const hidden = await db.rpc("challenges_checker_source", { p_problem: problemId });
  if (hidden.error) return reply(403, { error: "Only the jury can export a problem." });
  const secret = hidden.data[0];

  const [cases, attached, jury] = await Promise.all([
    db
      .from("challenges_testcases")
      .select("ordinal, is_sample, group_key, points, input, answer")
      .eq("problem_id", problemId)
      .order("ordinal"),
    db.from("challenges_attachments").select("name, storage_path").eq("problem_id", problemId),
    db
      .from("challenges_solutions")
      .select("language_key, source, expected_verdict, jury_label")
      .eq("problem_id", problemId)
      .is("team_id", null),
  ]);
  if (cases.error || attached.error || jury.error) {
    return reply(500, { error: "Couldn't read the problem." });
  }

  const attachments: PackageFile[] = [];
  const taken = new Set<string>();
  for (const file of attached.data) {
    const download = await ctx.supabase.storage.from(BUCKET).download(file.storage_path);
    if (download.error) return reply(500, { error: `Couldn't read "${file.name}".` });
    const name = safeFileName(file.name, taken);
    taken.add(name);
    attachments.push({ name, bytes: new Uint8Array(await download.data.arrayBuffer()) });
  }

  const groups: ProblemPackage["groups"] = parseGroups(secret?.test_groups);
  const solutions: PackageSolution[] = jury.data.flatMap((each) =>
    each.expected_verdict
      ? [
          {
            label: each.jury_label ?? "solution",
            language: each.language_key,
            source: each.source,
            expected: each.expected_verdict,
          },
        ]
      : [],
  );
  const validator =
    row.checker === "custom" && secret?.checker_source && secret.checker_language
      ? {
          language: secret.checker_language,
          filename: `checker.${extensionFor(secret.checker_language)}`,
          source: secret.checker_source,
        }
      : null;

  const bytes = writePackage({
    name: row.title,
    timeLimitMs: row.time_limit_ms,
    memoryLimitMb: row.memory_limit_mb,
    outputLimitKb: row.output_limit_kb,
    checker: row.checker,
    tolerance: row.checker_tolerance,
    validator,
    statementMd: row.statement_md,
    tests: cases.data.map((each) => ({
      isSample: each.is_sample,
      groupKey: each.group_key,
      points: each.points,
      input: each.input,
      answer: each.answer,
    })),
    groups,
    attachments,
    solutions,
  });

  const logged = await db.rpc("challenges_log_package", {
    p_problem: problemId,
    p_imported: false,
    p_tests: cases.data.length,
  });
  if (logged.error) return reply(500, { error: "Couldn't record the export." });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${row.slug}.zip"`,
    },
  });
}

function parseGroups(value: Json | undefined): ProblemPackage["groups"] {
  const out: Record<string, { aggregation: "sum" | "min"; stopOnFail: boolean }> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return out;
  for (const [key, rule] of Object.entries(value)) {
    if (typeof rule !== "object" || rule === null || Array.isArray(rule)) continue;
    out[key] = {
      aggregation: rule.aggregation === "min" ? "min" : "sum",
      stopOnFail: rule.stopOnFail === true,
    };
  }
  return out;
}
