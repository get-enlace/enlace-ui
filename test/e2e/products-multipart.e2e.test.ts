import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { E2E_BASE_URL, E2E_OAUTH2_ISSUER_URL, startTestServer, stopTestServer } from './helpers.js';

beforeAll(startTestServer);
afterAll(stopTestServer);

async function fetchPasswordToken(): Promise<string> {
  const res = await fetch(`${E2E_OAUTH2_ISSUER_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      username: 'admin',
      password: 'anything',
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}

describe('POST /products (multipart + optional image)', () => {
  it('creates a product without an image', async () => {
    const token = await fetchPasswordToken();
    const form = new FormData();
    form.append('name', 'Widget');
    form.append('price', '9.99');

    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      name: 'Widget',
      price: 9.99,
      inStock: true,
      imageLocation: null,
    });
  });

  it('writes an optional image under a temp dir and returns imageLocation', async () => {
    const token = await fetchPasswordToken();
    const form = new FormData();
    form.append('name', 'Gadget');
    form.append('price', '19.5');
    form.append('image', new Blob(['fake-png-bytes'], { type: 'image/png' }), 'gadget.png');

    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      id: string;
      name: string;
      price: number;
      imageLocation: string | null;
    };
    expect(body.name).toBe('Gadget');
    expect(body.price).toBe(19.5);
    expect(body.imageLocation).toMatch(/enlace-sample-product-images/);
    expect(existsSync(body.imageLocation!)).toBe(true);
    expect(readFileSync(body.imageLocation!)).toEqual(Buffer.from('fake-png-bytes'));
  });

  it('rejects a multipart body missing name/price', async () => {
    const token = await fetchPasswordToken();
    const form = new FormData();
    form.append('image', new Blob(['x']), 'x.bin');
    const res = await fetch(`${E2E_BASE_URL}/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
