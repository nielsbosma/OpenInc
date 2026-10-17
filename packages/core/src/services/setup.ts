import { and, count, eq, invites, isNull, ne, users } from '@openinc/db';
import { createFirstAdminInput, empty, type SetupChecklistItem, setupCodeInput } from '@openinc/shared';
import { audit } from '../audit.ts';
import type { Ctx } from '../context.ts';
import { forbidden, preconditionFailed, tooManyRequests } from '../errors.ts';
import { checkSetupCode } from '../lib/crypto.ts';
import { hashPassword } from '../lib/password.ts';
import { defineService } from '../service.ts';
import { getSettings, getSettingsOrDefaults, saveSettings } from '../settings.ts';
import { getSystemStatus, installDatabase, isReady, markAdminCreated } from '../system/lifecycle.ts';
import { startSession } from './auth.ts';

/**
 * The first-run wizard. Its public steps (install the database, create the first admin) need the
 * setup code from the container log and lock for good once an admin exists. The later steps
 * (company, email, AI) are ordinary settings services run as that admin.
 */

const attempts = { count: 0, windowStart: Date.now() };

function requireCode(code: string) {
  if (Date.now() - attempts.windowStart > 15 * 60_000) Object.assign(attempts, { count: 0, windowStart: Date.now() });
  if (attempts.count >= 20) throw tooManyRequests('Too many wrong setup codes. Wait 15 minutes.');
  if (!checkSetupCode(code)) {
    attempts.count++;
    throw forbidden('That setup code is not right. It is printed in the container log when OpenInc starts.');
  }
}

function requireSetupOpen() {
  if (!getSystemStatus().needsAdmin) throw forbidden('Setup is already complete. Sign in instead.');
}

export const status = defineService({
  name: 'setup.status',
  description: 'Install and startup state: whether the database needs installing, migrations are running, or something is misconfigured.',
  kind: 'query',
  access: 'public',
  input: empty,
  handler: async () => getSystemStatus(),
});

export const verifyCode = defineService({
  name: 'setup.verifyCode',
  description: 'Check the one-time setup code before showing the wizard.',
  kind: 'mutation',
  access: 'public',
  transaction: false,
  input: setupCodeInput,
  async handler(_ctx, input) {
    requireSetupOpen();
    requireCode(input.code);
    return { ok: true };
  },
});

export const install = defineService({
  name: 'setup.install',
  description: 'Install the database: create the schemas and apply every migration. Only on an empty database, with the setup code.',
  kind: 'mutation',
  access: 'public',
  transaction: false,
  input: setupCodeInput,
  async handler(_ctx, input) {
    requireSetupOpen();
    requireCode(input.code);
    return installDatabase();
  },
});

export const createFirstAdmin = defineService({
  name: 'setup.createFirstAdmin',
  description: 'Create the first Admin account and sign in. Works once, while no account exists.',
  kind: 'mutation',
  access: 'public',
  input: createFirstAdminInput,
  async handler(ctx, input) {
    requireSetupOpen();
    requireCode(input.code);
    if (!isReady()) throw preconditionFailed('Install the database first');
    // Serialises two browsers racing through the wizard: only one first admin.
    await ctx.db.execute('lock table users in exclusive mode');
    const [existing] = await ctx.db.select({ value: count() }).from(users);
    if ((existing?.value ?? 0) > 0) throw forbidden('Setup is already complete. Sign in instead.');
    const [admin] = await ctx.db
      .insert(users)
      .values({ email: input.email, name: input.name, role: 'admin', passwordHash: await hashPassword(input.password) })
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role });
    await audit({ ...ctx, actor: null }, { action: 'setup.create_first_admin', entityType: 'user', entityId: admin!.id, after: admin });
    markAdminCreated();
    return startSession(ctx, admin!.id, 'setup');
  },
});

export const completeOnboarding = defineService({
  name: 'setup.complete',
  description: 'Mark the first-run wizard as finished.',
  kind: 'mutation',
  transaction: false,
  access: 'settings.manage',
  tool: false,
  input: empty,
  async handler(ctx) {
    const current = await getSettingsOrDefaults('onboarding');
    if (!current.completedAt) await saveSettings(ctx, 'onboarding', { ...current, completedAt: new Date().toISOString() });
    return { ok: true };
  },
});

export const checklist = defineService({
  name: 'setup.checklist',
  description: 'The setup checklist in the sidebar: what is left to do (email, invite the team, two-factor, AI assistant).',
  kind: 'query',
  access: 'authenticated',
  input: empty,
  async handler(ctx) {
    const [onboarding, email, ai, [others], [pendingInvites], [me]] = await Promise.all([
      getSettingsOrDefaults('onboarding'),
      getSettings('email'),
      getSettings('ai'),
      ctx.db.select({ value: count() }).from(users).where(ne(users.id, ctx.actor!.userId)),
      ctx.db
        .select({ value: count() })
        .from(invites)
        .where(and(isNull(invites.acceptedAt), isNull(invites.revokedAt))),
      ctx.db
        .select({ totpEnabledAt: users.totpEnabledAt, checklistDismissedAt: users.checklistDismissedAt })
        .from(users)
        .where(eq(users.id, ctx.actor!.userId)),
    ]);
    const done: Record<SetupChecklistItem, boolean> = {
      email: !!email && !(email.host === 'localhost' && email.port === 1025),
      invite: (others?.value ?? 0) > 0 || (pendingInvites?.value ?? 0) > 0,
      twoFactor: !!me?.totpEnabledAt,
      ai: !!ai,
    };
    const isAdmin = ctx.actor!.permissions.has('settings.manage');
    const complete = Object.values(done).every(Boolean);
    const dismissed = !!me?.checklistDismissedAt;
    return { visible: isAdmin && !complete && !dismissed, dismissed, complete, onboardingCompleted: !!onboarding.completedAt, items: done };
  },
});

async function setChecklistDismissed(ctx: Ctx, dismissed: boolean) {
  const at = dismissed ? new Date() : null;
  await ctx.db.update(users).set({ checklistDismissedAt: at }).where(eq(users.id, ctx.actor!.userId));
  await audit(ctx, {
    action: dismissed ? 'setup.dismiss_checklist' : 'setup.show_checklist',
    entityType: 'user',
    entityId: ctx.actor!.userId,
    after: { checklistDismissedAt: at },
  });
  return { ok: true };
}

export const dismissChecklist = defineService({
  name: 'setup.dismissChecklist',
  description: 'Hide the setup checklist on your dashboard. Only for you; bring it back with setup.showChecklist.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: empty,
  handler: (ctx) => setChecklistDismissed(ctx, true),
});

export const showChecklist = defineService({
  name: 'setup.showChecklist',
  description: 'Show the setup checklist on your dashboard again after it was dismissed.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  input: empty,
  handler: (ctx) => setChecklistDismissed(ctx, false),
});
