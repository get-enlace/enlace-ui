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
  /** JSON-schema `format` (e.g. "binary") — used to distinguish a file picker from a plain string input. */
  format?: string;
  /** JSON-schema `enum` values, when the field's schema declares one (inlined or resolved from a $ref by specParser.ts) — renders as a dropdown instead of free text. */
  enum?: unknown[];
}

const UNKNOWN_SHAPE_REASON = 'Unrecognized schema shape (e.g. oneOf/anyOf/allOf) — not supported yet.';
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

// Exported for reuse by utils/schemaExample.ts, which needs the same
// shape checks to build a full nested JSON example (not just a flattened
// field list) for the Raw JSON body editor.
export function isArraySchema(schema: Record<string, any> | undefined): boolean {
  return schema?.type === 'array';
}

export function isObjectSchema(schema: Record<string, any> | undefined): boolean {
  return !isArraySchema(schema) && Boolean(schema) && (schema!.type === 'object' || Boolean(schema!.properties));
}

/** A representative value for a scalar's `type`, used to build an example array literal. */
export function exampleScalarValue(schema: Record<string, any> | undefined): unknown {
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
    type: 'array',
    reason: describeArrayExample(schema.items),
  };
}

/** A scalar leaf's field, or an explicitly-unsupported one when the shape isn't a scalar we recognize (e.g. oneOf/anyOf/allOf) — shared by flattenObjectSchema's own property loop and flattenArrayField's item-expansion below. */
function scalarOrUnsupportedField(path: string, required: boolean, schema: Record<string, any> | undefined): SchemaField {
  const knownScalar = SCALAR_TYPES.has(schema?.type) || Boolean(schema?.enum);
  return knownScalar
    ? {
        path,
        required,
        supported: true,
        type: schema?.type,
        format: typeof schema?.format === 'string' ? schema.format : undefined,
        enum: schema?.enum,
      }
    : { path, required, supported: false, reason: UNKNOWN_SHAPE_REASON };
}

/**
 * Handles one array-typed field found while flattening — always
 * contributes the whole-array field (arrayField above) so "map array ->
 * array" keeps working (an array-typed source is only ever *enabled* by
 * NodeConfig.tsx's picker when the target field is itself array-typed —
 * areFieldTypesCompatible — anything else still means switching to Raw
 * mode), skipped only when `path` is empty (the true top level: an
 * operation whose entire response *is* an array — see
 * flattenResponseFields — has no property name to hang a whole-array field
 * on; there's nothing there to select besides its items).
 *
 * `expandItems`, response-side only (see flattenObjectSchema's own doc),
 * additionally reaches one representative level into the array as index
 * `[0]` — object items recurse for their own properties, a nested array
 * recurses again the same way, and a scalar/unrecognized item becomes one
 * field. `[0]` stands in for "the first item": deliberately kept despite
 * not generalizing to a second item or a repeated group — "map from the
 * first item in the list" is common enough on its own to be worth the
 * field, and getByPath (path.ts) already resolves bracket-indexed paths
 * like `items[0].id` at run time regardless, so this is purely the picker
 * choosing to surface one. Reaching past index 0, or a second/filtered
 * item, is still what Raw mode's JSONPath filter is for.
 */
function flattenArrayField(schema: Record<string, any>, path: string, required: boolean, expandItems: boolean): SchemaField[] {
  const fields: SchemaField[] = [];
  if (path) fields.push(arrayField(path, required, schema));
  if (!expandItems) return fields;

  const items = schema.items;
  const itemPath = path ? `${path}[0]` : '[0]';
  if (isObjectSchema(items)) {
    fields.push(...flattenObjectSchema(items, itemPath, expandItems));
  } else if (isArraySchema(items)) {
    fields.push(...flattenArrayField(items, itemPath, false, expandItems));
  } else {
    fields.push(scalarOrUnsupportedField(itemPath, false, items));
  }
  return fields;
}

/**
 * Flattens a JSON-schema object's properties into request/response fields,
 * recursing fully through nested objects — setByPath (chainExecutor.ts)
 * already handles arbitrary dotted-path depth when building the request,
 * so there's no reason to cap this at one level. Arrays stop the
 * recursion by default: "N items, each with M fields" doesn't reduce to a
 * flat field list the same way objects do, so an array is instead edited
 * as a single JSON-literal value (see arrayField above) — the request-body
 * form has no other array editor, and that stays true regardless of
 * `expandArrayItems` (flattenRequestFields never passes it).
 *
 * `expandArrayItems`, true only from the response side
 * (flattenResponseFields), additionally reaches into an array property's
 * items (see flattenArrayField above) — response fields have no
 * free-text/JSON-literal fallback the way request fields do, only a
 * dropdown of concrete paths, so without this an ancestor whose response
 * is (or contains) a list has nothing indexable to offer the "Map from..."
 * picker beyond the whole-array field itself.
 */
function flattenObjectSchema(
  schema: Record<string, any> | null | undefined,
  prefix: string,
  expandArrayItems = false
): SchemaField[] {
  const fields: SchemaField[] = [];
  const properties = schema?.properties ?? {};
  const required: string[] = schema?.required ?? [];

  for (const [name, propSchema] of Object.entries<any>(properties)) {
    const path = prefix ? `${prefix}.${name}` : name;
    const isRequired = required.includes(name);

    if (isObjectSchema(propSchema)) {
      fields.push(...flattenObjectSchema(propSchema, path, expandArrayItems));
      continue;
    }

    if (isArraySchema(propSchema)) {
      fields.push(...flattenArrayField(propSchema, path, isRequired, expandArrayItems));
      continue;
    }

    fields.push(scalarOrUnsupportedField(path, isRequired, propSchema));
  }

  return fields;
}

/** Request-side fields for the Node Config: parameters + fully-flattened body properties. */
export function flattenRequestFields(operation: Operation): SchemaField[] {
  const paramFields: SchemaField[] = operation.parameters.map((p) => {
    const path = `${p.in}.${p.name}`;
    if (isArraySchema(p.schema)) return arrayField(path, p.required, p.schema);
    return {
      path,
      required: p.required,
      supported: true,
      type: p.schema?.type,
      format: typeof p.schema?.format === 'string' ? p.schema.format : undefined,
      enum: p.schema?.enum,
    };
  });

  return [...paramFields, ...flattenObjectSchema(operation.requestBodySchema, 'body')];
}

/**
 * Response-side fields for the "map from..." picker — same flattening
 * rules as the request side, no section prefix, plus array-item expansion
 * (see flattenObjectSchema/flattenArrayField above). Also handles the case
 * flattenObjectSchema itself can't: an operation whose response *is* an
 * array at the top level (e.g. `GET /widgets` -> `Widget[]`, not wrapped
 * in an object) — there's no `.properties` to walk there at all, so
 * without this special case the picker would offer nothing for that
 * ancestor.
 */
export function flattenResponseFields(operation: Operation): SchemaField[] {
  const schema = operation.responseSchema ?? undefined;
  if (isArraySchema(schema)) return flattenArrayField(schema!, '', false, true);
  return flattenObjectSchema(schema, '', true);
}

/**
 * Whether a "Map from..." source field's type is safe to wire into a
 * target field's type — e.g. a string field mapped from an array source
 * (`status <- photoUrls`) would silently produce a broken request, since
 * resolveFieldValue (chainExecutor.ts) copies the mapped value through
 * completely untyped, with no coercion or validation at request-build
 * time. integer/number are treated as interchangeable (OpenAPI docs are
 * inconsistent about which to use for the same numeric concept); an
 * unknown type on either side can't be ruled out, so it's allowed through
 * rather than blocked.
 */
export function areFieldTypesCompatible(targetType: string | undefined, sourceType: string | undefined): boolean {
  if (!targetType || !sourceType) return true;
  if (targetType === sourceType) return true;
  const numeric = new Set(['integer', 'number']);
  return numeric.has(targetType) && numeric.has(sourceType);
}
