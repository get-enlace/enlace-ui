import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { customers } from './customers.js';
import { products } from './products.js';

export interface Order {
  id: string;
  customerId: string;
  productId: string;
  qty: number;
  status: string;
}

const orders = new Map<string, Order>();

export const ordersRouter = Router();

// Deliberately validates that customerId/productId reference real records —
// not just type-checked — so a workflow that maps real ids from prior
// steps succeeds while a made-up static id genuinely fails. That's the
// point of chaining these three resources together (see README's parallel
// execution walkthrough).
ordersRouter.post('/orders', (req, res) => {
  const { customerId, productId, qty } = req.body ?? {};
  if (typeof customerId !== 'string' || typeof productId !== 'string' || typeof qty !== 'number') {
    res.status(400).json({ error: 'customerId (string), productId (string), and qty (number) are required' });
    return;
  }
  if (!customers.has(customerId)) {
    res.status(400).json({ error: `unknown customerId "${customerId}"` });
    return;
  }
  if (!products.has(productId)) {
    res.status(400).json({ error: `unknown productId "${productId}"` });
    return;
  }

  const order: Order = { id: randomUUID(), customerId, productId, qty, status: 'created' };
  orders.set(order.id, order);
  res.status(201).json(order);
});

ordersRouter.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(order);
});

ordersRouter.patch('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const { status, qty } = req.body ?? {};
  if (status !== undefined) order.status = status;
  if (qty !== undefined) order.qty = qty;
  res.json(order);
});

ordersRouter.delete('/orders/:id', (req, res) => {
  if (!orders.delete(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.status(204).send();
});
