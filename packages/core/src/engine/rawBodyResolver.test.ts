import { describe, expect, it } from 'vitest';
import { resolveRawBody } from './rawBodyResolver.js';
import type { BodyTag, BodyTagType, RawBody, RunStep } from '../types.js';

function step(nodeId: string, response?: RunStep['response']): RunStep {
  return {
    nodeId,
    request: { method: 'GET', url: 'http://x', headers: {}, credentials: 'omit' },
    timestampStart: '',
    timestampEnd: '',
    response,
  };
}

// BodyTag is a real discriminated union now (see types.ts) — a loose
// `Partial<BodyTag>` doesn't distribute over it (same reasoning as
// `DistributiveOmit`'s own comment), so every *response* fixture built here
// goes through this one cast rather than fighting the union per call site.
// `fileTag` below is the `uploaded_file` counterpart.
function bodyTag(overrides: { type: Exclude<BodyTagType, 'uploaded_file'>; sourceNodeId: string; jsonPath?: string; headerName?: string; id?: string }): BodyTag {
  return { id: 'tag1', ...overrides } as BodyTag;
}

function fileTag(overrides: { fileName: string; id?: string }): BodyTag {
  return { id: 'tag1', type: 'uploaded_file', ...overrides };
}

describe('resolveRawBody', () => {
  it('substitutes a whole-string response_body tag preserving type (object)', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { category: { id: 7 } } })]]);
    const rawBody: RawBody = {
      template: '{"category":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'category' }) },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ category: { id: 7 } });
  });

  it('substitutes a whole-string tag preserving a number/boolean/null type', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { count: 5, active: true, note: null } })]]);
    const rawBody: RawBody = {
      template: '{"count":"{{enlace:t1}}","active":"{{enlace:t2}}","note":"{{enlace:t3}}"}',
      tags: {
        t1: bodyTag({ id: 't1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'count' }),
        t2: bodyTag({ id: 't2', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'active' }),
        t3: bodyTag({ id: 't3', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'note' }),
      },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ count: 5, active: true, note: null });
  });

  it('resolves a nested array-index jsonPath, tolerating a leading "$."', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { items: [{ id: 'xyz' }] } })]]);
    const rawBody: RawBody = {
      template: '{"itemId":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_body', sourceNodeId: 'node-a', jsonPath: '$.items[0].id' }) },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ itemId: 'xyz' });
  });

  it('splices a resolved value as text when embedded inside a larger string', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { token: 'abc123' } })]]);
    const rawBody: RawBody = {
      template: '{"auth":"Bearer {{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'token' }) },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ auth: 'Bearer abc123' });
  });

  it('resolves the whole response body for a response_raw tag, ignoring any jsonPath', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: { a: 1 } })]]);
    const rawBody: RawBody = {
      template: '{"whole":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_raw', sourceNodeId: 'node-a' }) },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ whole: { a: 1 } });
  });

  it('resolves a response header case-insensitively', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: { 'X-Trace-Id': 'abc' }, body: null })]]);
    const rawBody: RawBody = {
      template: '{"trace":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_header', sourceNodeId: 'node-a', headerName: 'x-trace-id' }) },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ trace: 'abc' });
  });

  it('resolves multiple tags in one template', () => {
    const stepsByNodeId = new Map([
      ['node-a', step('node-a', { status: 200, headers: {}, body: { id: 1 } })],
      ['node-b', step('node-b', { status: 200, headers: {}, body: { name: 'widget' } })],
    ]);
    const rawBody: RawBody = {
      template: '{"id":"{{enlace:t1}}","name":"{{enlace:t2}}"}',
      tags: {
        t1: bodyTag({ id: 't1', type: 'response_body', sourceNodeId: 'node-a', jsonPath: 'id' }),
        t2: bodyTag({ id: 't2', type: 'response_body', sourceNodeId: 'node-b', jsonPath: 'name' }),
      },
    };
    expect(resolveRawBody(rawBody, stepsByNodeId)).toEqual({ id: 1, name: 'widget' });
  });

  it('throws a named error when the source node has no captured response yet', () => {
    const rawBody: RawBody = {
      template: '{"id":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_body', sourceNodeId: 'node-a' }) },
    };
    expect(() => resolveRawBody(rawBody, new Map())).toThrow(/no captured response/);
  });

  it('throws a named error when the source node errored (no response)', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', undefined)]]);
    const rawBody: RawBody = {
      template: '{"id":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_body', sourceNodeId: 'node-a' }) },
    };
    expect(() => resolveRawBody(rawBody, stepsByNodeId)).toThrow(/no captured response/);
  });

  it('throws a named error when a response_header tag references a missing header', () => {
    const stepsByNodeId = new Map([['node-a', step('node-a', { status: 200, headers: {}, body: null })]]);
    const rawBody: RawBody = {
      template: '{"trace":"{{enlace:tag1}}"}',
      tags: { tag1: bodyTag({ type: 'response_header', sourceNodeId: 'node-a', headerName: 'x-trace-id' }) },
    };
    expect(() => resolveRawBody(rawBody, stepsByNodeId, new Map([['node-a', 'createCustomer']]))).toThrow(
      /Can't map header "x-trace-id" from "createCustomer"/
    );
  });

  it('throws when the template references an unknown tag id', () => {
    const rawBody: RawBody = { template: '{"id":"{{enlace:missing}}"}', tags: {} };
    expect(() => resolveRawBody(rawBody, new Map())).toThrow(/unknown tag/);
  });

  it('returns the template unchanged (parsed) when there are no tags at all', () => {
    const rawBody: RawBody = { template: '{"a":1,"b":"text"}', tags: {} };
    expect(resolveRawBody(rawBody, new Map())).toEqual({ a: 1, b: 'text' });
  });

  describe('uploaded_file tags', () => {
    it('swaps the sentinel for the real File when a fileLookup finds one', () => {
      const file = new File(['abc'], 'photo.png');
      const rawBody: RawBody = {
        template: '{"name":"Widget","image":"{{enlace:tag1}}"}',
        tags: { tag1: fileTag({ fileName: 'photo.png' }) },
      };
      const result = resolveRawBody(rawBody, new Map(), undefined, (tagId) => (tagId === 'tag1' ? file : undefined)) as Record<
        string,
        unknown
      >;
      expect(result.name).toBe('Widget');
      expect(result.image).toBe(file);
    });

    it('reaches a nested file field the same way a response tag would', () => {
      const file = new File(['abc'], 'a.png');
      const rawBody: RawBody = {
        template: '{"meta":{"image":"{{enlace:tag1}}"}}',
        tags: { tag1: fileTag({ fileName: 'a.png' }) },
      };
      const result = resolveRawBody(rawBody, new Map(), undefined, () => file) as { meta: { image: unknown } };
      expect(result.meta.image).toBe(file);
    });

    it('throws "re-select the file" when no fileLookup entry exists for the tag (e.g. after import)', () => {
      const rawBody: RawBody = {
        template: '{"image":"{{enlace:tag1}}"}',
        tags: { tag1: fileTag({ fileName: 'photo.png' }) },
      };
      expect(() => resolveRawBody(rawBody, new Map(), undefined, () => undefined)).toThrow(
        /Re-select the file for "photo.png"/
      );
    });

    it('throws when no fileLookup was passed at all (e.g. a path/query raw section, or a non-multipart body)', () => {
      const rawBody: RawBody = {
        template: '{"image":"{{enlace:tag1}}"}',
        tags: { tag1: fileTag({ fileName: 'photo.png' }) },
      };
      expect(() => resolveRawBody(rawBody, new Map())).toThrow(/only valid in the body of a multipart/);
    });

    it('rejects a file tag embedded in a larger string rather than being its field\'s whole value', () => {
      const rawBody: RawBody = {
        template: '{"image":"prefix-{{enlace:tag1}}"}',
        tags: { tag1: fileTag({ fileName: 'photo.png' }) },
      };
      expect(() => resolveRawBody(rawBody, new Map(), undefined, () => new File([], 'photo.png'))).toThrow(
        /must be its field's entire value/
      );
    });
  });
});
