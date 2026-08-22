import type { Operation } from '../types.js';

export interface SchemaField {
  path: string; // e.g. "path.id", "query.limit", "header.x-trace-id", "body.item", or (response side) "item.id"
  required: boolean;
  /** false for nested object/array fields — POC only supports one level of body flattening. */
  supported: boolean;
  /** Shown as a tooltip on disabled fields — never hide an unsupported field, explain it. */
  reason?: string;
  /** JSON-schema `type` of a scalar field (e.g. "integer", "boolean") — used to coerce static input values. */
  type?: string;
}

const UNSUPPORTED_REASON = 'Nested/array field mapping not supported in POC.';

function isNestedSchema(schema: Record<string, any> | undefined): boolean {
  if (!schema) return false;
  return schema.type === 'array' || schema.type === 'object' || Boolean(schema.properties);
}

/**
 * Flattens a JSON-schema object's properties one level deep. Nested
 * object/array properties are still listed — with their immediate children
 * shown too, so the shape is visible — but marked unsupported rather than
 * omitted (see ARCHITECTURE.md open questions: a missing field looks like a
 * bug, a disabled one with a reason doesn't).
 */
function flattenObjectSchema(schema: Record<string, any> | null | undefined, prefix: string): SchemaField[] {
  const fields: SchemaField[] = [];
  const properties = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];

  for (const [name, propSchema] of Object.entries<any>(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const nested = isNestedSchema(propSchema);

    fields.push({
      path,
      required: required.includes(name),
      supported: !nested,
      reason: nested ? UNSUPPORTED_REASON : undefined,
      type: nested ? undefined : propSchema?.type,
    });

    if (nested && propSchema.type !== 'array' && propSchema.properties) {
      for (const childName of Object.keys(propSchema.properties)) {
        fields.push({ path: `${path}.${childName}`, required: false, supported: false, reason: UNSUPPORTED_REASON });
      }
    }
  }

  return fields;
}

/** Request-side fields for the Node Inspector: parameters + one-level-deep body properties. */
export function flattenRequestFields(operation: Operation): SchemaField[] {
  const paramFields: SchemaField[] = operation.parameters.map((p) => ({
    path: `${p.in}.${p.name}`,
    required: p.required,
    supported: true,
    type: p.schema?.type,
  }));

  return [...paramFields, ...flattenObjectSchema(operation.requestBodySchema, 'body')];
}

/** Response-side fields for the "map from..." picker — same flattening rules, no section prefix. */
export function flattenResponseFields(operation: Operation): SchemaField[] {
  return flattenObjectSchema(operation.responseSchema, '');
}
