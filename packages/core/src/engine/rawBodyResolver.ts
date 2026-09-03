import type { RawBody, RunStep } from '../types.js';
import { isWholeStringMatch, resolveTagValue, tagPattern } from '../bodyTags.js';

/** Embeds a resolved value as text inside a larger string (the "prefix-{{tag}}-suffix" case) — escaped the same way JSON.stringify would escape it, minus the surrounding quotes it would normally add. Only meaningful for scalar-ish values; an object/array embedded this way stringifies via `String()`, same as any other JS string interpolation. */
function embedAsStringFragment(value: unknown): string {
  return JSON.stringify(String(value)).slice(1, -1);
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
 * Throws (caught by chainExecutor.ts's existing buildRequest try/catch,
 * same as any other request-building failure) if a tag is unknown, its
 * source node hasn't produced a response yet, or a referenced header is
 * missing — never silently sends a placeholder.
 */
export function resolveRawBody(
  rawBody: RawBody,
  stepsByNodeId: Map<string, RunStep>,
  nodeLabels?: Map<string, string>
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

    const value = resolveTagValue(tag, stepsByNodeId, nodeLabels);
    const whole = isWholeStringMatch(text, start, end);
    // A whole-string match's surrounding quotes belong to the substitution
    // too — JSON.stringify(value) supplies its own quoting (or none, for
    // a number/boolean/null/object/array), so the original pair must be
    // consumed here rather than left behind around it.
    const spanStart = whole ? start - 1 : start;
    const spanEnd = whole ? end + 1 : end;
    const replacement = whole ? JSON.stringify(value) : embedAsStringFragment(value);

    result += text.slice(lastIndex, spanStart) + replacement;
    lastIndex = spanEnd;
  }
  result += text.slice(lastIndex);

  return JSON.parse(result);
}
