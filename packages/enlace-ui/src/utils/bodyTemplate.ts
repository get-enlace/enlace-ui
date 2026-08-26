import { setByPath, getByPath } from '../engine/chainExecutor.js';
import type { BodyTag, FieldValue, Operation, RawBody } from '../types.js';
import { flattenRequestFields } from './flattenSchema.js';
import { buildSchemaExample } from './schemaExample.js';
import { makeTagPlaceholder, tagPattern } from './bodyTags.js';
import { randomId } from './randomId.js';

// A plain, printable sentinel (not the final `{{enlace:...}}` syntax) is
// written into the schema-example skeleton for a mapped field, then
// swapped for the real placeholder *after* JSON.stringify — this avoids
// hand-writing a JSON serializer just to control how one string value is
// quoted/escaped.
const SENTINEL_PATTERN = /"__ENLACE_RAW_TAG__([a-zA-Z0-9_-]+)__"/g;
const sentinelFor = (tagId: string) => `__ENLACE_RAW_TAG__${tagId}__`;

function bodyFieldPaths(operation: Operation): string[] {
  return flattenRequestFields(operation)
    .filter((f) => f.supported && f.path.startsWith('body.'))
    .map((f) => f.path.slice('body.'.length));
}

/**
 * Form -> Raw. Starts from a full schema-derived example (unlike the
 * form's own per-field defaults, this doesn't stop at arrays/oneOf) and
 * overlays whatever the user has already set in `fieldValues`: a static
 * value is written in place, a mapped value becomes a new tag chip.
 */
export function buildRawBodyFromForm(operation: Operation, fieldValues: Record<string, FieldValue>): RawBody {
  const skeleton = buildSchemaExample(operation.requestBodySchema);
  const target = (typeof skeleton === 'object' && skeleton !== null ? skeleton : {}) as Record<string, unknown>;
  const tags: Record<string, BodyTag> = {};

  for (const key of bodyFieldPaths(operation)) {
    const fieldValue = fieldValues[`body.${key}`];
    if (!fieldValue) continue;

    if (fieldValue.source === 'static') {
      setByPath(target, key, fieldValue.value);
    } else {
      const tagId = randomId();
      tags[tagId] = {
        id: tagId,
        type: 'response_body',
        sourceNodeId: fieldValue.fromNodeId,
        jsonPath: fieldValue.fromResponseFieldPath || undefined,
      };
      setByPath(target, key, sentinelFor(tagId));
    }
  }

  const template = JSON.stringify(target, null, 2).replace(
    SENTINEL_PATTERN,
    (_match, tagId: string) => `"${makeTagPlaceholder(tagId)}"`
  );

  return { template, tags };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual((a as any)[key], (b as any)[key]));
  }
  return false;
}

export interface RawToFormResult {
  fieldValues: Record<string, FieldValue>;
  /** True when switching to Form would lose something Raw mode can represent — extra/polymorphic structure, or a tag chip the flat form has nowhere to put. Doesn't block the switch, just warrants a confirmation. */
  lossy: boolean;
  /** Set (and `fieldValues`/`lossy` left empty/false) when `rawBody.template` isn't valid JSON at all — this blocks switching outright rather than just warning. */
  parseError?: string;
}

/**
 * Raw -> Form, best-effort. Reads each schema-known body leaf out of the
 * parsed template; a leaf whose value is *exactly* a whole tag placeholder
 * (see bodyTags.ts's isWholeStringMatch — checked implicitly here since we
 * compare the leaf's entire string value, not a substring) becomes a
 * `mapped` FieldValue, everything else becomes `static`.
 *
 * `lossy` is computed structurally rather than by enumerating shapes:
 * reconstruct a body from the derived fieldValues the same way
 * chainExecutor.ts's buildRequest does, and diff it against the parsed
 * template. Anything the flat leaf set can't reproduce exactly — extra
 * keys, oneOf/anyOf branches, unsupported fields — shows up as a
 * mismatch. A tag chip referenced anywhere in the template that didn't
 * end up consumed as a whole-leaf mapping (e.g. embedded in a larger
 * string, or sitting inside an array item) also forces `lossy: true`,
 * since form mode has no way to resolve `{{enlace:...}}` text at all.
 */
export function convertRawBodyToFieldValues(rawBody: RawBody, operation: Operation): RawToFormResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.template);
  } catch (err) {
    return { fieldValues: {}, lossy: false, parseError: err instanceof Error ? err.message : String(err) };
  }

  const fieldValues: Record<string, FieldValue> = {};
  const reconstructed: Record<string, unknown> = {};
  const consumedTagIds = new Set<string>();

  for (const key of bodyFieldPaths(operation)) {
    const value = getByPath(parsed, key);
    const wholeTagMatch = typeof value === 'string' ? value.match(/^\{\{enlace:([a-zA-Z0-9_-]+)\}\}$/) : null;
    const tag = wholeTagMatch ? rawBody.tags[wholeTagMatch[1]] : undefined;

    if (tag && tag.type === 'response_body') {
      fieldValues[`body.${key}`] = { source: 'mapped', fromNodeId: tag.sourceNodeId, fromResponseFieldPath: tag.jsonPath ?? '' };
      consumedTagIds.add(tag.id);
      setByPath(reconstructed, key, value);
    } else {
      fieldValues[`body.${key}`] = { source: 'static', value };
      setByPath(reconstructed, key, value);
    }
  }

  const allTagIdsInTemplate = new Set([...rawBody.template.matchAll(tagPattern())].map((m) => m[1]));
  const hasUnconsumedTag = [...allTagIdsInTemplate].some((id) => !consumedTagIds.has(id));

  const lossy = hasUnconsumedTag || !deepEqual(reconstructed, parsed);

  return { fieldValues, lossy };
}
