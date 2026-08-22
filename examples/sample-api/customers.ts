import { Router } from 'express';
import { randomUUID } from 'node:crypto';

export interface Customer {
  id: string;
  name: string;
  email: string;
  status: string;
}

// Exported so orders.ts can validate a customerId actually exists.
export const customers = new Map<string, Customer>();

export const customersRouter = Router();

customersRouter.post('/customers', (req, res) => {
  const { name, email } = req.body ?? {};
  if (typeof name !== 'string' || typeof email !== 'string') {
    res.status(400).json({ error: 'name (string) and email (string) are required' });
    return;
  }
  const customer: Customer = { id: randomUUID(), name, email, status: 'active' };
  customers.set(customer.id, customer);
  res.status(201).json(customer);
});

customersRouter.get('/customers/:id', (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(customer);
});

customersRouter.patch('/customers/:id', (req, res) => {
  const customer = customers.get(req.params.id);
  if (!customer) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const { name, email, status } = req.body ?? {};
  if (name !== undefined) customer.name = name;
  if (email !== undefined) customer.email = email;
  if (status !== undefined) customer.status = status;
  res.json(customer);
});

customersRouter.delete('/customers/:id', (req, res) => {
  if (!customers.delete(req.params.id)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.status(204).send();
});
