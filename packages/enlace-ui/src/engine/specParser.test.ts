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
});
