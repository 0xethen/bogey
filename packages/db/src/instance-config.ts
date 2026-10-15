import { basename } from "node:path";
import { configFile, operatorChanges, operatorSettings, type OperatorChange } from "@bogey/config";
import { isCoreNamespace, parseSettings, type CoreNamespace } from "@bogey/config/settings";
import { createAdminClient } from "./admin.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function applyOperatorSettings(): Promise<Tuple<OperatorChange>> {
  const namespaces = Object.keys(operatorSettings);
  if (namespaces.length === 0) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settings")
    .select("namespace, value")
    .eq("scope", "instance")
    .in("namespace", namespaces);
  if (error) throw new Error(`Couldn't read the instance's settings: ${error.message}`);

  const stored: Partial<Record<CoreNamespace, Record<string, unknown>>> = {};
  for (const row of data) {
    if (isCoreNamespace(row.namespace) && isRecord(row.value)) stored[row.namespace] = row.value;
  }
  const changes = operatorChanges(operatorSettings, stored);
  for (const change of changes) {
    const { error: writeError } = await supabase.from("settings").upsert(
      {
        scope: "instance",
        namespace: change.namespace,
        value: parseSettings(change.namespace, "instance", change.value),
        updated_by: null,
      },
      { onConflict: "scope,org_id,event_id,namespace" },
    );
    if (writeError) {
      throw new Error(`Couldn't save ${change.namespace} from ${source()}: ${writeError.message}`);
    }
  }
  return changes;
}

function source(): string {
  return configFile ? basename(configFile) : "bogey.config.ts";
}

let applied: Promise<void> | null = null;

export function applyOperatorSettingsOnce(): Promise<void> {
  applied ??= applyOperatorSettings().then(
    (changes) => {
      for (const change of changes) {
        console.info(
          `${source()} set ${change.keys.map((key) => `${change.namespace}.${key}`).join(", ")}`,
        );
      }
    },
    (error: unknown) => {
      applied = null;
      console.error(error instanceof Error ? error.message : error);
    },
  );
  return applied;
}
