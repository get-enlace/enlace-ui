import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requireOAuth2Token } from './auth.js';

export interface Product {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
  /** Absolute path under the process temp dir when an image was uploaded; otherwise null. */
  imageLocation: string | null;
}

/** Shared temp folder for optional product images — created once, lives for the process. */
export const PRODUCT_IMAGES_DIR = path.join(tmpdir(), 'enlace-sample-product-images');
mkdirSync(PRODUCT_IMAGES_DIR, { recursive: true });

// Exported so orders.ts can validate a productId actually exists.
export const products = new Map<string, Product>();

export const productsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

function safeFileName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\-]+/g, '_') || 'image.bin';
  return base.slice(0, 120);
}

/** FormData fields arrive as strings; JSON body may already be a number. */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// The catalog is admin-managed — every write here requires a real token
// from mockOAuth2.ts, per openapi.json's oauth2Password scheme ("only an
// admin, authenticated with their own username/password against the auth
// server, can manage products" — see README's "Try the credentials demo").
//
// Body is multipart/form-data (name + price required, image optional) so
// the Enlace canvas can exercise real FormData / file pickers on a
// first-class resource instead of a dedicated upload endpoint.
productsRouter.post('/products', requireOAuth2Token, upload.single('image'), (req, res) => {
  const name = req.body?.name;
  const price = parsePrice(req.body?.price);
  if (typeof name !== 'string' || name.length === 0 || price === null) {
    res.status(400).json({ error: 'name (string) and price (number) are required' });
    return;
  }

  const id = randomUUID();
  let imageLocation: string | null = null;
  if (req.file) {
    const fileName = safeFileName(req.file.originalname);
    imageLocation = path.join(PRODUCT_IMAGES_DIR, `${id}-${fileName}`);
    writeFileSync(imageLocation, req.file.buffer);
  }

  const product: Product = { id, name, price, inStock: true, imageLocation };
  products.set(product.id, product);
  res.status(201).json(product);
});

productsRouter.get('/products/:id', (req, res) => {
  const product = products.get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(product);
});

productsRouter.patch('/products/:id', requireOAuth2Token, (req, res) => {
  const product = products.get(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const { name, price, inStock } = req.body ?? {};
  if (name !== undefined) product.name = name;
  if (price !== undefined) product.price = price;
  if (inStock !== undefined) product.inStock = inStock;
  res.json(product);
});

productsRouter.delete('/products/:id', requireOAuth2Token, (req, res) => {
  if (!products.delete(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.status(204).send();
});
