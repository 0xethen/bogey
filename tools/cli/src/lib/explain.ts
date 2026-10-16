const HINTS: Tuple<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /\bEPIPE\b/,
    hint: "The program stopped reading its input early. It usually hit an error or lost its connection before it could finish.",
  },
  {
    pattern: /column "[^"]+" of relation "[^"]+" contains null values/i,
    hint: "A NOT NULL column can't be added to a table that already has rows unless it has a default. Add it manually (nullable, fill it in, then `set not null`), then run this again.",
  },
  {
    pattern: /password authentication failed/i,
    hint: "The database refused the password. Check DATABASE_URL in .env (special characters in the password must be percent-encoded, like `@` is `%40`).",
  },
  {
    pattern: /could not translate host name|ENOTFOUND|getaddrinfo/i,
    hint: "That host name doesn't resolve. Check the URL for typos, and that you're online.",
  },
  {
    pattern: /Connection refused|ECONNREFUSED/i,
    hint: "Nothing is listening there. Is the database (or `supabase start`) running, and is the port right?",
  },
  {
    pattern: /timeout expired|ETIMEDOUT|timed out|aborted due to timeout|TimeoutError/i,
    hint: "The connection timed out. The host is down, a firewall is in the way, or the port is wrong.",
  },
  {
    pattern: /Network is unreachable|ENETUNREACH|EHOSTUNREACH/i,
    hint: "That address isn't reachable from here. Supabase's direct connection is IPv6-only; on an IPv4 network use the session pooler URL (port 5432 on pooler.supabase.com).",
  },
  {
    pattern: /prepared statement .* already exists|Tenant or user not found/i,
    hint: "This looks like a connection pooler problem. Use the session pooler (port 5432) or the direct connection, not the transaction pooler (6543).",
  },
  {
    pattern: /does not support SSL|server does not support SSL|SSL is not enabled on the server/i,
    hint: "That database doesn't speak TLS (common for a self-hosted one on a private network). Add ?sslmode=disable to the database URL.",
  },
  {
    pattern:
      /^(?![\s\S]*(?:does not support SSL|SSL is not enabled))[\s\S]*(?:SSL|sslmode|certificate)/i,
    hint: "The connection's encryption didn't work out. Try adding ?sslmode=require to the database URL.",
  },
  {
    pattern: /permission denied|must be owner of/i,
    hint: "The database user can't do this. Use the postgres (owner) connection string from your project's database settings.",
  },
  {
    pattern: /deadlock detected|could not obtain lock|lock timeout/i,
    hint: "Another connection (the app, or one of Bogey's every-minute cron jobs) kept holding a lock this needed, even after a few retries. Nothing was left half-done; run it again.",
  },
  {
    pattern: /fetch failed|Couldn't reach/i,
    hint: "The server didn't answer. Check SUPABASE_URL in .env, relevant DNS config, and that the project is running.",
  },
  {
    pattern: /Invalid API key|invalid JWT|JWSError|HTTP 401/i,
    hint: "The key was refused. Check SUPABASE_SERVICE_ROLE_KEY in .env is this project's secret key.",
  },
  {
    pattern: /Could not find the function|function .* does not exist/i,
    hint: "The database is missing a function this needs (it's probably behind the code). Run bogey db migrate; if that says it's up to date, bogey db repair.",
  },
  {
    pattern: /relation "[^"]+" does not exist|Could not find the table/i,
    hint: "The database is missing a table this needs (it's probably behind the code). Run bogey db migrate; if that says it's up to date, bogey db repair.",
  },
  {
    pattern:
      /(relation|type|function|schema|constraint|trigger|policy) "[^"]+" (for [^"]+ )?already exists/i,
    hint: "The database already has what this migration creates: it was probably set up without recording migrations. bogey db repair brings it in line and records the baseline; bogey db mark-applied records one without running it.",
  },
  {
    pattern: /role "[^"]+" does not exist|database "[^"]+" does not exist/i,
    hint: "The user or database name in the URL is wrong. Check DATABASE_URL in .env (a pooler URL's user is postgres.<tenant>).",
  },
  {
    pattern: /Cannot connect to the Docker daemon|docker daemon/i,
    hint: "Docker isn't running. Start Docker Desktop (or the docker service) and try again.",
  },
  {
    pattern: /\bEACCES\b/,
    hint: "No permission to read or write that file. Check who owns it locally (try `ls -l` in your Supabase installation)",
  },
  {
    pattern: /\bENOSPC\b|No space left on device/i,
    hint: "The disk is full.",
  },
  {
    pattern: /Unexpected token .* in JSON|is not valid JSON/i,
    hint: "A server answered with something that isn't JSON, often an HTML error page. Check the URL points at Supabase itself.",
  },
];

export function explain(text: string): string[] {
  return HINTS.filter(({ pattern }) => pattern.test(text)).map(({ hint }) => hint);
}
