import type { Operation } from '../types.js';

export interface SchemaField {
  path: string; // e.g. "path.id", "query.limit", "header.x-trace-id", "body.item", or (response side) "item.id"
  required: boolean;
  /** false only for a schema shape we genuinely can't represent (e.g. oneOf/anyOf/allOf) — objects and arrays are both supported (see below). */
  supported: boolean;
  /** Shown as a tooltip on a field, and — for array fields — also as the static input's placeholder (an example of the expected JSON shape). */
  reason?: string;
  /** JSON-schema `type` of a scalar/array field (e.g. "integer", "boolean", "array") — used to coerce static input values. */
  type?: string;
  /** JSON-schema `enum` values, when the field's schema declares one (inlined or resolved from a $ref by specParser.ts) — renders as a dropdown instead of free text. */
  enum?: unknown[];
  /** When true, only "Static value" is offered for this field — "Map from..." stays off for now. Set for array fields (edited as one JSON-literal value, no per-item mapping picker yet). Doesn't affect this field's own eligibility as a map-from *source* elsewhere — flattenResponseFields' picker is governed by `supported`, not this. */
  staticOnly?: boolean;
}

const UNKNOWN_SHAPE_REASON = 'Unrecognized schema shape (e.g. oneOf/anyOf/allOf) — not supported yet.';
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

function isArraySchema(schema: Record<string, any> | undefined): boolean {
  return schema?.type === 'array';
}

function isObjectSchema(schema: Record<string, any> | undefined): boolean {
  return !isArraySchema(schema) && Boolean(schema) && (schema!.type === 'object' || Boolean(schema!.properties));
}

/** A representative value for a scalar's `type`, used to build an example array literal. */
function exampleScalarValue(schema: Record<string, any> | undefined): unknown {
  if (schema?.enum?.length) return schema.enum[0];
  if (schema?.type === 'integer' || schema?.type === 'number') return 0;
  if (schema?.type === 'boolean') return true;
  return 'string';
}

/**
 * A JSON array literal illustrating the shape an array field expects —
 * used as both the input's placeholder and the field's tooltip. One level
 * of item detail is enough to communicate the shape without trying to
 * fully reproduce JSON-schema's example-generation semantics.
 */
function describeArrayExample(itemsSchema: Record<string, any> | undefined): string {
  if (isObjectSchema(itemsSchema)) {
    const example: Record<string, unknown> = {};
    for (const [name, propSchema] of Object.entries<any>(itemsSchema!.properties ?? {})) {
      example[name] = isArraySchema(propSchema) ? [] : isObjectSchema(propSchema) ? {} : exampleScalarValue(propSchema);
    }
    return JSON.stringify([example]);
  }

  if (isArraySchema(itemsSchema)) {
    return JSON.stringify([[exampleScalarValue(itemsSchema!.items)]]);
  }

  return JSON.stringify([exampleScalarValue(itemsSchema), exampleScalarValue(itemsSchema)]);
}

function arrayField(path: string, required: boolean, schema: Record<string, any>): SchemaField {
  return {
    path,
    required,
    supported: true,
    staticOnly: true,
    type: 'array',
    reason: describeArrayExample(schema.items),
  };
}

/**
 * Flattens a JSON-schema object's properties into request/response fields,
 * recursing fully through nested objects — setByPath (chainExecutor.ts)
 * already handles arbitrary dotted-path depth when building the request,
 * so there's no reason to cap this at one level. Arrays stop the
 * recursion: "N items, each with M fields" doesn't reduce to a flat field
 * list the same way objects do, so an array is instead edited as a single
 * JSON-literal value (see arrayField above).
 */
function flattenObjectSchema(schema: Record<string, any> | null | undefined, prefix: string): SchemaField[] {
  const fields: SchemaField[] = [];
  const properties = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];

  for (const [name, propSchema] of Object.entries<any>(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.includes(name);

    if (isObjectSchema(propSchema)) {
      fields.push(...flattenObjectSchema(propSchema, path));
      continue;
    }

    if (isArraySchema(propSchema)) {
      fields.push(arrayField(path, isRequired, propSchema));
      continue;
    }

    const knownScalar = SCALAR_TYPES.has(propSchema?.type) || Boolean(propSchema?.enum);
    fields.push(
      knownScalar
        ? { path, required: isRequired, supported: true, type: propSchema?.type, enum: propSchema?.enum }
        : { path, required: isRequired, supported: false, reason: UNKNOWN_SHAPE_REASON }
    );
  }

  return fields;
}

/** Request-side fields for the Node Inspector: parameters + fully-flattened body properties. */
export function flattenRequestFields(operation: Operation): SchemaField[] {
  const paramFields: SchemaField[] = operation.parameters.map((p) => {
    const path = `${p.in}.${p.name}`;
    if (isArraySchema(p.schema)) return arrayField(path, p.required, p.schema);
    return { path, required: p.required, supported: true, type: p.schema?.type, enum: p.schema?.enum };
  });

  return [...paramFields, ...flattenObjectSchema(operation.requestBodySchema, 'body')];
}

/** Response-side fields for the "map from..." picker — same flattening rules, no section prefix. */
export function flattenResponseFields(operation: Operation): SchemaField[] {
  return flattenObjectSchema(operation.responseSchema, '');
}
