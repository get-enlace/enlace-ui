import { test, expect } from '@playwright/test';

// Real browser coverage of the Credentials drawer — deliberately scoped to
// interactions that are plain clicks/fills, not canvas drag-and-drop (see
// playwright.config.ts's comment on why that's out of scope here). The
// drawer itself needs no node on the canvas to exercise, so this covers a
// meaningful slice of the credentials feature without touching the flaky
// part of the app.
test.describe('Credentials drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/enlace/');
  });

  test('lists every scheme the sample spec declares, with none configured yet', async ({ page }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();

    await expect(page.getByRole('heading', { name: 'Declared in spec' })).toBeVisible();
    for (const schemeName of [
      'basicAuth',
      'bearerAuth',
      'apiKeyAuth',
      'oauth2ClientCreds',
      'oauth2Password',
      'cookieAuth',
    ]) {
      await expect(page.locator('.declared-credential__name', { hasText: schemeName })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Configure' })).toHaveCount(6);
  });

  test('configuring a declared credential pre-fills the form, saves it, and removes it from the declared list', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();

    await page.locator('.declared-credential', { hasText: 'bearerAuth' }).getByRole('button', { name: 'Configure' }).click();

    await expect(page.getByText(/declared in the spec's/)).toBeVisible();
    await expect(page.getByPlaceholder('name')).toHaveValue('bearerAuth');
    await expect(page.getByLabel('Type')).toHaveValue('bearer');

    await page.getByPlaceholder('bearer token').fill('e2e-test-token');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: '1 credential' })).toBeVisible();

    const card = page.locator('.credential-card', { hasText: 'bearerAuth' });
    await expect(card).toBeVisible();
    await expect(card.getByText('From spec:')).toBeVisible();

    // bearerAuth is now configured — no longer offered in the declared list.
    await expect(page.locator('.declared-credential', { hasText: 'bearerAuth' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configure' })).toHaveCount(5);
  });

  test('configuring the declared cookieAuth credential needs only a name — Save is enabled immediately, no secret required', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();
    await page.locator('.declared-credential', { hasText: 'cookieAuth' }).getByRole('button', { name: 'Configure' }).click();

    await expect(page.getByLabel('Type')).toHaveValue('cookie');
    // Unlike every other declared scheme, no secret field exists at all —
    // Save is enabled the instant the pre-filled name is present.
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: '1 credential' })).toBeVisible();
    await expect(page.locator('.credential-card', { hasText: 'cookieAuth' })).toBeVisible();
  });

  test('deleting a configured credential brings it back into the declared list', async ({ page }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();
    await page.locator('.declared-credential', { hasText: 'apiKeyAuth' }).getByRole('button', { name: 'Configure' }).click();
    await page.getByPlaceholder('key value').fill('e2e-test-key');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: '1 credential' })).toBeVisible();

    await page.getByRole('button', { name: 'Delete apiKeyAuth' }).click();

    await expect(page.getByRole('button', { name: '0 credentials' })).toBeVisible();
    await expect(page.locator('.declared-credential', { hasText: 'apiKeyAuth' })).toBeVisible();
  });

  test('manually creating a credential not tied to any declared scheme still works, unaffected by the spec', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();
    await page.getByRole('button', { name: '+ New credential' }).click();

    await page.getByPlaceholder('name').fill('manual-basic');
    await page.getByLabel('Type').selectOption('basic');
    await page.getByPlaceholder('username').fill('alice');
    await page.getByPlaceholder('password').fill('hunter2');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: '1 credential' })).toBeVisible();
    const card = page.locator('.credential-card', { hasText: 'manual-basic' });
    await expect(card).toBeVisible();
    await expect(card.getByText('From spec:')).toHaveCount(0);
  });

  test('closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();
    await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Credentials' })).not.toBeVisible();
  });

  test('Edit pre-fills the form with the existing values, and Save changes updates the card in place', async ({
    page,
  }) => {
    await page.getByRole('button', { name: '0 credentials' }).click();
    await page.getByRole('button', { name: '+ New credential' }).click();
    await page.getByPlaceholder('name').fill('editable-cred');
    await page.getByPlaceholder('bearer token').fill('original-token');
    await page.getByRole('button', { name: 'Save' }).click();

    await page.getByRole('button', { name: 'Edit editable-cred' }).click();
    await expect(page.getByPlaceholder('name')).toHaveValue('editable-cred');
    await expect(page.getByPlaceholder('bearer token')).toHaveValue('original-token');

    await page.getByPlaceholder('name').fill('renamed-cred');
    await page.getByRole('button', { name: 'Save changes' }).click();

    // Still just one credential — an edit, not a second one — under the new name.
    await expect(page.getByRole('button', { name: '1 credential' })).toBeVisible();
    await expect(page.locator('.credential-card', { hasText: 'renamed-cred' })).toBeVisible();
    await expect(page.locator('.credential-card', { hasText: 'editable-cred' })).toHaveCount(0);
  });
});
