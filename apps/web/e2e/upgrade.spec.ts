import { expect, test } from '@playwright/test';

// Runs after install.spec.ts set up an install with the previous release and the new image took over
// (E2E_UPGRADE=1, same E2E_STAMP). The new image must have migrated the data and kept people able to sign in.
test.skip(!process.env.E2E_UPGRADE, 'Only in the upgrade check');

test('the upgraded install keeps its data and its people can sign in', async ({ page, request }) => {
  await expect.poll(async () => (await request.get('/api/ready')).status(), { timeout: 60_000 }).toBe(200);
  await page.goto('/login');
  await page.getByLabel('Email').fill(`max-${process.env.E2E_STAMP}@example.com`);
  await page.getByLabel('Password').fill('another-long-password-2');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Welcome, Max/ })).toBeVisible();
  await expect(page.getByText('Acme Robotics AB').first()).toBeVisible();
});
