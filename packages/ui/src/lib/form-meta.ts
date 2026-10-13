import { z } from "zod";

declare module "zod" {
  interface GlobalMeta {
    label?: string;
    placeholder?: string;
  }
}

export const fieldHelp = z.registry<(value: z.core.$input) => string>();

export interface SchemaFieldMeta {
  label?: string;
  placeholder?: string;
  description?: string;
  help?: (value: unknown) => string;
}

type Schema = z.core.$ZodType;

function inner(schema: Schema): Schema | undefined {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodReadonly
  ) {
    return schema.unwrap();
  }
  if (schema instanceof z.ZodPipe) return schema.in;
  return undefined;
}

function child(schema: Schema, segment: string | number): Schema | undefined {
  for (let current: Schema | undefined = schema; current; current = inner(current)) {
    if (current instanceof z.ZodObject) {
      const shape: Record<string, Schema | undefined> = current.shape;
      return typeof segment === "string" ? shape[segment] : undefined;
    }
    if (current instanceof z.ZodArray) return current.element;
    if (current instanceof z.ZodRecord) return current.valueType;
    if (current instanceof z.ZodUnion) {
      for (const option of current.options) {
        const found = child(option, segment);
        if (found) return found;
      }
      return undefined;
    }
  }
  return undefined;
}

function segments(path: string): Array<string | number> {
  return path
    .split(/\.|\[(\d+)\]/)
    .filter((part): part is string => part !== undefined && part !== "")
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

export function schemaMeta(schema: Schema): SchemaFieldMeta {
  const layers: SchemaFieldMeta[] = [];
  for (let current: Schema | undefined = schema; current; current = inner(current)) {
    const meta = z.globalRegistry.get(current);
    const help = fieldHelp.get(current);
    if (meta || help)
      layers.unshift({
        label: meta?.label,
        placeholder: meta?.placeholder,
        description: meta?.description,
        help,
      });
  }
  const merged: SchemaFieldMeta = {};
  for (const layer of layers) {
    if (layer.label !== undefined) merged.label = layer.label;
    if (layer.placeholder !== undefined) merged.placeholder = layer.placeholder;
    if (layer.description !== undefined) merged.description = layer.description;
    if (layer.help !== undefined) merged.help = layer.help;
  }
  return merged;
}

export function schemaAt(schema: Schema, path: string): Schema | undefined {
  let current: Schema | undefined = schema;
  for (const segment of segments(path)) {
    if (!current) return undefined;
    current = child(current, segment);
  }
  return current;
}

export function fieldMeta(schema: Schema, path: string): SchemaFieldMeta {
  const at = schemaAt(schema, path);
  return at ? schemaMeta(at) : {};
}

export function schemaFields(
  schema: Schema,
): Array<SchemaFieldMeta & { key: string; label: string }> {
  let object: Schema | undefined = schema;
  while (object && !(object instanceof z.ZodObject)) object = inner(object);
  if (!object) return [];
  const shape: Record<string, Schema> = object.shape;
  return Object.entries(shape).flatMap(([key, value]) => {
    const meta = schemaMeta(value);
    return meta.label ? [{ ...meta, key, label: meta.label }] : [];
  });
}

export function validatorSchema(validators: unknown): Schema | undefined {
  if (!Array.isArray(validators)) return undefined;
  for (const validator of validators) {
    if (typeof validator !== "object" || validator === null || !("run" in validator)) continue;
    if (validator.run instanceof z.ZodType) return validator.run;
  }
  return undefined;
}
