import { test, expect } from '@playwright/test';

test('canvas loads with the operations list and Run button rendered', async ({ page }) => {
  await page.goto('/enlace/');

  await expect(page).toHaveTitle('Enlace');
  await expect(page.getByText('OPERATIONS')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  // Spot-check operations from all three sample-api resources actually
  // rendered — not just that the page loaded, but that /api/spec was
  // fetched and parsed correctly.
  await expect(page.getByText('/customers', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('/products/{id}', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('/orders', { exact: false }).first()).toBeVisible();
});
