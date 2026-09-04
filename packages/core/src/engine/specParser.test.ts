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
    expect(createOrder.requestBodyContentType).toBe('application/json');
    expect(createOrder.responseSchema?.properties).toHaveProperty('id');

    const createCustomer = operations.find((o) => o.id === 'POST /customers')!;
    expect(createCustomer.requestBodySchema?.required).toEqual(['name', 'email']);

    const createProduct = operations.find((o) => o.id === 'POST /products')!;
    expect(createProduct.requestBodyContentType).toBe('multipart/form-data');
    expect(createProduct.requestBodySchema?.required).toEqual(['name', 'price']);
    expect(createProduct.requestBodySchema?.properties.image).toEqual({
      type: 'string',
      format: 'binary',
      description: expect.any(String),
    });
  });

  it('prefers application/json when an operation offers both json and multipart', () => {
    const spec = {
      paths: {
        '/mixed': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
                },
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    };

    const [mixed] = parseOperations(spec);
    expect(mixed.requestBodyContentType).toBe('application/json');
    expect(mixed.requestBodySchema?.properties).toHaveProperty('name');
  });

  it('parses multipart/form-data when json is absent', () => {
    const spec = {
      paths: {
        '/upload': {
          post: {
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      note: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const [upload] = parseOperations(spec);
    expect(upload.requestBodyContentType).toBe('multipart/form-data');
    expect(upload.requestBodySchema?.properties.file.format).toBe('binary');
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
              status: { $ref: '#/components/schemas/PetStatus' },
            },
          },
          Category: {
            type: 'object',
            properties: { id: { type: 'integer' } },
          },
          PetStatus: {
            type: 'string',
            enum: ['available', 'pending', 'sold'],
          },
        },
      },
    };

    const [createPet] = parseOperations(spec);

    // category's and status's own $refs resolve too, not just the top-level
    // one — so this is the fully-resolved Pet, not the raw (still-$ref'd)
    // fixture.
    const resolvedPet = {
      ...spec.components.schemas.Pet,
      properties: {
        ...spec.components.schemas.Pet.properties,
        category: spec.components.schemas.Category,
        status: spec.components.schemas.PetStatus,
      },
    };

    expect(createPet.requestBodySchema).toEqual(resolvedPet);
    expect(createPet.requestBodySchema?.properties.category).toEqual(spec.components.schemas.Category);
    // enum survives $ref resolution — it's what makes the Node Inspector's
    // enum dropdown (see flattenSchema.ts) work for a $ref'd enum, not just
    // an inlined one.
    expect(createPet.requestBodySchema?.properties.status.enum).toEqual(['available', 'pending', 'sold']);
    expect(createPet.responseSchema).toEqual(resolvedPet);
  });

  it('carries operationId through when the spec declares one, omits it otherwise', () => {
    const spec = {
      paths: {
        '/pet': {
          post: { operationId: 'addPet', responses: {} },
        },
        '/pet/{petId}': {
          get: { responses: {} }, // no operationId — a real spec doesn't have to declare one on every operation
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

  it('resolves requiredCredentialTypes from the sample spec, one type per security scheme actually declared', () => {
    const spec = loadFixtureSpec();
    const operations = parseOperations(spec);
    const typesOf = (id: string) => operations.find((o) => o.id === id)!.requiredCredentialTypes;

    // The sample spec deliberately exercises every supported scheme shape
    // across its resources — see examples/sample-api/openapi.json.
    expect(typesOf('POST /customers')).toEqual(['basic']);
    expect(typesOf('PATCH /customers/{id}')).toEqual(['bearer']);
    expect(typesOf('POST /products')).toEqual(['oauth2_password']);
    expect(typesOf('POST /orders')).toEqual(['apiKey']);
    expect(typesOf('PATCH /orders/{id}')).toEqual(['cookie']);
    expect(typesOf('DELETE /orders/{id}')).toEqual(['oauth2_clientCredentials']);
    // No `security` declared at all (neither operation- nor spec-level) — undefined, not an empty array.
    expect(typesOf('GET /customers/{id}')).toBeUndefined();
  });

  it('falls back to the spec-level global security when an operation declares none of its own', () => {
    const spec = {
      security: [{ bearerAuth: [] }],
      paths: { '/thing': { get: { responses: {} } } },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    };
    const [op] = parseOperations(spec);
    expect(op.requiredCredentialTypes).toEqual(['bearer']);
  });

  it('lets an operation-level security override the spec-level one, even to an empty list', () => {
    const spec = {
      security: [{ bearerAuth: [] }],
      paths: { '/thing': { get: { security: [], responses: {} } } },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    };
    const [op] = parseOperations(spec);
    expect(op.requiredCredentialTypes).toBeUndefined();
  });

  it('dedupes and skips schemes that resolve to no CredentialType, across multiple requirement entries', () => {
    const spec = {
      paths: {
        '/thing': {
          get: {
            security: [{ bearerAuth: [] }, { bearerAuthAgain: [] }, { oidc: [] }],
            responses: {},
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          bearerAuthAgain: { type: 'http', scheme: 'bearer' },
          oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://x' },
        },
      },
    };
    const [op] = parseOperations(spec);
    expect(op.requiredCredentialTypes).toEqual(['bearer']);
  });
});
