import { test, expect } from '@playwright/test';

// Locks in the chrome redesign without touching canvas drag-and-drop
// (still out of scope — see playwright.config.ts).

test.describe('Chrome redesign', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/enlace/');
  });

  test('settings gear exposes Credentials, Export (disabled when empty), and Import', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings' }).click();

    const menu = page.getByRole('menu', { name: 'Settings' });
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Credentials (0)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Export' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Import' })).toBeEnabled();
  });

  test('workflow name defaults to Untitled, not the OpenAPI title', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Workflow: Untitled' })).toBeVisible();
    // Spec title must not leak into the chrome name (Sample Store API).
    await expect(page.getByRole('button', { name: /Workflow:/ })).not.toHaveAccessibleName(/Sample Store/);
  });

  test('Results pane collapses and expands', async ({ page }) => {
    await expect(page.getByText('Results', { exact: true })).toBeVisible();
    await expect(page.getByText(/Run the workflow to see each step/)).toBeVisible();

    await page.getByRole('button', { name: 'Hide results' }).click();
    await expect(page.getByText(/Run the workflow to see each step/)).not.toBeVisible();

    await page.getByRole('button', { name: 'Show results' }).click();
    await expect(page.getByText(/Run the workflow to see each step/)).toBeVisible();
  });

  test('inspector empty state and collapse strip', async ({ page }) => {
    await expect(page.getByText('Select a node to configure it.')).toBeVisible();
    await expect(page.getByRole('separator', { name: 'Resize inspector' })).toBeVisible();

    await page.getByRole('button', { name: 'Hide inspector' }).click();
    await expect(page.getByText('Select a node to configure it.')).not.toBeVisible();

    await page.getByRole('button', { name: 'Show inspector' }).click();
    await expect(page.getByText('Select a node to configure it.')).toBeVisible();
  });
});
