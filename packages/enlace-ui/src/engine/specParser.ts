import type { HttpMethod, Operation, OperationParameter } from '../types.js';

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
          schema: p.schema ?? {},
        })
      );

      const requestBodySchema = op.requestBody?.content?.['application/json']?.schema ?? null;
      const responseSchema = extractSuccessResponseSchema(op.responses);

      operations.push({
        id: `${method.toUpperCase()} ${path}`,
        method,
        path,
        summary: op.summary,
        parameters,
        requestBodySchema,
        responseSchema,
      });
    }
  }

  return operations;
}

function extractSuccessResponseSchema(responses: Record<string, any> | undefined) {
  if (!responses) return null;
  const successCode = Object.keys(responses).find((code) => /^2\d\d$/.test(code));
  if (!successCode) return null;
  return responses[successCode]?.content?.['application/json']?.schema ?? null;
}
