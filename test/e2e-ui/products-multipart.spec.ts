import { test, expect, type Page } from '@playwright/test';
import { ENLACE_COLLECTION_FORMAT, ENLACE_COLLECTION_VERSION } from '../../packages/enlace-ui/src/types.js';

// Avoids canvas drag-and-drop (see playwright.config.ts). Imports a
// collection with POST /products, configures the declared oauth2Password
// credential (products require it), then picks an optional image and Runs.

const productCollection = {
  format: ENLACE_COLLECTION_FORMAT,
  version: ENLACE_COLLECTION_VERSION,
  name: 'Product image demo',
  exportedAt: '2026-01-01T00:00:00.000Z',
  secrets: 'stripped',
  credentials: [],
  workflows: [
    {
      id: 'workflow-1',
      name: 'Product image demo',
      specHint: { operationIds: ['POST /products'] },
      nodes: [
        {
          id: 'product-1',
          operationId: 'POST /products',
          credentialId: null,
          fieldValues: {
            'body.name': { source: 'static', value: 'Gadget' },
            'body.price': { source: 'static', value: 19.5 },
          },
        },
      ],
      connections: [],
      nodePositions: { 'product-1': { x: 120, y: 120 } },
    },
  ],
};

async function openCredentialsDrawer(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('menuitem', { name: /Credentials \(\d+\)/ }).click();
}

test('POST /products multipart: optional image, Run, see imageLocation', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/enlace/');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();

  // Import first — replaceWorkflow clears credentials, so configure oauth2 after.
  await page.locator('input[type="file"][accept*=".enlace"]').setInputFiles({
    name: 'product-demo.enlace',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(productCollection)),
  });

  await openCredentialsDrawer(page);
  await page.locator('.declared-credential', { hasText: 'oauth2Password' }).getByRole('button', { name: 'Configure' }).click();
  await page.getByPlaceholder('resource owner username').fill('admin');
  await page.getByPlaceholder('resource owner password').fill('anything');
  await page.getByRole('button', { name: 'Verify & Save' }).click();
  await expect(page.locator('.credential-card', { hasText: 'oauth2Password' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close credentials' }).click();

  await page.locator('.react-flow__node').filter({ hasText: '/products' }).click();
  await expect(page.getByRole('heading', { name: 'Body' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Switch to Raw view/ })).toHaveCount(0);

  // Attach the oauth2 credential via the lock menu.
  await page.getByRole('button', { name: 'Credential' }).click();
  await page.getByRole('option', { name: 'oauth2Password' }).click();

  await page.getByLabel('body.image').setInputFiles({
    name: 'gadget.png',
    mimeType: 'image/png',
    buffer: Buffer.from('fake-png-bytes'),
  });
  await expect(page.getByText('gadget.png')).toBeVisible();

  await page.getByRole('button', { name: 'Run', exact: true }).click();

  await expect(page.getByText('201')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.debug-body__pre').filter({ hasText: '"imageLocation"' })).toContainText(
    'enlace-sample-product-images'
  );
});
