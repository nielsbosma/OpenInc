import { expect, type Page, test } from '@playwright/test';
import { freshTotp, loadAdmin } from './helpers';

test.describe.configure({ mode: 'serial' });
test.skip(!!process.env.E2E_UPGRADE, 'Runs after install.spec.ts on a fresh install');

async function signIn(page: Page) {
  const admin = loadAdmin();
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Code').fill(await freshTotp(admin.secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
}

async function pick(page: Page, trigger: string, option: string | RegExp) {
  await page.locator(trigger).click();
  await page.getByRole('option', { name: option }).click();
  await expect(page.getByRole('option')).toHaveCount(0);
}

async function addHolder(page: Page, picker: string, name: string, nationalId: string) {
  await page.locator(picker).click();
  await page.getByRole('button', { name: 'Add New Holder' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('National ID Number').fill(nationalId);
  await dialog.getByRole('button', { name: 'Add Holder' }).click();
  await expect(dialog).toBeHidden();
}

test('sets up the register, incorporates and records a sale through the wizards', async ({ page }) => {
  await signIn(page);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /Share Register/ })
    .click();
  await expect(page.getByText('Set Up the Share Register')).toBeVisible();
  // The company's country lives in Settings → Company; an Admin can change it right here, with the same fields.
  await page.getByLabel('Country').click();
  await page.getByPlaceholder('Search…').fill('Sweden');
  await page.getByRole('option', { name: /Sweden/ }).click();
  await expect(page.getByText('Swedish Aktiebolag (ABL).')).toBeVisible();
  await page.getByLabel('Registration Number').fill('556123-4567');
  await page.getByRole('button', { name: 'Set Up the Register' }).click();
  await expect(page.getByText('Enter the minimum share capital')).toBeVisible();
  await page.getByLabel(/Minimum Share Capital/).fill('25000');
  await page.getByLabel(/Maximum Share Capital/).fill('100000');
  await page.getByLabel('Minimum Number of Shares').fill('25000');
  await page.getByLabel('Maximum Number of Shares').fill('200000');
  await page.getByRole('button', { name: 'Set Up the Register' }).click();
  await expect(page.getByText('The maximum number of shares can be at most four times the minimum')).toBeVisible();
  await page.getByLabel('Maximum Number of Shares').fill('100000');
  await page.getByRole('button', { name: 'Set Up the Register' }).click();
  await expect(page.getByRole('heading', { name: 'Share Register (Aktiebok)' })).toBeVisible();

  await page.getByRole('button', { name: /Start the Register/ }).click();
  await page.getByRole('menuitem', { name: /Incorporation/ }).click();
  await expect(page.getByRole('heading', { name: 'New Incorporation' })).toBeVisible();
  await page.getByLabel(/Share Capital/).fill('25000');
  await page.getByRole('button', { name: 'Next' }).click();

  await addHolder(page, '#alloc-holder-0', 'Anna Andersson', '19811218-9876');
  await page.locator('#alloc-count-0').fill('1000');
  await page.getByRole('button', { name: 'Add Holder' }).click();
  await addHolder(page, '#alloc-holder-1', 'Björn Berg', '19900101-0017');
  await page.locator('#alloc-count-1').fill('24000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Ready to Enter')).toBeVisible();
  await page.getByRole('button', { name: 'Commit to the Register' }).click();
  await expect(page.getByRole('heading', { name: /#1/ })).toBeVisible();

  await page.goto('/registry');
  await expect(page.getByRole('row', { name: /Anna Andersson/ })).toContainText('1–1000');
  await expect(page.getByRole('row', { name: /Björn Berg/ })).toContainText('1001–25000');

  await page.getByRole('button', { name: /New Transaction/ }).click();
  await page.getByRole('menuitem', { name: 'Transfer' }).click();
  await pick(page, '#transfer-from', /Björn Berg/);
  await addHolder(page, '#transfer-to', 'Cecilia Carlsson', '19850615-2381');
  await page.getByRole('button', { name: 'Next' }).click();
  await pick(page, '#line-class-0', 'A');
  await page.locator('#line-count-0').fill('4000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Price per Share/).fill('2.50');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();

  await expect(page.getByText('Ready to Enter')).toBeVisible();
  await expect(page.locator('tr[data-changed]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Commit to the Register' }).click();
  await expect(page.getByRole('heading', { name: /#2/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settlement Note' })).toBeVisible();

  await page.goto('/registry');
  await expect(page.getByRole('row', { name: /Cecilia Carlsson/ })).toContainText('1001–5000');
  await page.getByLabel('As of Date').fill('2000-01-01');
  await expect(page.getByText('No Shares Yet')).toBeVisible();
});

test('refuses a transfer of more shares than the holder has, naming the rule', async ({ page }) => {
  await signIn(page);
  await page.goto('/registry/new/transfer');
  await pick(page, '#transfer-from', /Anna Andersson/);
  await pick(page, '#transfer-to', /Cecilia Carlsson/);
  await page.getByRole('button', { name: 'Next' }).click();
  await pick(page, '#line-class-0', 'A');
  await page.locator('#line-count-0').fill('5000');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel(/Price per Share/).fill('3');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Cannot Be Entered')).toBeVisible();
  await expect(page.getByText('INSUFFICIENT_SHARES')).toBeVisible();
});
