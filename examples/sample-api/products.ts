import { Router } from 'express';
import { randomUUID } from 'node:crypto';

export interface Product {
  id: string;
  name: string;
  price: number;
  inStock: boolean;
}

// Exported so orders.ts can validate a productId actually exists.
export const products = new Map<string, Product>();

export const productsRouter = Router();

productsRouter.post('/products', (req, res) => {
  const { name, price } = req.body ?? {};
  if (typeof name !== 'string' || typeof price !== 'number') {
    res.status(400).json({ error: 'name (string) and price (number) are required' });
    return;
  }
  const product: Product = { id: randomUUID(), name, price, inStock: true };
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

productsRouter.patch('/products/:id', (req, res) => {
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

productsRouter.delete('/products/:id', (req, res) => {
  if (!products.delete(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.status(204).send();
});
