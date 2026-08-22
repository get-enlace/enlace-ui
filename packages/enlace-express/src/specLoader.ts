import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import yaml from 'js-yaml';

export type SpecSource = string | Record<string, any>;

/**
 * Reads an OpenAPI 3.x document from a file/URL path or accepts an already-
 * parsed object directly. No dependency on Swagger UI or any particular
 * spec-generation toolchain — if the host app already has one configured
 * (swagger-ui-express, Swashbuckle, Springdoc, ...), the same source works
 * here too, but that's incidental, not required.
 */
export function loadSpec(source: SpecSource): Record<string, any> {
  if (typeof source !== 'string') return source;
  const raw = readFileSync(source, 'utf-8');
  const ext = extname(source);
  if (ext === '.yaml' || ext === '.yml') {
    return yaml.load(raw) as Record<string, any>;
  }
  return JSON.parse(raw);
}
