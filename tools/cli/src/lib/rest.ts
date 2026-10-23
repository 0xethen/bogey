import { busy } from "./activity.ts";
import { hostOf, REQUEST_TIMEOUT_MS, type Credentials } from "./credentials.ts";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function call<T>(
  credentials: Credentials,
  path: string,
  init: RequestInit = {},
): Promise<Result<T>> {
  return busy(`Talking to ${hostOf(credentials.url)}`, () => request<T>(credentials, path, init));
}

async function request<T>(
  credentials: Credentials,
  path: string,
  init: RequestInit,
): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(`${credentials.url}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...init,
      headers: {
        apikey: credentials.serviceKey,
        authorization: `Bearer ${credentials.serviceKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    return { ok: false, error: `Couldn't reach ${credentials.url}: ${String(error)}` };
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (response.ok) return { ok: false, error: `${path}: the server's answer isn't JSON` };
  }
  if (!response.ok) {
    const message =
      (body as { message?: string; msg?: string } | null)?.message ??
      (body as { msg?: string } | null)?.msg ??
      `HTTP ${response.status}`;
    return { ok: false, error: `${path}: ${message}` };
  }
  return { ok: true, data: body as T };
}

export function select<T>(
  credentials: Credentials,
  table: string,
  query: string,
): Promise<Result<T[]>> {
  return call<T[]>(credentials, `/rest/v1/${table}?${query}`);
}

export function insert<T>(
  credentials: Credentials,
  table: string,
  rows: object,
): Promise<Result<T[]>> {
  return call<T[]>(credentials, `/rest/v1/${table}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
}

export function update<T>(
  credentials: Credentials,
  table: string,
  query: string,
  row: object,
): Promise<Result<T[]>> {
  return call<T[]>(credentials, `/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(row),
  });
}

export function rpc<T>(credentials: Credentials, name: string, args: object): Promise<Result<T>> {
  return call<T>(credentials, `/rest/v1/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export function remove<T>(
  credentials: Credentials,
  table: string,
  query: string,
): Promise<Result<T[]>> {
  return call<T[]>(credentials, `/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { prefer: "return=representation" },
  });
}

export async function ensureUser(credentials: Credentials, email: string): Promise<Result<string>> {
  const found = await call<{ users?: Array<{ id: string; email?: string }> }>(
    credentials,
    `/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
  );
  if (!found.ok) return found;
  const existing = found.data.users?.find(
    (user) => user.email?.toLowerCase() === email.toLowerCase(),
  );
  if (existing) return { ok: true, data: existing.id };

  const created = await call<{ id: string }>(credentials, "/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, email_confirm: true, app_metadata: { bogey_provisioned: true } }),
  });
  return created.ok ? { ok: true, data: created.data.id } : created;
}

export function removeFiles(
  credentials: Credentials,
  bucket: string,
  paths: string[],
): Promise<Result<unknown>> {
  return call<unknown>(credentials, `/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: "DELETE",
    body: JSON.stringify({ prefixes: paths }),
  });
}
