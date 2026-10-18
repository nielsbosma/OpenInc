// Screenshots of the main screens, light and dark, for reviewing UI changes.
// Needs `pnpm dev` and a seeded database (`pnpm db:reset`). Usage: pnpm --filter @openinc/web screenshots [outDir]
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const out = resolve(process.argv[2] ?? 'screenshots');
mkdirSync(out, { recursive: true });

const pages = [
  ['dashboard', '/'],
  ['settings-company', '/settings/company'],
  ['settings-users', '/settings/users'],
  ['settings-email', '/settings/email'],
  ['settings-ai', '/settings/ai'],
  ['settings-system', '/settings/system'],
  ['settings-audit', '/settings/audit-log'],
  ['settings-account', '/settings/account'],
  ['account-security', '/settings/account#security'],
  ['account-mcp', '/settings/account#mcp'],
  ['documents', '/documents'],
  ['cap-table', '/cap-table'],
  ['fundraising-pipeline', '/fundraising/pipeline'],
];

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: scheme });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.screenshot({ path: `${out}/${scheme}-login.png` });
  await page.getByLabel('Email').fill('admin@openinc.local');
  await page.getByLabel('Password').fill('openinc-admin-1');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(`${base}/`);
  for (const [name, path] of pages) {
    await page.goto(`${base}${path}`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
  }
  await page.goto(`${base}/`);
  await page.getByTestId('chat-toggle').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${scheme}-chat.png` });
  await page.getByRole('button', { name: 'Close Assistant' }).click();
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${scheme}-palette.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/${scheme}-mobile-dashboard.png` });
  await page.getByRole('button', { name: 'Open Sidebar' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${scheme}-mobile-nav.png` });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${base}/settings/company`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${out}/${scheme}-1024-company.png` });
  await context.close();
}
await browser.close();
console.log(`screenshots in ${out}`);
