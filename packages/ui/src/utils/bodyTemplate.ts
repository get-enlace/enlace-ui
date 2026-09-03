import { setByPath, getByPath, makeTagPlaceholder, tagPattern } from '@get-enlace/core';
import type { BodyTag, FieldValue, Operation, RawBody } from '../types.js';
import { flattenRequestFields } from './flattenSchema.js';
import { buildSchemaExample } from './schemaExample.js';
import { randomId } from './randomId.js';

// A plain, printable sentinel (not the final `{{enlace:...}}` syntax) is
// written into the schema-example skeleton for a mapped field, then
// swapped for the real placeholder *after* JSON.stringify — this avoids
// hand-writing a JSON serializer just to control how one string value is
// quoted/escaped.
const SENTINEL_PATTERN = /"__ENLACE_RAW_TAG__([a-zA-Z0-9_-]+)__"/g;
const sentinelFor = (tagId: string) => `__ENLACE_RAW_TAG__${tagId}__`;

export type ParamSection = 'path' | 'query';

function bodyFieldPaths(operation: Operation): string[] {
  return flattenRequestFields(operation)
    .filter((f) => f.supported && f.path.startsWith('body.'))
    .map((f) => f.path.slice('body.'.length));
}

function paramNames(operation: Operation, section: ParamSection): string[] {
  const prefix = `${section}.`;
  return flattenRequestFields(operation)
    .filter((f) => f.supported && f.path.startsWith(prefix))
    .map((f) => f.path.slice(prefix.length));
}

function finalizeTemplate(target: Record<string, unknown>, tags: Record<string, BodyTag>): RawBody {
  const template = JSON.stringify(target, null, 2).replace(
    SENTINEL_PATTERN,
    (_match, tagId: string) => `"${makeTagPlaceholder(tagId)}"`
  );
  return { template, tags };
}

function applyFieldValueToTarget(
  target: Record<string, unknown>,
  tags: Record<string, BodyTag>,
  key: string,
  fieldValue: FieldValue
): void {
  if (fieldValue.source === 'static') {
    setByPath(target, key, fieldValue.value);
  } else if (fieldValue.source === 'mapped') {
    const tagId = randomId();
    tags[tagId] = {
      id: tagId,
      type: 'response_body',
      sourceNodeId: fieldValue.fromNodeId,
      jsonPath: fieldValue.fromResponseFieldPath || undefined,
    };
    setByPath(target, key, sentinelFor(tagId));
  }
  // `file` fields can't round-trip through Raw JSON — skipped (multipart ops
  // hide the Form/Raw toggle entirely).
}

/**
 * Form -> Raw for path or query. Flat JSON object keyed by param name;
 * static values written in place, mapped values become tag chips.
 */
export function buildRawParamsFromForm(
  section: ParamSection,
  operation: Operation,
  fieldValues: Record<string, FieldValue>
): RawBody {
  const target: Record<string, unknown> = {};
  const tags: Record<string, BodyTag> = {};
  const prefix = `${section}.`;

  for (const key of paramNames(operation, section)) {
    const fieldValue = fieldValues[`${prefix}${key}`];
    if (fieldValue) {
      applyFieldValueToTarget(target, tags, key, fieldValue);
    } else {
      // Always include every declared param key so Raw mode starts with a
      // filled-in skeleton rather than `{}` the user has to reconstruct.
      target[key] = '';
    }
  }

  return finalizeTemplate(target, tags);
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
    applyFieldValueToTarget(target, tags, key, fieldValue);
  }

  return finalizeTemplate(target, tags);
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
  /** Set (and `fieldValues`/`lossy` left empty/false) when the template isn't valid JSON at all — this blocks switching outright rather than just warning. */
  parseError?: string;
}

function convertRawObjectToFieldValues(
  raw: RawBody,
  keys: string[],
  fieldPrefix: string,
  /** Body always materializes every schema leaf (even if absent); path/query only materialize keys present in the JSON. */
  includeMissing: boolean
): RawToFormResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.template);
  } catch (err) {
    return { fieldValues: {}, lossy: false, parseError: err instanceof Error ? err.message : String(err) };
  }

  const fieldValues: Record<string, FieldValue> = {};
  const reconstructed: Record<string, unknown> = {};
  const consumedTagIds = new Set<string>();

  for (const key of keys) {
    const value = getByPath(parsed, key);
    if (value === undefined && !includeMissing) continue;

    const wholeTagMatch = typeof value === 'string' ? value.match(/^\{\{enlace:([a-zA-Z0-9_-]+)\}\}$/) : null;
    const tag = wholeTagMatch ? raw.tags[wholeTagMatch[1]] : undefined;

    if (tag && tag.type === 'response_body') {
      fieldValues[`${fieldPrefix}${key}`] = {
        source: 'mapped',
        fromNodeId: tag.sourceNodeId,
        fromResponseFieldPath: tag.jsonPath ?? '',
      };
      consumedTagIds.add(tag.id);
      setByPath(reconstructed, key, value);
    } else {
      fieldValues[`${fieldPrefix}${key}`] = { source: 'static', value };
      setByPath(reconstructed, key, value);
    }
  }

  const allTagIdsInTemplate = new Set([...raw.template.matchAll(tagPattern())].map((m) => m[1]));
  const hasUnconsumedTag = [...allTagIdsInTemplate].some((id) => !consumedTagIds.has(id));
  const lossy = hasUnconsumedTag || !deepEqual(reconstructed, parsed);

  return { fieldValues, lossy };
}

/**
 * Raw -> Form for path or query JSON objects. Known param keys become
 * fieldValues; extra keys or unconsumed tags mark the conversion lossy.
 */
export function convertRawParamsToFieldValues(
  section: ParamSection,
  raw: RawBody,
  operation: Operation
): RawToFormResult {
  return convertRawObjectToFieldValues(raw, paramNames(operation, section), `${section}.`, false);
}

/**
 * Raw -> Form, best-effort. Reads each schema-known body leaf out of the
 * parsed template; a leaf whose value is *exactly* a whole tag placeholder
 * becomes a `mapped` FieldValue, everything else becomes `static`.
 *
 * `lossy` is computed structurally: reconstruct from derived fieldValues
 * and diff against the parsed template. Unconsumed tag chips also force
 * `lossy: true`.
 */
export function convertRawBodyToFieldValues(rawBody: RawBody, operation: Operation): RawToFormResult {
  return convertRawObjectToFieldValues(rawBody, bodyFieldPaths(operation), 'body.', true);
}
