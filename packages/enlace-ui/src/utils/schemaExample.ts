import { exampleScalarValue, isArraySchema, isObjectSchema } from './flattenSchema.js';

type Schema = Record<string, any>;

/** `allOf` branches are shallow-merged into one synthetic object schema — good enough for the common "base + extension" pattern; conflicting keys just take the last branch's value. */
function mergeAllOf(schemas: Schema[]): Schema {
  const merged: Schema = { type: 'object', properties: {}, required: [] };
  for (const branch of schemas) {
    Object.assign(merged.properties, branch.properties ?? {});
    merged.required.push(...(branch.required ?? []));
    if (branch.type && !merged.type) merged.type = branch.type;
  }
  return merged;
}

/** Picks the branch a polymorphic schema's example is built from — always the first, since there's no runtime information to prefer one over another. */
function firstBranch(schema: Schema): Schema | undefined {
  return schema.oneOf?.[0] ?? schema.anyOf?.[0];
}

/**
 * Recursively builds a realistic nested JSON example from a request body
 * schema — this is what pre-fills the Raw JSON editor. Unlike
 * flattenSchema.ts's `flattenObjectSchema` (which stops at arrays and
 * disables oneOf/anyOf/allOf entirely, since those can't be represented as
 * flat form fields), this produces *something* concrete for every shape:
 * arrays get one example item, oneOf/anyOf take their first branch, allOf
 * is merged. That's the whole point of Raw mode — schema shapes the form
 * generator can't handle still get a usable starting point here.
 */
export function buildSchemaExample(schema: Schema | null | undefined): unknown {
  if (!schema) return null;

  if (schema.allOf?.length) return buildSchemaExample(mergeAllOf(schema.allOf));

  const branch = firstBranch(schema);
  if (branch) return buildSchemaExample(branch);

  if (isArraySchema(schema)) return [buildSchemaExample(schema.items)];

  if (isObjectSchema(schema)) {
    const example: Record<string, unknown> = {};
    for (const [name, propSchema] of Object.entries<Schema>(schema.properties ?? {})) {
      example[name] = buildSchemaExample(propSchema);
    }
    return example;
  }

  return exampleScalarValue(schema);
}

/**
 * True if any property anywhere in the schema (recursively) is a shape
 * the flat form generator can't cleanly represent: a polymorphic
 * oneOf/anyOf/allOf, or an array of objects (form mode edits an array as
 * one opaque JSON-text blob, with no way to map a response value into a
 * specific item's field). Drives the Node Inspector's "suggest Raw mode"
 * banner — see NodeInspector.tsx.
 */
export function hasUnrepresentableShape(schema: Schema | null | undefined): boolean {
  if (!schema) return false;
  if (schema.oneOf?.length || schema.anyOf?.length || schema.allOf?.length) return true;

  if (isArraySchema(schema)) {
    const items = schema.items;
    if (isObjectSchema(items)) return true;
    return hasUnrepresentableShape(items);
  }

  if (isObjectSchema(schema)) {
    return Object.values<Schema>(schema.properties ?? {}).some(hasUnrepresentableShape);
  }

  return false;
}
