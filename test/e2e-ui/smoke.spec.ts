import { test, expect } from '@playwright/test';

test('canvas loads with the operations list and Run button rendered', async ({ page }) => {
  await page.goto('/enlace/');

  await expect(page).toHaveTitle('Enlace');
  await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  // Groups start collapsed — expand so paths from each sample-api resource
  // are visible. Confirms /api/spec was fetched and parsed correctly.
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByText('/customers', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('/products/{id}', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('/orders', { exact: false }).first()).toBeVisible();
});
