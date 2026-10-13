import { unknownSubcommand } from "../lib/suggest.ts";
import { step } from "../lib/activity.ts";
import type { Prompter, TextQuestion } from "../lib/prompt.ts";
import { rpc, serviceCredentials, type Credentials } from "../lib/credentials.ts";
import { ensureUser, insert, remove, select } from "../lib/rest.ts";
import { parseFlags } from "../lib/flags.ts";
import { runOrgInit } from "./org-init.ts";
import type { CliResult } from "../cli.ts";

export const USAGE = `bogey org <subcommand>

  bogey org list
  bogey org init [--org <slug> --name <name> --owner <email>] [--host <hostname>] [--demo] [--app-url <url>]
  bogey org create --org <slug> --name <name> --owner <email> [--host <hostname>]
  bogey org domain add <slug> <hostname>
  bogey org domain remove <hostname>

create makes --owner (created if needed) the org's owner, but not a platform
admin; use \`bogey org init\` for an instance's first org (the default org, whose
owner is a platform admin; \`bogey setup\` offers it too). Hostnames added here
count as verified, so hosted mode issues certificates for them.`;

const HOSTNAME = /^[a-z0-9.-]+(:[0-9]+)?$/;

interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  org_domains: { hostname: string; is_primary: boolean }[];
}

async function list(credentials: Credentials): Promise<CliResult> {
  const orgs = await step("Load organizations", () =>
    select<OrgRow>(
      credentials,
      "orgs",
      "select=id,slug,name,status,org_domains(hostname,is_primary)&order=created_at",
    ),
  );
  if (!orgs.ok) return { exitCode: 1, output: orgs.error };
  if (orgs.data.length === 0) return { exitCode: 0, output: "No organizations yet." };
  const width = Math.max(...orgs.data.map((org) => org.slug.length));
  const lines = orgs.data.map((org) => {
    const hosts = [...org.org_domains]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map((domain) => domain.hostname);
    const status = org.status === "active" ? "" : ` (${org.status})`;
    return `${org.slug.padEnd(width)}  ${org.name}${status}  ${hosts.join(", ") || "no hostname"}`;
  });
  return { exitCode: 0, output: lines.join("\n") };
}

async function create(
  credentials: Credentials,
  args: string[],
  prompter: Prompter | null,
): Promise<CliResult> {
  const flags = parseFlags(args);
  const ask = async (value: string | true | undefined, question: TextQuestion) =>
    typeof value === "string" ? value : prompter ? await prompter.text(question) : undefined;
  const org = await ask(flags.org, {
    message: "Address",
    hint: "A short lowercase name, like acme",
    validate: (value) => (/^[a-z0-9-]+$/.test(value) ? null : "Lowercase letters, digits and -."),
  });
  const name = await ask(flags.name, { message: "Name" });
  const owner = await ask(flags.owner, { message: "Owner's email" });
  const host =
    typeof flags.host === "string" || flags.org !== undefined
      ? flags.host
      : await ask(undefined, { message: "Hostname", hint: "Blank for none", optional: true });
  if (!org || !name || !owner) return { exitCode: 1, output: USAGE };
  if (typeof host === "string" && host && !HOSTNAME.test(host.toLowerCase())) {
    return { exitCode: 1, output: `"${host}" isn't a hostname` };
  }
  const user = await step(`Find or create ${owner}'s account`, () =>
    ensureUser(credentials, owner),
  );
  if (!user.ok) return { exitCode: 1, output: user.error };
  const created = await step(`Create the org "${name}"`, () =>
    rpc(credentials, "bogey_create_org", {
      p_org_slug: org,
      p_org_name: name,
      p_hostname: typeof host === "string" && host ? host : null,
      p_owner: user.data,
    }),
  );
  if (!created.ok) return { exitCode: 1, output: created.error };
  return {
    exitCode: 0,
    output: `✓ Org "${name}" (${org}) is ready; ${owner} owns it.${typeof host === "string" && host ? ` ${host} resolves to it.` : ""}`,
  };
}

async function domain(credentials: Credentials, args: string[]): Promise<CliResult> {
  const [action, ...rest] = args;
  if (action === "add") {
    const [slug, host] = rest;
    if (!slug || !host || !HOSTNAME.test(host.toLowerCase())) return { exitCode: 1, output: USAGE };
    const orgs = await select<{ id: string }>(
      credentials,
      "orgs",
      `select=id&slug=eq.${encodeURIComponent(slug)}`,
    );
    if (!orgs.ok) return { exitCode: 1, output: orgs.error };
    const org = orgs.data[0];
    if (!org) return { exitCode: 1, output: `No org "${slug}". \`bogey org list\` shows them.` };
    const added = await insert(credentials, "org_domains", {
      hostname: host.toLowerCase(),
      org_id: org.id,
      verified_at: new Date().toISOString(),
    });
    if (!added.ok) return { exitCode: 1, output: added.error };
    return { exitCode: 0, output: `✓ ${host} now resolves to ${slug}.` };
  }
  if (action === "remove") {
    const [host] = rest;
    if (!host) return { exitCode: 1, output: USAGE };
    const removed = await remove(
      credentials,
      "org_domains",
      `hostname=eq.${encodeURIComponent(host.toLowerCase())}`,
    );
    if (!removed.ok) return { exitCode: 1, output: removed.error };
    return removed.data.length
      ? { exitCode: 0, output: `✓ ${host} no longer resolves to an org.` }
      : { exitCode: 1, output: `No org uses ${host}.` };
  }
  return { exitCode: 1, output: USAGE };
}

export async function runOrg(
  cwd: string,
  given: string[],
  prompter: Prompter | null = null,
): Promise<CliResult> {
  const args = [...given];
  if (args.length === 0 && prompter) {
    const picked = await prompter.select({
      message: "Organizations",
      options: [
        { value: "list", label: "List them" },
        { value: "init", label: "Set up the first one" },
        { value: "create", label: "Create one" },
        { value: "domain add", label: "Point a hostname at one" },
        { value: "domain remove", label: "Remove a hostname" },
      ],
    });
    args.push(...picked.split(" "));
    if (picked.startsWith("domain")) {
      if (picked === "domain add")
        args.push(await prompter.text({ message: "Org address (slug)" }));
      args.push(await prompter.text({ message: "Hostname", hint: "Like hack.example.com" }));
    }
  }
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help") return { exitCode: 0, output: USAGE };
  if (!["list", "init", "create", "domain"].includes(subcommand)) {
    return {
      exitCode: 1,
      output: unknownSubcommand("org", subcommand, ["list", "init", "create", "domain"]),
    };
  }
  const resolved = serviceCredentials(cwd);
  if (!resolved.ok) return { exitCode: 1, output: resolved.error };
  switch (subcommand) {
    case "list":
      return list(resolved.credentials);
    case "init":
      return runOrgInit(cwd, rest, prompter);
    case "create":
      return create(resolved.credentials, rest, prompter);
    default:
      return domain(resolved.credentials, rest);
  }
}
