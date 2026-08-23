import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOperations } from './specParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// parseOperations itself is pure/portable and never touches the filesystem
// (see specParser.ts) — reading the fixture spec off disk here is test-only
// plumbing, standing in for what api/client.ts's fetchSpec() would return
// in the browser.
function loadFixtureSpec(): Record<string, any> {
  const specPath = path.join(__dirname, '../../../../examples/sample-api/openapi.json');
  return JSON.parse(readFileSync(specPath, 'utf-8'));
}

describe('parseOperations', () => {
  it('parses the sample store spec (3 resources x full CRUD) into operations', () => {
    const spec = loadFixtureSpec();
    const operations = parseOperations(spec);

    expect(operations.map((o) => o.id)).toEqual([
      'POST /customers',
      'GET /customers/{id}',
      'PATCH /customers/{id}',
      'DELETE /customers/{id}',
      'POST /products',
      'GET /products/{id}',
      'PATCH /products/{id}',
      'DELETE /products/{id}',
      'POST /orders',
      'GET /orders/{id}',
      'PATCH /orders/{id}',
      'DELETE /orders/{id}',
    ]);

    const getCustomer = operations.find((o) => o.id === 'GET /customers/{id}')!;
    expect(getCustomer.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);

    // Orders is the cross-referencing resource — its create body requires
    // ids from the other two resources, which is what makes the parallel
    // "A, then B+C, then D (needs A and C)" demo meaningful.
    const createOrder = operations.find((o) => o.id === 'POST /orders')!;
    expect(createOrder.requestBodySchema?.required).toEqual(['customerId', 'productId', 'qty']);
    expect(createOrder.responseSchema?.properties).toHaveProperty('id');

    const createCustomer = operations.find((o) => o.id === 'POST /customers')!;
    expect(createCustomer.requestBodySchema?.required).toEqual(['name', 'email']);

    const createProduct = operations.find((o) => o.id === 'POST /products')!;
    expect(createProduct.requestBodySchema?.required).toEqual(['name', 'price']);
  });

  // Regression test: examples/sample-api's spec always inlines schemas, so
  // the fixture-based test above never exercises $ref — which is how most
  // real-world OpenAPI docs (e.g. the Swagger Petstore demo) actually
  // define reusable schemas under components.schemas.
  it('resolves $ref pointers into components.schemas, including nested refs', () => {
    const spec = {
      paths: {
        '/pet': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
              },
            },
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              category: { $ref: '#/components/schemas/Category' },
            },
          },
          Category: {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
        },
      },
    };

    const [createPet] = parseOperations(spec);

    // category's own $ref resolves too, not just the top-level one — so
    // this is the fully-resolved Pet, not the raw (still-$ref'd) fixture.
    const resolvedPet = {
      ...spec.components.schemas.Pet,
      properties: { ...spec.components.schemas.Pet.properties, category: spec.components.schemas.Category },
    };

    expect(createPet.requestBodySchema).toEqual(resolvedPet);
    expect(createPet.requestBodySchema?.properties.category).toEqual(spec.components.schemas.Category);
    expect(createPet.responseSchema).toEqual(resolvedPet);
  });

  it('carries operationId through when the spec declares one, omits it otherwise', () => {
    const spec = {
      paths: {
        '/pet': {
          post: { operationId: 'addPet', responses: {} },
        },
        '/pet/{petId}': {
          get: { responses: {} }, // no operationId — sample-api's own spec never sets one either
        },
      },
    };

    const [addPet, getPet] = parseOperations(spec);

    expect(addPet.operationId).toBe('addPet');
    expect(getPet.operationId).toBeUndefined();
  });

  it('resolves a circular $ref to an empty object instead of recursing forever', () => {
    const spec = {
      paths: {
        '/node': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          TreeNode: {
            type: 'object',
            properties: {
              value: { type: 'string' },
              parent: { $ref: '#/components/schemas/TreeNode' },
            },
          },
        },
      },
    };

    const [createNode] = parseOperations(spec);

    expect(createNode.requestBodySchema?.properties.value).toEqual({ type: 'string' });
    expect(createNode.requestBodySchema?.properties.parent).toEqual({});
  });
});
