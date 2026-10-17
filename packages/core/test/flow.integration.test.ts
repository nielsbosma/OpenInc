import { auditLog, eq, settings, sql } from '@openinc/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActor, resolveSession } from '../src/auth/sessions.ts';
import { closeDb, createCtx, getDb } from '../src/context.ts';
import { getEnv } from '../src/env.ts';
import { stopJobs } from '../src/jobs.ts';
import { setupCode } from '../src/lib/crypto.ts';
import { services } from '../src/registry.ts';
import { invoke } from '../src/service.ts';
import type { LoginResult } from '../src/services/auth.ts';
import { getSettings, invalidateSettings } from '../src/settings.ts';
import { boot, getSystemStatus, resetSystemStatus } from '../src/system/lifecycle.ts';

async function reachable() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function wipe() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;');
  await client.end();
}

const anon = () => createCtx({ surface: 'web' });

async function signedIn(result: LoginResult) {
  if (result.status !== 'ok') throw new Error('expected a session');
  const session = await resolveSession(getDb(), result.session.token);
  return createCtx({ surface: 'web', actor: session!.actor, sessionId: session!.sessionId });
}

/** The invite link only travels by email; read it back from the queued job. */
async function lastEmailLink(): Promise<string> {
  const { rows } = await getDb().execute<{ data: { text: string } }>(
    sql`select data from pgboss.job where name = 'email.send' order by created_on desc limit 1`,
  );
  const match = /https?:\/\/\S+/.exec(rows[0]!.data.text);
  return match![0];
}

describe.runIf(await reachable())('first run, settings and invites (database)', () => {
  beforeAll(async () => {
    await wipe();
    resetSystemStatus();
    invalidateSettings();
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it('waits for the wizard on an empty database, then installs it', async () => {
    await boot({ migrate: true });
    expect(getSystemStatus().phase).toBe('needs-install');
    await expect(invoke(services.setup.install, anon(), { code: 'WRONG-CODE' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const status = await invoke(services.setup.install, anon(), { code: setupCode() });
    expect(status.phase).toBe('ready');
    expect(status.needsAdmin).toBe(true);
    expect(status.progress).toBeNull();
  });

  let admin: Awaited<ReturnType<typeof signedIn>>;

  it('creates the first admin once and then locks', async () => {
    const result = await invoke(services.setup.createFirstAdmin, anon(), {
      code: setupCode(),
      name: 'Ada Admin',
      email: 'Ada@Example.com',
      password: 'a-long-password-1',
    });
    admin = await signedIn(result);
    expect(admin.actor?.role).toBe('admin');
    expect(admin.actor?.email).toBe('ada@example.com');
    expect(getSystemStatus().needsAdmin).toBe(false);
    await expect(
      invoke(services.setup.createFirstAdmin, anon(), {
        code: setupCode(),
        name: 'Eve',
        email: 'eve@example.com',
        password: 'a-long-password-1',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stores secrets encrypted, never returns them, and keeps them when left out', async () => {
    const values = {
      host: 'localhost',
      port: 1025,
      security: 'none',
      username: 'mailer',
      password: 'hunter2-secret',
      fromAddress: 'noreply@example.com',
      fromName: '',
    };
    const view = await invoke(services.settings.update, admin, { group: 'email', values });
    expect(view.values.password).toBe('');
    expect(view.secretsSet.password).toBe(true);

    const [row] = await getDb().select().from(settings).where(eq(settings.group, 'email'));
    expect(JSON.stringify(row)).not.toContain('hunter2-secret');

    await invoke(services.settings.update, admin, { group: 'email', values: { ...values, password: undefined, port: 2525 } });
    expect((await getSettings('email'))?.password).toBe('hunter2-secret');
    expect((await getSettings('email'))?.port).toBe(2525);

    const entries = await getDb().select().from(auditLog).where(eq(auditLog.action, 'settings.update'));
    expect(JSON.stringify(entries.map((e) => ({ ...e, id: String(e.id) })))).not.toContain('hunter2-secret');
    expect(entries.map((e) => (e.metadata as { secretChanges: unknown[] }).secretChanges)).toEqual(
      expect.arrayContaining([[{ field: 'password', change: 'set' }], []]),
    );
  });

  it('pins a setting with an env var and refuses to change it in the UI', async () => {
    process.env.OPENINC_SECURITY_SESSION_DAYS = '7';
    invalidateSettings('security');
    const view = await invoke(services.settings.get, admin, { group: 'security' });
    expect(view.locked).toEqual(['sessionDays']);
    await expect(
      invoke(services.settings.update, admin, { group: 'security', values: { enforceTwoFactor: false, sessionDays: 30 } }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    delete process.env.OPENINC_SECURITY_SESSION_DAYS;
    invalidateSettings('security');
  });

  let member: Awaited<ReturnType<typeof signedIn>>;

  it('invites a member who accepts and gets member permissions only', async () => {
    await invoke(services.invites.create, admin, { email: 'max@example.com', role: 'member' });
    expect(await invoke(services.invites.list, admin, {})).toHaveLength(1);
    const token = new URL(await lastEmailLink()).searchParams.get('token')!;
    const described = await invoke(services.invites.describe, anon(), { token });
    expect(described).toMatchObject({ email: 'max@example.com', role: 'member' });

    member = await signedIn(await invoke(services.invites.accept, anon(), { token, name: 'Max Member', password: 'another-password-2' }));
    expect(member.actor?.role).toBe('member');
    await expect(invoke(services.invites.accept, anon(), { token, name: 'Again', password: 'another-password-2' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await expect(
      invoke(services.settings.update, member, { group: 'security', values: { enforceTwoFactor: true, sessionDays: 14 } }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await invoke(services.invites.list, admin, {})).toHaveLength(0);
  });

  it('keeps at least one active admin', async () => {
    await expect(invoke(services.users.update, admin, { userId: admin.actor!.userId, role: 'member' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    await invoke(services.users.update, admin, { userId: member.actor!.userId, role: 'admin' });
    const demoted = await invoke(services.users.update, admin, { userId: admin.actor!.userId, role: 'member' });
    expect(demoted.role).toBe('member');
  });

  it('restricts users without two-factor when an admin enforces it', async () => {
    const newAdmin = createCtx({ surface: 'web', actor: await loadActor(getDb(), member.actor!.userId) });
    await invoke(services.settings.update, newAdmin, { group: 'security', values: { enforceTwoFactor: true, sessionDays: 14 } });
    const restricted = createCtx({ surface: 'web', actor: await loadActor(getDb(), member.actor!.userId) });
    expect(restricted.actor?.mustEnableTwoFactor).toBe(true);
    await expect(invoke(services.users.list, restricted, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const me = await invoke(services.auth.me, restricted, {});
    expect(me.mustEnableTwoFactor).toBe(true);
    const setup = await invoke(services.account.beginTotpSetup, restricted, {});
    expect(setup.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('uses the configured environment', () => {
    expect(getEnv().S3_BUCKET).toBe('openinc-test');
  });
});
