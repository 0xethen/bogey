import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { createServerClient } from "../server.ts";
import { fail, ok, retryPolicy, toFailure, unwrap, type DbResult } from "../errors.ts";
import { jsonRecord, type Enums, type Json } from "../types.ts";
import { requireId, requireOneOf, requireSlug, requireText } from "./validate.ts";

export type OrgStatus = Enums<"org_status">;

export interface InstanceOverview {
  orgs: number;
  events: number;
  people: number;
  admins: number;
  migrations: string[] | null;
  setUpAt: string | null;
  settingsChangedAt: string | null;
  outbox: {
    queued: number;
    oldestQueuedAt: string | null;
    failed24h: number;
    lastError: string | null;
  };
}

function readOutbox(raw: Json | undefined): InstanceOverview["outbox"] {
  const outbox = jsonRecord(raw);
  return {
    queued: typeof outbox.queued === "number" ? outbox.queued : 0,
    oldestQueuedAt: typeof outbox.oldestQueuedAt === "string" ? outbox.oldestQueuedAt : null,
    failed24h: typeof outbox.failed24h === "number" ? outbox.failed24h : 0,
    lastError: typeof outbox.lastError === "string" ? outbox.lastError : null,
  };
}

export const instanceOverviewFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<InstanceOverview>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_overview");
    if (error) return toFailure(error, "loading the instance");
    const counts = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const count = (key: string) => (typeof counts[key] === "number" ? counts[key] : 0);
    return ok({
      orgs: count("orgs"),
      events: count("events"),
      people: count("people"),
      admins: count("admins"),
      migrations: Array.isArray(counts.migrations)
        ? counts.migrations.filter((version): version is string => typeof version === "string")
        : null,
      setUpAt: typeof counts.set_up_at === "string" ? counts.set_up_at : null,
      settingsChangedAt:
        typeof counts.settings_changed_at === "string" ? counts.settings_changed_at : null,
      outbox: readOutbox(counts.outbox),
    });
  },
);

export const instanceOverviewQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "overview"] as const,
    queryFn: async () => unwrap(await instanceOverviewFn()),
    retry: retryPolicy,
  });

export interface InstanceOrg {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  statusReason: string | null;
  createdAt: string;
  members: number;
  events: number;
  hostnames: string[];
  owners: string[];
  admins: number;
}

export const instanceOrgsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<InstanceOrg[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_orgs");
    if (error) return toFailure(error, "loading organizations");
    return ok(
      (data ?? []).map((row) => ({
        id: row.id,
        slug: String(row.slug),
        name: row.name,
        status: row.status,
        statusReason: row.status_reason,
        createdAt: row.created_at,
        members: row.members,
        events: row.events,
        hostnames: row.hostnames ?? [],
        owners: row.owners ?? [],
        admins: row.admins,
      })),
    );
  },
);

export const instanceOrgsQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "orgs"] as const,
    queryFn: async () => unwrap(await instanceOrgsFn()),
    retry: retryPolicy,
  });

export interface InstancePerson {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  orgs: string[];
  admin: boolean;
  passwordLogin: boolean;
}

export const instancePeopleFn = createServerFn({ method: "GET" })
  .validator((search: unknown) => (typeof search === "string" ? search.slice(0, 100) : ""))
  .handler(async ({ data: search }): Promise<DbResult<InstancePerson[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_people", {
      ...(search.trim() ? { p_search: search.trim() } : {}),
      p_limit: 200,
    });
    if (error) return toFailure(error, "loading people");
    return ok(
      data.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        joinedAt: row.joined_at,
        orgs: row.orgs ?? [],
        admin: row.admin,
        passwordLogin: row.password_login,
      })),
    );
  });

export const instancePeopleQueryOptions = (search: string) =>
  queryOptions({
    queryKey: ["instance", "people", search] as const,
    queryFn: async () => unwrap(await instancePeopleFn({ data: search })),
    retry: retryPolicy,
  });

/** Lets someone set their own password, or turns that off (clearing it and signing them out). Platform admins only. */
export const setPasswordLoginFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { userId?: unknown; enabled?: unknown };
    return { userId: requireId(raw.userId, "userId"), enabled: raw.enabled === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const { error } = await createServerClient().rpc("set_password_login", {
      p_user: data.userId,
      p_enabled: data.enabled,
    });
    if (error) return toFailure(error, "changing password sign-in");
    return ok(null);
  });

export interface InstanceChange {
  id: number;
  action: string;
  actor: string | null;
  target: string | null;
  createdAt: string;
}

export const instanceAuditFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<InstanceChange[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("instance_audit")
      .select("id, action, actor_id, target_id, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return toFailure(error, "loading instance changes");
    const ids = [
      ...new Set(data.flatMap((row) => [row.actor_id, row.target_id]).filter((id) => id !== null)),
    ];
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, display_name").in("id", ids)
      : { data: [] };
    const names = new Map((profiles ?? []).map((row) => [row.id, row.display_name]));
    return ok(
      data.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
        target: row.target_id ? (names.get(row.target_id) ?? null) : null,
        createdAt: row.created_at,
      })),
    );
  },
);

export const instanceAuditQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "audit"] as const,
    queryFn: async () => unwrap(await instanceAuditFn()),
    retry: retryPolicy,
  });

export const addOrgDomainFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; hostname?: unknown };
    const hostname = typeof raw.hostname === "string" ? raw.hostname.trim().toLowerCase() : "";
    if (!HOSTNAME.test(hostname) && !/^[a-z0-9-]+\.localhost(:\d+)?$/.test(hostname)) {
      throw new Error("That isn't a hostname");
    }
    return { orgId: requireId(raw.orgId, "orgId"), hostname };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.from("org_domains").insert({
      org_id: data.orgId,
      hostname: data.hostname,
      verified_at: new Date().toISOString(),
    });
    if (error) {
      if (error.code === "23505") return fail("conflict", "Another organization already uses it.");
      return toFailure(error, "adding the hostname");
    }
    return ok(null);
  });

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const createOrgFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const hostname = typeof raw.hostname === "string" ? raw.hostname.trim().toLowerCase() : "";
    const ownerEmail =
      typeof raw.ownerEmail === "string" ? raw.ownerEmail.trim().toLowerCase() : "";
    if (hostname && !HOSTNAME.test(hostname)) throw new Error("That isn't a hostname");
    if (ownerEmail && !EMAIL.test(ownerEmail)) throw new Error("That isn't an email address");
    return {
      slug: requireSlug(raw.slug, "Address"),
      name: requireText(raw.name, "Name", 120),
      hostname: hostname || null,
      ownerEmail: ownerEmail || null,
    };
  })
  .handler(async ({ data }): Promise<DbResult<string>> => {
    const supabase = createServerClient();
    const { data: id, error } = await supabase.rpc("create_org", {
      p_slug: data.slug,
      p_name: data.name,
      ...(data.hostname ? { p_hostname: data.hostname } : {}),
      ...(data.ownerEmail ? { p_owner_email: data.ownerEmail } : {}),
    });
    if (error) {
      if (error.code === "23505") {
        return fail("conflict", "Another organization already uses that address or hostname.");
      }
      return toFailure(error, "creating the organization");
    }
    return ok(id);
  });

export const orgSlugTakenFn = createServerFn({ method: "GET" })
  .validator((slug: unknown) => requireSlug(slug, "Address"))
  .handler(async ({ data: slug }): Promise<DbResult<boolean>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.from("orgs").select("id").eq("slug", slug).limit(1);
    if (error) return toFailure(error, "checking the address");
    return ok(data.length > 0);
  });

export const ORG_STATUSES = [
  "active",
  "restricted",
  "suspended",
] as const satisfies Tuple<OrgStatus>;

export const setOrgStatusFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; status?: unknown; reason?: unknown };
    const reason = typeof raw.reason === "string" ? raw.reason.trim().slice(0, 500) : "";
    return {
      orgId: requireId(raw.orgId, "orgId"),
      status: requireOneOf(raw.status, ORG_STATUSES, "Status"),
      reason,
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_org_status", {
      p_org: data.orgId,
      p_status: data.status,
      ...(data.reason ? { p_reason: data.reason } : {}),
    });
    if (error) return toFailure(error, "changing the organization");
    return ok(null);
  });

export const ORG_LIMIT_KEYS = [
  "eventsPerOrg",
  "adminsPerOrg",
  "participantsPerEvent",
  "emailsPerDay",
  "storageMbPerOrg",
  "maxUploadMb",
  "customDomainsPerOrg",
  "pendingInvitesPerOrg",
] as const;
export type OrgLimitKey = (typeof ORG_LIMIT_KEYS)[number];

const PLUGIN_LIMIT = /^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/;

export interface OrgLimit {
  key: string;
  limit: number | null;
  override: boolean;
  used: number;
}

export const orgLimitsFn = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; pluginLimits?: unknown };
    const pluginLimits = Array.isArray(raw.pluginLimits)
      ? raw.pluginLimits.filter(
          (key): key is string => typeof key === "string" && PLUGIN_LIMIT.test(key),
        )
      : [];
    return { orgId: requireId(raw.orgId, "orgId"), pluginLimits };
  })
  .handler(async ({ data }): Promise<DbResult<OrgLimit[]>> => {
    const supabase = createServerClient();
    const { data: limits, error } = await supabase.rpc("org_limits", {
      p_org: data.orgId,
      p_plugin_limits: data.pluginLimits,
    });
    if (error) return toFailure(error, "loading the limits");
    const all = limits && typeof limits === "object" && !Array.isArray(limits) ? limits : {};
    return ok(
      [...ORG_LIMIT_KEYS, ...data.pluginLimits].map((key) => {
        const entry = all[key];
        const row = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
        return {
          key,
          limit: typeof row.limit === "number" ? row.limit : null,
          override: row.override === true,
          used: typeof row.used === "number" ? row.used : 0,
        };
      }),
    );
  });

export const orgLimitsQueryOptions = (orgId: string, pluginLimits: Tuple<string> = []) =>
  queryOptions({
    queryKey: ["instance", "org-limits", orgId, pluginLimits] as const,
    queryFn: async () =>
      unwrap(await orgLimitsFn({ data: { orgId, pluginLimits: [...pluginLimits] } })),
    retry: retryPolicy,
  });

export const setOrgLimitsFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; limits?: unknown };
    const given =
      raw.limits && typeof raw.limits === "object" && !Array.isArray(raw.limits) ? raw.limits : {};
    const limits: Record<string, number | null> = {};
    for (const key of Object.keys(given)) {
      const known = ORG_LIMIT_KEYS.some((each) => each === key) || PLUGIN_LIMIT.test(key);
      if (!known) throw new Error(`${key} isn't a limit`);
      const value: unknown = Reflect.get(given, key);
      if (value !== null && !(typeof value === "number" && Number.isInteger(value) && value >= 0)) {
        throw new Error("Limits are whole numbers, or none");
      }
      limits[key] = value;
    }
    return { orgId: requireId(raw.orgId, "orgId"), limits };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_org_limits", {
      p_org: data.orgId,
      p_limits: data.limits,
    });
    if (error) return toFailure(error, "saving the limits");
    return ok(null);
  });

export interface PageReport {
  id: string;
  orgId: string;
  orgName: string;
  path: string;
  reason: string;
  reporter: string | null;
  createdAt: string;
  handled: boolean;
}

export const pageReportsFn = createServerFn({ method: "GET" })
  .validator((openOnly: unknown) => openOnly !== false)
  .handler(async ({ data: openOnly }): Promise<DbResult<PageReport[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_reports", { p_open_only: openOnly });
    if (error) return toFailure(error, "loading reports");
    return ok(
      data.map((row) => ({
        id: row.id,
        orgId: row.org_id,
        orgName: row.org_name,
        path: row.path,
        reason: row.reason,
        reporter: row.reporter_name,
        createdAt: row.created_at,
        handled: row.handled_at !== null,
      })),
    );
  });

export const pageReportsQueryOptions = (openOnly: boolean) =>
  queryOptions({
    queryKey: ["instance", "reports", openOnly] as const,
    queryFn: async () => unwrap(await pageReportsFn({ data: openOnly })),
    retry: retryPolicy,
  });

export const setReportHandledFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { id?: unknown; handled?: unknown };
    return { id: requireId(raw.id, "id"), handled: raw.handled === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_report_handled", {
      p_id: data.id,
      p_handled: data.handled,
    });
    if (error) return toFailure(error, "closing the report");
    return ok(null);
  });

export const reportPageFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { orgId?: unknown; path?: unknown; reason?: unknown };
    return {
      orgId: requireId(raw.orgId, "orgId"),
      path: requireText(raw.path, "Page", 300),
      reason: requireText(raw.reason, "Reason", 1000),
    };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("report_page", {
      p_org: data.orgId,
      p_path: data.path,
      p_reason: data.reason,
    });
    if (error) return toFailure(error, "sending the report");
    return ok(null);
  });

export interface InstanceAdmin {
  userId: string;
  name: string;
  email: string;
  grantedBy: string | null;
  since: string;
}

export const instanceAdminsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<InstanceAdmin[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_admins");
    if (error) return toFailure(error, "loading admins");
    return ok(
      (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        grantedBy: row.granted_by_name,
        since: row.created_at,
      })),
    );
  },
);

export const instanceAdminsQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "admins"] as const,
    queryFn: async () => unwrap(await instanceAdminsFn()),
    retry: retryPolicy,
  });

export const setPlatformAdminFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { email?: unknown; admin?: unknown };
    const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) throw new Error("That isn't an email address");
    return { email, admin: raw.admin === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    const { error } = await supabase.rpc("set_platform_admin", {
      p_email: data.email,
      p_admin: data.admin,
    });
    if (error) return toFailure(error, "changing admins");
    return ok(null);
  });

export interface DeletionRequest {
  userId: string;
  name: string;
  email: string;
  reason: string;
  requestedAt: string;
  orgs: string[];
}

export const deletionRequestsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DbResult<DeletionRequest[]>> => {
    const supabase = createServerClient();
    const { data, error } = await supabase.rpc("instance_deletion_requests");
    if (error) return toFailure(error, "loading deletion requests");
    return ok(
      (data ?? []).map((row) => ({
        userId: row.user_id,
        name: row.name,
        email: row.email,
        reason: row.reason,
        requestedAt: row.requested_at,
        orgs: row.orgs ?? [],
      })),
    );
  },
);

export const deletionRequestsQueryOptions = () =>
  queryOptions({
    queryKey: ["instance", "deletion-requests"] as const,
    queryFn: async () => unwrap(await deletionRequestsFn()),
    retry: retryPolicy,
  });

export const resolveDeletionRequestFn = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const raw = (input ?? {}) as { userId?: unknown; decline?: unknown };
    return { userId: requireId(raw.userId, "userId"), decline: raw.decline === true };
  })
  .handler(async ({ data }): Promise<DbResult<null>> => {
    const supabase = createServerClient();
    if (data.decline) {
      const { data: rows, error } = await supabase
        .from("account_deletion_requests")
        .delete()
        .eq("user_id", data.userId)
        .select("user_id");
      if (error) return toFailure(error, "declining the request");
      if (!rows.length) return fail("not_found", "That request is gone.");
      return ok(null);
    }
    const { error } = await supabase.rpc("delete_account", { p_user: data.userId });
    if (error) return toFailure(error, "deleting the account");
    return ok(null);
  });
