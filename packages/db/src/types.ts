export type { Database, Json } from "./types/database.gen.ts";
export {
  COLUMN_VALUES,
  CORE_AUDIT_ACTIONS,
  CORE_PERMISSIONS,
  type CheckedTable,
  type ColumnValue,
  type CoreAuditAction,
  type CorePermission,
} from "./types/schema.gen.ts";
import type { Database, Json } from "./types/database.gen.ts";

export type JsonRecord = { [key: string]: Json | undefined };

export function jsonRecord(value: Json | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
