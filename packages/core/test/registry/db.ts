import { eq, users } from '@openinc/db';
import pg from 'pg';
import { loadActor } from '../../src/auth/sessions.ts';
import { type Ctx, createCtx, getDb } from '../../src/context.ts';
import { setupCode } from '../../src/lib/crypto.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { services } from '../../src/registry.ts';
import { invoke } from '../../src/service.ts';
import { invalidateSettings } from '../../src/settings.ts';
import { boot, resetSystemStatus } from '../../src/system/lifecycle.ts';

export async function reachable() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** The articles' limits a Swedish AB must state: 25 000–100 000 SEK and 25 000–100 000 shares. */
export const LIMITS = { minShareCapital: '2500000', maxShareCapital: '10000000', minShares: '25000', maxShares: '100000' };

const anon = () => createCtx({ surface: 'web' });

/** A fresh install with a Swedish company and its first admin. */
export async function freshInstall(): Promise<Ctx> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(
    'drop schema if exists captable cascade; drop schema if exists registry cascade; drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;',
  );
  await client.end();
  resetSystemStatus();
  invalidateSettings();
  await boot({ migrate: true });
  await invoke(services.setup.install, anon(), { code: setupCode() });
  const result = await invoke(services.setup.createFirstAdmin, anon(), {
    code: setupCode(),
    name: 'Ada Admin',
    email: 'ada@example.com',
    password: 'a-long-password-1',
  });
  if (result.status !== 'ok') throw new Error('no admin');
  const [row] = await getDb().select().from(users).where(eq(users.email, 'ada@example.com'));
  const admin = createCtx({ surface: 'web', actor: (await loadActor(getDb(), row!.id))! });
  await invoke(services.settings.update, admin, {
    group: 'company',
    values: {
      name: 'Exempel AB',
      country: 'SE',
      legalForm: 'AB',
      registrationNumber: '556123-4567',
      currency: 'SEK',
      timeZone: 'Europe/Stockholm',
    },
  });
  return admin;
}

export async function userCtx(role: 'board' | 'member' | 'auditor', email: string, surface: Ctx['surface'] = 'web'): Promise<Ctx> {
  const [user] = await getDb()
    .insert(users)
    .values({ email, name: email.split('@')[0]!, role, passwordHash: await hashPassword('a-long-password-1') })
    .returning();
  return createCtx({ surface, actor: (await loadActor(getDb(), user!.id))! });
}
