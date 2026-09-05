import type { BodyTag, RawBody, RunStep } from '../types.js';
import { isWholeStringMatch, resolveTagValue, tagPattern } from '../bodyTags.js';

/** Embeds a resolved value as text inside a larger string (the "prefix-{{tag}}-suffix" case) — escaped the same way JSON.stringify would escape it, minus the surrounding quotes it would normally add. Only meaningful for scalar-ish values; an object/array embedded this way stringifies via `String()`, same as any other JS string interpolation. */
function embedAsStringFragment(value: unknown): string {
  return JSON.stringify(String(value)).slice(1, -1);
}

// A `File` has no JSON representation, so an `uploaded_file` tag can't be
// substituted with its real value the way every other tag is (below) — it's
// substituted with this instead, a distinctive marker that survives the
// JSON.parse below as an ordinary string, then gets swapped for the real
// `File` in a second pass (swapFileSentinels) once JSON.parse has produced
// a real object/array to attach it to — string substitution alone can't
// hand back a non-JSON value. Collision with a user's own literal text is
// the same theoretical (not practical) risk the `{{enlace:<id>}}` tag
// placeholder syntax itself already carries — the trailing tag id (a
// randomId()) is what actually makes each one unique.
const FILE_SENTINEL_PREFIX = '  enlace-file:';
const FILE_SENTINEL_SUFFIX = '  ';

function fileSentinel(tagId: string): string {
  return `${FILE_SENTINEL_PREFIX}${tagId}${FILE_SENTINEL_SUFFIX}`;
}

function fileSentinelTagId(value: string): string | null {
  if (!value.startsWith(FILE_SENTINEL_PREFIX) || !value.endsWith(FILE_SENTINEL_SUFFIX)) return null;
  return value.slice(FILE_SENTINEL_PREFIX.length, -FILE_SENTINEL_SUFFIX.length);
}

/**
 * Recursively swaps a resolved body's file sentinels for the real `File`
 * each one names. Only ever invoked when `resolveRawBody` was given a
 * `fileLookup` (see its own doc) — every sentinel reaching here is
 * therefore one this same function's caller inserted moments earlier, so a
 * missing tag/file here is a real, user-facing state (the file wasn't
 * re-selected after a reload/import — same situation Form mode's own file
 * fields already hit, see operationNodeHandler.ts's resolveFieldValue),
 * not a hypothetical.
 */
function swapFileSentinels(value: unknown, tags: Record<string, BodyTag>, fileLookup: (tagId: string) => File | undefined): unknown {
  if (typeof value === 'string') {
    const tagId = fileSentinelTagId(value);
    if (tagId === null) return value;
    const file = fileLookup(tagId);
    if (file) return file;
    const tag = tags[tagId];
    const fileName = tag && tag.type === 'uploaded_file' ? tag.fileName : tagId;
    throw new Error(`Re-select the file for "${fileName}" — file contents are not persisted.`);
  }
  if (Array.isArray(value)) return value.map((item) => swapFileSentinels(item, tags, fileLookup));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapFileSentinels(v, tags, fileLookup)]));
  }
  return value;
}

/**
 * Execution-time resolution of a Raw JSON body's tag chips against the
 * chain's already-captured responses. Every `{{enlace:<id>}}` occurrence
 * is replaced in place — with the resolved value's real JSON type
 * (object/array/number/boolean/null) when the tag is the *entire* content
 * of its surrounding string (see bodyTags.ts's `isWholeStringMatch`), or
 * as escaped text spliced into a larger string otherwise — then the whole
 * result is parsed as JSON, so callers always get real values or a clear
 * thrown error, never a half-substituted template.
 *
 * `fileLookup`, when passed, is what allows an `uploaded_file` tag to
 * appear in this body at all (see swapFileSentinels above for how it's
 * used) — only a multipart operation's body ever passes one
 * (operationNodeHandler.ts); calling this for a path/query raw section, or
 * for a non-multipart body, with no `fileLookup` and a template that still
 * contains a file tag throws immediately rather than letting a File
 * reference silently leak into a URL or a JSON payload that can't carry it.
 *
 * Throws (caught by chainExecutor.ts's existing buildRequest try/catch,
 * same as any other request-building failure) if a tag is unknown, its
 * source node hasn't produced a response yet, a referenced header is
 * missing, or an uploaded file was never (re-)selected — never silently
 * sends a placeholder.
 */
export function resolveRawBody(
  rawBody: RawBody,
  stepsByNodeId: Map<string, RunStep>,
  nodeLabels?: Map<string, string>,
  fileLookup?: (tagId: string) => File | undefined
): unknown {
  const text = rawBody.template;
  let result = '';
  let lastIndex = 0;

  for (const match of text.matchAll(tagPattern())) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const tagId = match[1];
    const tag = rawBody.tags[tagId];
    if (!tag) throw new Error(`Body references unknown tag "${tagId}".`);

    const whole = isWholeStringMatch(text, start, end);
    // A whole-string match's surrounding quotes belong to the substitution
    // too — JSON.stringify(value) supplies its own quoting (or none, for
    // a number/boolean/null/object/array), so the original pair must be
    // consumed here rather than left behind around it.
    const spanStart = whole ? start - 1 : start;
    const spanEnd = whole ? end + 1 : end;

    if (tag.type === 'uploaded_file') {
      if (!fileLookup) {
        throw new Error('An uploaded-file mapping is only valid in the body of a multipart/form-data request.');
      }
      if (!whole) {
        throw new Error(
          `The uploaded-file mapping for "${tag.fileName}" must be its field's entire value, not embedded in other text.`
        );
      }
      result += text.slice(lastIndex, spanStart) + JSON.stringify(fileSentinel(tagId));
      lastIndex = spanEnd;
      continue;
    }

    const value = resolveTagValue(tag, stepsByNodeId, nodeLabels);
    const replacement = whole ? JSON.stringify(value) : embedAsStringFragment(value);

    result += text.slice(lastIndex, spanStart) + replacement;
    lastIndex = spanEnd;
  }
  result += text.slice(lastIndex);

  const parsed = JSON.parse(result);
  return fileLookup ? swapFileSentinels(parsed, rawBody.tags, fileLookup) : parsed;
}
