import { invites, sql, users } from '@openinc/db';
import { AI_PROVIDERS, type AiProvider, type Role } from '@openinc/shared';
import { audit } from '../audit.ts';
import { loadActor } from '../auth/sessions.ts';
import { closeDb, createCtx, getDb } from '../context.ts';
import { loadDevEnv } from '../env.ts';
import { stopJobs } from '../jobs.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { hashPassword } from '../lib/password.ts';
import { notify } from '../services/notifications.ts';
import { getSettingsOrDefaults, saveSettings } from '../settings.ts';

/**
 * Sample data for local development: a default admin, a few people, company details and email
 * settings that point at Mailpit. Real installs get their first admin from the setup wizard.
 * Idempotent; run with `pnpm db:reset` (wipe + install + seed) or `pnpm --filter @openinc/core seed`.
 */
loadDevEnv(new URL('../../../../', import.meta.url));
const db = getDb();
const system = createCtx({ surface: 'system' });

export const SEED_ADMIN = { email: 'admin@openinc.local', password: 'openinc-admin-1' };

const people: { email: string; name: string; role: Role; password: string }[] = [
  { email: SEED_ADMIN.email, name: 'Ada Admin', role: 'admin', password: SEED_ADMIN.password },
  { email: 'maria@openinc.local', name: 'Maria Lindqvist', role: 'member', password: 'openinc-member-1' },
  { email: 'jonas@openinc.local', name: 'Jonas Berg', role: 'member', password: 'openinc-member-1' },
  { email: 'board@openinc.local', name: 'Board Observer', role: 'readonly', password: 'openinc-reader-1' },
];

const ids: string[] = [];
for (const p of people) {
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${p.email}`);
  if (existing) {
    ids.push(existing.id);
    continue;
  }
  const [created] = await db
    .insert(users)
    .values({ email: p.email, name: p.name, role: p.role, passwordHash: await hashPassword(p.password) })
    .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
  ids.push(created!.id);
  await audit(system, { action: 'users.create', entityType: 'user', entityId: created!.id, after: created, metadata: { seed: true } });
  console.log(`user ${p.email} / ${p.password} (${p.role})`);
}

const admin = createCtx({ surface: 'system', actor: await loadActor(db, ids[0]!) });

await saveSettings(admin, 'company', {
  name: 'Acme Robotics AB',
  registrationNumber: '559123-4567',
  address: 'Drottninggatan 1\n111 51 Stockholm',
  country: 'SE',
  currency: 'SEK',
  timeZone: 'Europe/Stockholm',
  logoFileId: null,
});
await saveSettings(admin, 'email', {
  host: 'localhost',
  port: 1025,
  security: 'none',
  username: '',
  password: '',
  fromAddress: 'noreply@openinc.local',
  fromName: 'Acme Robotics',
});

const provider = process.env.SEED_AI_PROVIDER as AiProvider | undefined;
if (process.env.SEED_AI_API_KEY && provider && AI_PROVIDERS.includes(provider)) {
  await saveSettings(admin, 'ai', {
    provider,
    model: process.env.SEED_AI_MODEL ?? 'claude-sonnet-5-5',
    apiKey: process.env.SEED_AI_API_KEY,
    baseUrl: process.env.SEED_AI_BASE_URL ?? '',
  });
  console.log(`AI assistant on (${provider}), from .env.local`);
}

await saveSettings(admin, 'onboarding', { ...(await getSettingsOrDefaults('onboarding')), completedAt: new Date().toISOString() });

const [pending] = await db.select({ id: invites.id }).from(invites).limit(1);
if (!pending) {
  await db.insert(invites).values({
    email: 'new.hire@openinc.local',
    role: 'member',
    tokenHash: sha256(randomToken()),
    invitedBy: ids[0],
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  await notify(db, ids, {
    type: 'welcome',
    title: 'Welcome to OpenInc',
    body: 'Turn on two-factor authentication under Account → Security.',
    link: '/settings/account#security',
  });
}

console.log(`seed complete. Sign in at http://localhost:5173 as ${SEED_ADMIN.email} / ${SEED_ADMIN.password}`);
await stopJobs();
await closeDb();
