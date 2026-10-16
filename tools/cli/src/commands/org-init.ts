import { loadConfig } from "@bogey/config/load";
import { SLUG, toSlug } from "@bogey/utils/keys";
import { step } from "../lib/activity.ts";
import { rpc, serviceCredentials } from "../lib/credentials.ts";
import { intro, type Prompter } from "../lib/prompt.ts";
import { ensureUser, insert, select, update } from "../lib/rest.ts";
import type { Credentials } from "../lib/credentials.ts";
import { findRepoRoot } from "../lib/repo-root.ts";
import { seedDemo } from "./seed.ts";
import { parseFlags } from "../lib/flags.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey org init [--org <slug> --name <name> --owner <email>] [--host <hostname>] [--demo] [--app-url <url>]

Sets up a fresh instance: creates its first org, maps --host to it, makes it the
default org, and makes --owner (created if needed) its owner and a platform
admin. Safe to run again for that same org; once an instance has an org, add
others with \`bogey org create\`. --demo also seeds a demo hackathon and contest.

At a terminal, it asks for whatever the flags leave out.

--app-url (or BOGEY_APP_URL, which the all-in-one compose sets to http://web:3000) is the
address the database calls to send Bogey's own email. It fills in the instance's app
address when that is empty, and --app-url replaces one that is set. When bogey.config.ts
sets appUrl, that wins and neither is used.

Example (self-hosted):
  bogey org init --org acme --name "Acme Hack Club" --owner you@acme.org --host hacks.acme.org`;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Answers {
  org: string;
  name: string;
  owner: string;
  host: string | undefined;
  demo: boolean;
}

export async function askOrgInit(
  prompter: Prompter,
  flags: Record<string, string | true>,
): Promise<Answers> {
  const given = (key: string) => (typeof flags[key] === "string" ? flags[key] : undefined);
  prompter.say(intro("bogey org init"));
  const name =
    given("name") ??
    (await prompter.text({
      message: "Organization name",
      placeholder: "Acme Hack Club",
      hint: "Shown across the site. You can change it later.",
    }));
  const org =
    given("org") ??
    (await prompter.text({
      message: "Address",
      initial: toSlug(name, 32) || undefined,
      hint: "A short lowercase name for links, like acme. Tab takes the suggestion.",
      validate: (value) =>
        SLUG.test(value) ? null : "Lowercase letters and digits, with dashes between.",
    }));
  const owner =
    given("owner") ??
    (await prompter.text({
      message: "Owner's email",
      placeholder: "you@example.org",
      hint: "They own the org and administer the instance. Created if they don't exist.",
      validate: (value) => (EMAIL.test(value) ? null : "An email address, like you@example.org."),
    }));
  const host =
    given("host") ??
    ((await prompter.text({
      message: "Hostname",
      placeholder: "hacks.example.org",
      hint: "Requests to it open this org. Blank for none.",
      optional: true,
    })) ||
      undefined);
  const demo =
    flags.demo === true ||
    (await prompter.confirm({
      message: "Add a demo hackathon and contest to look around in?",
      initial: false,
    }));
  return { org, name, owner, host, demo };
}

export function orgInitCommand(answers: Answers): string {
  const quote = (value: string) =>
    /^[\w@.:/-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
  return [
    "bogey org init",
    `--org ${quote(answers.org)}`,
    `--name ${quote(answers.name)}`,
    `--owner ${quote(answers.owner)}`,
    ...(answers.host ? [`--host ${quote(answers.host)}`] : []),
    ...(answers.demo ? ["--demo"] : []),
  ].join(" ");
}

async function setAppUrl(
  credentials: Credentials,
  appUrl: string,
  replace: boolean,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const query = "scope=eq.instance&namespace=eq.tenancy";
  const found = await select<{ value: Record<string, unknown> }>(
    credentials,
    "settings",
    `${query}&select=value`,
  );
  if (!found.ok) return found;
  const current = found.data[0];
  if (!current) {
    const made = await insert(credentials, "settings", {
      scope: "instance",
      namespace: "tenancy",
      value: { appUrl },
    });
    return made.ok ? { ok: true, changed: true } : made;
  }
  if (current.value.appUrl && !replace) return { ok: true, changed: false };
  const changed = await update(credentials, "settings", query, {
    value: { ...current.value, appUrl },
  });
  return changed.ok ? { ok: true, changed: true } : changed;
}

export async function runOrgInit(
  cwd: string,
  args: string[],
  prompter: Prompter | null = null,
): Promise<CliResult> {
  const flags = parseFlags(args);
  const given = { org: flags.org, name: flags.name, owner: flags.owner };
  const complete =
    typeof given.org === "string" &&
    typeof given.name === "string" &&
    typeof given.owner === "string";
  if (!complete && !prompter) return { exitCode: 1, output: USAGE };

  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  const credentials = resolved.credentials;

  const existing = await select<{ slug: string }>(credentials, "orgs", "select=slug");
  if (!existing.ok) return { exitCode: 1, output: existing.error };
  const slugs = existing.data.map((row) => row.slug);
  if (slugs.length > 0 && !(typeof given.org === "string" && slugs.includes(given.org))) {
    return {
      exitCode: 1,
      output: `This instance already has its first organization (${slugs.join(", ")}). Add another with \`bogey org create\`.`,
    };
  }

  let answers: Answers;
  let asked = false;
  if (complete) {
    answers = {
      org: given.org as string,
      name: given.name as string,
      owner: given.owner as string,
      host: typeof flags.host === "string" ? flags.host : undefined,
      demo: flags.demo === true,
    };
  } else {
    answers = await askOrgInit(prompter!, flags);
    asked = true;
  }
  const { org, name, owner, host } = answers;

  const user = await step(`Find or create ${owner}'s account`, () =>
    ensureUser(credentials, owner),
  );
  if (!user.ok)
    return { exitCode: 1, output: `Couldn't set up ${owner}'s account.\n${user.error}` };

  const result = await step(`Create the org "${name}"`, () =>
    rpc(credentials, "bogey_bootstrap", {
      p_org_slug: org,
      p_org_name: name,
      p_hostname: host ?? null,
      p_owner: user.data,
    }),
  );
  if (!result.ok) return { exitCode: 1, output: `Couldn't create the org.\n${result.error}` };

  const lines = [`✓ Org "${name}" (${org}) is ready; ${owner} owns it and is a platform admin.`];
  if (host) lines.push(`Requests to ${host} resolve to it.`);

  const appUrl =
    typeof flags["app-url"] === "string" ? flags["app-url"] : process.env.BOGEY_APP_URL;
  const declared = declaredAppUrl(cwd);
  if (declared) {
    lines.push(`Queued email is sent by calling ${declared}, from appUrl in bogey.config.ts.`);
  } else if (appUrl) {
    const set = await setAppUrl(credentials, appUrl, typeof flags["app-url"] === "string");
    if (!set.ok) return { exitCode: 1, output: set.error };
    if (set.changed) lines.push(`Queued email is sent by calling ${appUrl}.`);
  } else {
    lines.push(
      "Queued email and webhooks need appUrl in bogey.config.ts (or run again with --app-url <address>).",
    );
  }

  if (answers.demo) {
    const seeded = await step("Seed the demo events", () =>
      seedDemo(cwd, credentials, String(result.data)),
    );
    if (!seeded.ok) return { exitCode: 1, output: seeded.error };
    lines.push(`Seeded ${seeded.data.join(", ")}.`);
  }

  lines.push("", `Sign in: bogey login ${owner}`);
  if (asked) lines.push(`Next time, without the questions: ${orgInitCommand(answers)}`);
  return { exitCode: 0, output: lines.join("\n") };
}

function declaredAppUrl(cwd: string): string | null {
  try {
    const value = loadConfig(process.env, findRepoRoot(cwd)).config.operator.tenancy?.appUrl;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
