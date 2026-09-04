import { securitySchemeCredentialType } from './securitySchemes.js';
import type { CredentialType, HttpMethod, Operation, OperationParameter } from '../types.js';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/**
 * Flattens an OpenAPI 3.x document's `paths` into a flat Operation list.
 * Pure and portable — runs client-side now, on whatever raw spec object
 * `api/client.ts`'s `fetchSpec()` returned. Reading the spec itself off
 * disk (or a URL) is the adapter's job, not this package's — see
 * `@get-enlace/express`'s `loadSpec`.
 */
export function parseOperations(spec: Record<string, any>): Operation[] {
  const operations: Operation[] = [];
  const paths = spec.paths ?? {};

  for (const [path, pathItem] of Object.entries<any>(paths)) {
    const pathLevelParams: any[] = pathItem.parameters ?? [];

    for (const method of HTTP_METHODS) {
      const op = pathItem[method];
      if (!op) continue;

      const parameters: OperationParameter[] = [...pathLevelParams, ...(op.parameters ?? [])].map(
        (p: any) => ({
          name: p.name,
          in: p.in,
          required: Boolean(p.required),
          schema: resolveSchemaRefs(spec, p.schema) ?? {},
        })
      );

      const { schema: rawBodySchema, contentType: requestBodyContentType } = pickRequestBody(
        op.requestBody?.content
      );
      const requestBodySchema = resolveSchemaRefs(spec, rawBodySchema);
      const responseSchema = resolveSchemaRefs(spec, extractSuccessResponseSchema(op.responses));
      const requiredCredentialTypes = resolveRequiredCredentialTypes(spec, op);

      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method,
        path,
        summary: op.summary,
        operationId: op.operationId,
        tags: Array.isArray(op.tags) ? op.tags : undefined,
        parameters,
        requestBodySchema,
        requestBodyContentType,
        responseSchema,
        requiredCredentialTypes,
      });
    }
  }

  return operations;
}

/**
 * Prefer application/json when both are offered (richer default for most
 * dual-content APIs); otherwise take multipart/form-data so file-upload
 * ops aren't silently dropped. Other content types are ignored for v1.
 */
function pickRequestBody(
  content: Record<string, any> | undefined
): { schema: any; contentType: 'application/json' | 'multipart/form-data' | null } {
  if (!content) return { schema: null, contentType: null };
  if (content['application/json']?.schema) {
    return { schema: content['application/json'].schema, contentType: 'application/json' };
  }
  if (content['multipart/form-data']?.schema) {
    return { schema: content['multipart/form-data'].schema, contentType: 'multipart/form-data' };
  }
  return { schema: null, contentType: null };
}

/**
 * Resolves an operation's OpenAPI `security` requirement — its own
 * `security` array if declared, else the spec's top-level `security`
 * (standard OpenAPI inheritance; an operation-level `security: []`
 * deliberately overrides to "no auth", which collapses to the same empty
 * result here as "nothing declared at all" — an acceptable simplification,
 * see Operation.requiredCredentialTypes's own comment) — into the
 * `CredentialType`s that satisfy it. A `security` requirement can name
 * several schemes (each entry is a distinct way to authenticate; OpenAPI
 * treats them as alternatives), so this returns every type any of them
 * resolves to, deduped, in first-seen order. Schemes this phase can't
 * resolve to a `CredentialType` (or that a `security` entry references but
 * `components.securitySchemes` doesn't declare) are silently skipped, not
 * an error.
 */
function resolveRequiredCredentialTypes(spec: Record<string, any>, op: any): CredentialType[] | undefined {
  const requirements: Array<Record<string, unknown>> = op.security ?? spec.security ?? [];
  const schemeNames = new Set<string>();
  for (const requirement of requirements) {
    for (const schemeName of Object.keys(requirement ?? {})) schemeNames.add(schemeName);
  }

  const schemes = spec?.components?.securitySchemes ?? {};
  const types: CredentialType[] = [];
  for (const schemeName of schemeNames) {
    const type = securitySchemeCredentialType(schemes[schemeName]);
    if (type && !types.includes(type)) types.push(type);
  }

  return types.length ? types : undefined;
}

function extractSuccessResponseSchema(responses: Record<string, any> | undefined) {
  if (!responses) return null;
  const successCode = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  if (!successCode) return null;
  return responses[successCode]?.content?.['application/json']?.schema ?? null;
}

/**
 * Resolves `$ref` pointers (e.g. `"#/components/schemas/Pet"`) against the
 * full spec document, recursively, so the rest of the UI (Node Inspector's
 * field flattening in particular, see `utils/flattenSchema.ts`) never has
 * to know `$ref` exists. Most real-world OpenAPI docs define reusable
 * schemas under `components.schemas` and reference them instead of always
 * inlining — the bundled `examples/sample-api` spec happens to always
 * inline, which is why this went unnoticed until a spec that actually uses
 * `$ref` (e.g. the Swagger Petstore demo) showed zero body fields instead
 * of throwing.
 *
 * `seenRefs` guards against a `$ref` cycle (a schema that (in)directly
 * references itself, e.g. a tree/linked-list shape) — without it, a cyclic
 * spec would recurse forever. On a cycle, resolution stops and an empty
 * object is returned for that branch; `flattenObjectSchema` then just shows
 * it as an empty nested object rather than looping.
 */
function resolveSchemaRefs(
  spec: Record<string, any>,
  schema: any,
  seenRefs: Set<string> = new Set()
): any {
  if (!schema || typeof schema !== 'object') return schema ?? null;

  if (typeof schema.$ref === 'string') {
    if (seenRefs.has(schema.$ref)) return {};
    const resolved = resolveRef(spec, schema.$ref);
    if (!resolved) return schema; // unresolvable ref — leave as-is rather than silently dropping it
    return resolveSchemaRefs(spec, resolved, new Set(seenRefs).add(schema.$ref));
  }

  if (schema.type === 'array' && schema.items) {
    return { ...schema, items: resolveSchemaRefs(spec, schema.items, seenRefs) };
  }

  if (schema.properties) {
    const properties: Record<string, any> = {};
    for (const [key, propSchema] of Object.entries<any>(schema.properties)) {
      properties[key] = resolveSchemaRefs(spec, propSchema, seenRefs);
    }
    return { ...schema, properties };
  }

  return schema;
}

/** Resolves a local `"#/a/b/c"` JSON-pointer style `$ref` against the spec document. External/remote refs aren't supported (OpenAPI docs the UI receives are already-parsed objects, not files it can follow relative paths from). */
function resolveRef(spec: Record<string, any>, ref: string): any {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .reduce<any>((node, part) => node?.[part], spec);
}
