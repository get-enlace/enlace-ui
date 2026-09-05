import { describe, expect, it } from 'vitest';
import {
  getHeaderCaseInsensitive,
  isWholeStringMatch,
  makeTagPlaceholder,
  resolveJsonPath,
  resolveTagsInValue,
  resolveTagValue,
  tagPattern,
} from './bodyTags.js';
import type { BodyTag, RunStep } from './types.js';

describe('makeTagPlaceholder / tagPattern', () => {
  it('round-trips a tag id through the placeholder text', () => {
    const placeholder = makeTagPlaceholder('abc123');
    expect(placeholder).toBe('{{enlace:abc123}}');

    const match = tagPattern().exec(placeholder);
    expect(match?.[1]).toBe('abc123');
  });

  it('finds every occurrence when used with matchAll', () => {
    const text = '{"a":"{{enlace:one}}","b":"{{enlace:two}}"}';
    const ids = [...text.matchAll(tagPattern())].map((m) => m[1]);
    expect(ids).toEqual(['one', 'two']);
  });

  it('returns a fresh RegExp each call, so leftover lastIndex state never leaks between callers', () => {
    const first = tagPattern();
    first.exec('{{enlace:one}}'); // advances first.lastIndex past the match
    const text = '{{enlace:one}}{{enlace:two}}';
    const ids = [...text.matchAll(tagPattern())].map((m) => m[1]);
    expect(ids).toEqual(['one', 'two']);
  });
});

describe('isWholeStringMatch', () => {
  it('is true when the placeholder is the entire quoted string', () => {
    const text = '"{{enlace:abc}}"';
    const start = text.indexOf('{{');
    const end = start + '{{enlace:abc}}'.length;
    expect(isWholeStringMatch(text, start, end)).toBe(true);
  });

  it('is false when the placeholder is embedded inside a larger string', () => {
    const text = '"prefix-{{enlace:abc}}-suffix"';
    const start = text.indexOf('{{');
    const end = start + '{{enlace:abc}}'.length;
    expect(isWholeStringMatch(text, start, end)).toBe(false);
  });
});

describe('resolveJsonPath', () => {
  const body = { order: { items: [{ id: 'xyz' }] } };

  it('returns the whole value when no path is given', () => {
    expect(resolveJsonPath(body, undefined)).toBe(body);
    expect(resolveJsonPath(body, '')).toBe(body);
  });

  it('resolves a plain dot/bracket path', () => {
    expect(resolveJsonPath(body, 'order.items[0].id')).toBe('xyz');
  });

  it('strips a leading "$." JSONPath-style prefix', () => {
    expect(resolveJsonPath(body, '$.order.items[0].id')).toBe('xyz');
  });

  it('strips a bare leading "$" prefix', () => {
    expect(resolveJsonPath(body, '$order.items[0].id')).toBe('xyz');
  });

  it('returns undefined for a path that does not exist, without throwing', () => {
    expect(resolveJsonPath(body, 'order.missing.field')).toBeUndefined();
  });
});

describe('getHeaderCaseInsensitive', () => {
  it('matches regardless of case', () => {
    const headers = { 'X-Trace-Id': 'abc' };
    expect(getHeaderCaseInsensitive(headers, 'x-trace-id')).toBe('abc');
    expect(getHeaderCaseInsensitive(headers, 'X-TRACE-ID')).toBe('abc');
  });

  it('returns undefined when the header is absent', () => {
    expect(getHeaderCaseInsensitive({}, 'x-trace-id')).toBeUndefined();
  });
});

function step(nodeId: string, response?: RunStep['response']): RunStep {
  return {
    nodeId,
    request: { method: 'GET', url: 'http://x', headers: {}, credentials: 'omit' },
    timestampStart: '',
    timestampEnd: '',
    response,
  };
}

describe('resolveTagValue', () => {
  const tag: BodyTag = { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' };

  it('resolves against the source node\'s captured response', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { id: 42 } })]]);
    expect(resolveTagValue(tag, stepsByNodeId)).toBe(42);
  });

  it('throws a named error when the source node has no captured response yet', () => {
    expect(() => resolveTagValue(tag, new Map())).toThrow(/Can't map from "an upstream step"/);
  });

  it('names the source step from nodeLabels when provided', () => {
    const labels = new Map([['node-a', 'listCustomers']]);
    expect(() => resolveTagValue(tag, new Map(), labels)).toThrow(/Can't map from "listCustomers"/);
  });

  it('throws a meaningful error when a mapped header is missing', () => {
    const headerTag: BodyTag = {
      id: 'tag1',
      type: 'response_header',
      sourceNodeId: 'node-a',
      headerName: 'apu',
    };
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: null })]]);
    const labels = new Map([['node-a', 'GET /customers']]);
    expect(() => resolveTagValue(headerTag, stepsByNodeId, labels)).toThrow(
      /Can't map header "apu" from "GET \/customers" — that response has no such header/
    );
  });
});

describe('resolveTagsInValue', () => {
  const tags: Record<string, BodyTag> = {
    tag1: { id: 'tag1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' },
  };
  const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { id: 42 } })]]);

  it('leaves a plain value with no tag reference untouched', () => {
    expect(resolveTagsInValue('plain text', tags, stepsByNodeId)).toBe('plain text');
    expect(resolveTagsInValue(5, tags, stepsByNodeId)).toBe(5);
    expect(resolveTagsInValue(null, tags, stepsByNodeId)).toBe(null);
  });

  it('resolves a whole-string field to the value\'s real type, not a stringified one', () => {
    expect(resolveTagsInValue('{{enlace:tag1}}', tags, stepsByNodeId)).toBe(42);
  });

  it('splices a resolved value as text when embedded inside a larger string', () => {
    // This is the exact scenario from a lossy Raw -> Form conversion: a
    // tag chip that ended up embedded in a static field (e.g. someone
    // typed "str" right before an existing whole-match chip) — the field
    // still resolves correctly even without a "Map from..." UI for it.
    expect(resolveTagsInValue('str{{enlace:tag1}}', tags, stepsByNodeId)).toBe('str42');
    expect(resolveTagsInValue('id={{enlace:tag1}}&x=1', tags, stepsByNodeId)).toBe('id=42&x=1');
  });

  it('recurses into arrays and objects', () => {
    expect(resolveTagsInValue(['a', '{{enlace:tag1}}'], tags, stepsByNodeId)).toEqual(['a', 42]);
    expect(resolveTagsInValue({ a: 'str{{enlace:tag1}}' }, tags, stepsByNodeId)).toEqual({ a: 'str42' });
  });

  it('throws when the tag id is not registered', () => {
    expect(() => resolveTagsInValue('{{enlace:missing}}', tags, stepsByNodeId)).toThrow(/unknown tag/);
  });

  it('rejects an uploaded_file tag embedded in an ordinary field — a File can\'t be resolved outside a raw body\'s own multipart handling (see rawBodyResolver.ts)', () => {
    const fileTags: Record<string, BodyTag> = { tag1: { id: 'tag1', type: 'uploaded_file', fileName: 'photo.png' } };
    expect(() => resolveTagsInValue('{{enlace:tag1}}', fileTags, stepsByNodeId)).toThrow(/uploaded-file tag/);
  });
});
