import { PLUGIN_KEY } from "@bogey/utils/keys";
export interface ConsistencyIssue {
  message: string;
}

function readTomlBoolean(content: string, section: string, key: string): boolean | undefined {
  const sectionRe = new RegExp(`^\\[${section.replace(/\./g, "\\.")}\\]\\s*$`, "m");
  const sectionMatch = sectionRe.exec(content);
  if (!sectionMatch) return undefined;

  const rest = content.slice(sectionMatch.index + sectionMatch[0].length);
  const nextSectionIndex = rest.search(/^\[/m);
  const body = nextSectionIndex === -1 ? rest : rest.slice(0, nextSectionIndex);

  const keyRe = new RegExp(`^${key}\\s*=\\s*(true|false)\\s*$`, "m");
  const keyMatch = keyRe.exec(body);
  return keyMatch ? keyMatch[1] === "true" : undefined;
}

export const HOOK_URI = "pg-functions://postgres/private/before_user_created";

export function checkAuthHookWiring(configTomlContent: string): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  const hookEnabled = readTomlBoolean(
    configTomlContent,
    "auth.hook.before_user_created",
    "enabled",
  );
  if (hookEnabled !== true) {
    issues.push({
      message:
        "[auth.hook.before_user_created] must be enabled; it enforces each org's registration.signup setting",
    });
  }

  const hookUri = /\[auth\.hook\.before_user_created\][^[]*?uri\s*=\s*"([^"]*)"/.exec(
    configTomlContent,
  )?.[1];
  if (hookEnabled === true && hookUri !== HOOK_URI) {
    issues.push({ message: `[auth.hook.before_user_created] uri must be "${HOOK_URI}"` });
  }

  const authSignup = readTomlBoolean(configTomlContent, "auth", "enable_signup");
  if (authSignup !== true) {
    issues.push({
      message:
        "[auth] enable_signup must stay `true`. The before_user_created hook is the real gate; " +
        "setting this to `false` prevents the hook from ever running, which defeats the gate entirely",
    });
  }

  const emailSignup = readTomlBoolean(configTomlContent, "auth.email", "enable_signup");
  if (emailSignup !== true) {
    issues.push({ message: "[auth.email] enable_signup must stay `true` for the same reason" });
  }

  return issues;
}

export function checkSelfHostedHookWiring(
  env: Record<string, string | undefined>,
): ConsistencyIssue[] {
  const declared = Object.keys(env).some((key) => key.startsWith("GOTRUE_"));
  if (!declared) return [];

  const issues: ConsistencyIssue[] = [];

  if (env.GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED !== "true") {
    issues.push({
      message:
        "GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED must be `true`. Without it the registration.signup " +
        "setting is not enforced and anyone can sign up, whatever the database says",
    });
  }

  const uri = env.GOTRUE_HOOK_BEFORE_USER_CREATED_URI;
  if (uri !== HOOK_URI) {
    issues.push({ message: `GOTRUE_HOOK_BEFORE_USER_CREATED_URI must be ${HOOK_URI}` });
  }

  if (env.GOTRUE_DISABLE_SIGNUP === "true") {
    issues.push({
      message:
        "GOTRUE_DISABLE_SIGNUP must not be `true`. The hook is the real gate, and disabling " +
        "signup outright stops it running (imports and invitations break too)",
    });
  }

  return issues;
}

export function checkPluginKeys(keys: Tuple<string>): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const seen = new Set<string>();

  for (const key of keys) {
    if (seen.has(key)) {
      issues.push({ message: `Plugin key "${key}" is listed twice` });
    }
    seen.add(key);

    if (!PLUGIN_KEY.test(key)) {
      issues.push({
        message: `Plugin key "${key}" must be 3-32 lowercase letters, digits and dashes`,
      });
    }
  }

  return issues;
}

export function checkDatabaseUrl(url: string | null): ConsistencyIssue[] {
  if (!url || !/^postgres(?:ql)?:\/\/postgres\.your-tenant-id[:@]/.test(url)) return [];
  return [
    {
      message:
        "Warning: DATABASE_URL uses the default pooler tenant (your-tenant-id). Set POOLER_TENANT_ID in " +
        'Supabase\'s .env to a real name (docs/self-hosting/supabase.md, "Connecting the CLI")',
    },
  ];
}

export function checkEnvFileSafety(envContent: string): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  for (const [, name] of envContent.matchAll(/^((?:PUBLIC|VITE)_\w*SERVICE_ROLE\w*)\s*=/gm)) {
    issues.push({
      message:
        `${name} is set. Rename it to SUPABASE_SERVICE_ROLE_KEY: ` +
        "PUBLIC_-prefixed variables are exposed to the client bundle",
    });
  }

  return issues;
}
