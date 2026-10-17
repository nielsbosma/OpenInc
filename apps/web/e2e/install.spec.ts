import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { freshTotp, linkFromLatestEmail, SMTP_HOST, saveAdmin, setupCode } from './helpers';

const stamp = process.env.E2E_STAMP ?? Date.now();
const admin = { name: 'Ada Admin', email: `ada-${stamp}@example.com`, password: 'correct-horse-battery-1' };
const member = { name: 'Max Member', email: `max-${stamp}@example.com`, password: 'another-long-password-2' };
let adminSecret = '';

test.describe.configure({ mode: 'serial' });
test.skip(!!process.env.E2E_UPGRADE, 'The upgrade check runs upgrade.spec.ts against an install this file made earlier');

test('first run: install, admin with two-factor, company, email, extras', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Welcome to OpenInc')).toBeVisible();
  await page.getByLabel('Setup Code').fill('WRONG-CODE');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('That setup code is not right')).toBeVisible();
  await page.getByLabel('Setup Code').fill(setupCode());
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Install the Database')).toBeVisible();
  await page.getByRole('button', { name: 'Install Database' }).click();
  await expect(page.getByText('Create Your Admin Account')).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Your Name').fill(admin.name);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Create Account' }).click();

  await page.getByRole('button', { name: 'Set Up Two-Factor' }).click();
  adminSecret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Code').fill(await freshTotp(adminSecret));
  await page.getByRole('button', { name: 'Turn On' }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page.getByRole('button', { name: 'I Saved Them' }).click();
  saveAdmin({ email: admin.email, password: admin.password, secret: adminSecret });

  await expect(page.getByText('Your Company')).toBeVisible();
  await page.getByLabel('Company Name').fill('Acme Robotics AB');
  await page.getByLabel('Registration Number').fill('559000-1234');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByLabel('SMTP Host')).toBeVisible();
  await page.getByLabel('SMTP Host').fill(SMTP_HOST);
  await page.getByLabel('Port').fill('1025');
  await page.getByLabel('Security').click();
  await page.getByRole('option', { name: 'None' }).click();
  await page.getByLabel('Sender Address').fill('noreply@acme.example');
  await page.getByRole('button', { name: 'Send Test Email' }).click();
  await expect(page.getByText(/Sent a test email to/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Save and Continue' }).click();

  await expect(page.getByText('AI Assistant')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for Now' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();

  await expect(page.getByRole('heading', { name: /Welcome, Ada/ })).toBeVisible();
  await expect(page.getByTestId('setup-checklist')).toContainText('Finish Setting Up');
  await expect(page.getByTestId('app-version')).toContainText('OpenInc v');
  await expect(page.getByText('Acme Robotics AB').first()).toBeVisible();
});

test('setup is locked once an admin exists', async ({ page, request }) => {
  const res = await request.post('/api/trpc/setup.createFirstAdmin', {
    data: { json: { code: setupCode(), name: 'Eve', email: 'eve@example.com', password: 'evil-password-123' } },
  });
  expect(res.status()).toBe(403);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});

test('admin invites a member, who accepts by email and lands on the dashboard', async ({ page, browser }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Code').fill(await freshTotp(adminSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();

  // The assistant is always reachable; without a provider it explains how to set one up, and the app stays usable beside it.
  await page.getByTestId('chat-toggle').click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set Up AI Provider' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: /Cap Table/ })
    .click();
  await expect(page).toHaveURL(/\/cap-table/);
  await page.getByRole('button', { name: 'Close Assistant' }).click();
  await expect(page.getByTestId('chat-panel')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a page or action…').fill('Invite');
  await page.keyboard.press('Enter');
  await page.getByLabel('Email').fill(member.email);
  await page.getByRole('button', { name: 'Send Invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${member.email}`)).toBeVisible();
  await expect(page.getByText('Pending Invitations', { exact: true })).toBeVisible();

  const link = new URL(await linkFromLatestEmail(member.email));
  const context = await browser.newContext();
  const invitee = await context.newPage();
  await invitee.goto(link.pathname + link.search);
  await expect(invitee.getByText(/You were invited as Member/)).toBeVisible();
  await invitee.getByLabel('Your Name').fill(member.name);
  await invitee.getByLabel('Password').fill(member.password);
  await invitee.getByRole('button', { name: 'Create Account' }).click();
  await expect(invitee.getByText('Protect Your Account')).toBeVisible();
  await invitee.getByRole('button', { name: 'Later' }).click();
  await expect(invitee.getByRole('heading', { name: /Welcome, Max/ })).toBeVisible();
  await invitee.getByRole('link', { name: 'Settings' }).click();
  await expect(invitee.getByRole('navigation', { name: 'Settings' }).getByRole('button')).toHaveText(['Users']);
  await context.close();

  await page.goto('/admin/audit');
  await expect(page).toHaveURL(/\/admin\/settings\/audit-log/);
  await expect(page.getByRole('cell', { name: 'invites.accept' })).toBeVisible();
});

test('an MCP client connects with OAuth and calls tools as the user', async ({ page, request }) => {
  const redirectUri = 'http://127.0.0.1:9/callback';
  const registered = await (
    await request.post('/register', {
      data: {
        client_name: 'E2E client',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      },
    })
  ).json();

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorize = new URLSearchParams({
    response_type: 'code',
    client_id: registered.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });

  let callback = '';
  await page.route('http://127.0.0.1:9/**', (route) => {
    callback = route.request().url();
    return route.fulfill({ body: 'done' });
  });
  await page.goto(`/authorize?${authorize}`);
  await page.getByLabel('Email').fill(admin.email);
  await page.getByLabel('Password').fill(admin.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Code').fill(await freshTotp(adminSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('E2E client')).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => callback).toContain('code=');
  const code = new URL(callback).searchParams.get('code')!;
  expect(new URL(callback).searchParams.get('state')).toBe('xyz');

  const tokens = await (
    await request.post('/token', {
      form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: registered.client_id, code_verifier: verifier },
    })
  ).json();
  expect(tokens.access_token).toBeTruthy();

  const rpc = async (method: string, params: object) => {
    const res = await request.post('/mcp', {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method, params },
    });
    expect(res.status()).toBe(200);
    return (await res.json()).result;
  };
  const list = await rpc('tools/list', {});
  const names = list.tools.map((t: { name: string }) => t.name);
  expect(names).toEqual(expect.arrayContaining(['users_list', 'invites_create', 'settings_update', 'audit_list']));
  expect(names).not.toContain('auth_login');
  const users = await rpc('tools/call', { name: 'users_list', arguments: {} });
  expect(users.structuredContent.result.items.map((u: { email: string }) => u.email)).toContain(admin.email);

  await page.goto('/account/mcp');
  await expect(page.getByText('E2E client')).toBeVisible();
});
