import { and, count, eq, gt, isNull, loginChallenges, passwordResetTokens, recoveryCodes, sql, users } from '@openinc/db';
import { empty, loginInput, loginSecondFactorInput, ROLE_INFO, requestPasswordResetInput, resetPasswordInput } from '@openinc/shared';
import { audit } from '../audit.ts';
import { createSession, loadActor, revokeSession, revokeUserSessions } from '../auth/sessions.ts';
import type { Ctx } from '../context.ts';
import { appUrl } from '../env.ts';
import { badRequest, tooManyRequests, unauthorized } from '../errors.ts';
import { queueEmail } from '../jobs.ts';
import { decrypt, randomToken, sha256 } from '../lib/crypto.ts';
import { renderEmail } from '../lib/email.ts';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password.ts';
import { verifyTotp } from '../lib/totp.ts';
import { defineService } from '../service.ts';
import { getSettings } from '../settings.ts';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export type LoginResult =
  | { status: 'ok'; session: { token: string; expiresAt: Date }; mustEnableTwoFactor: boolean }
  | { status: 'second_factor'; challenge: string };

export async function productName(): Promise<string> {
  return (await getSettings('company').catch(() => null))?.name ?? 'OpenInc';
}

export async function startSession(ctx: Ctx, userId: string, method: string): Promise<LoginResult> {
  const session = await createSession(ctx.db, userId, { ip: ctx.ip, userAgent: ctx.userAgent });
  await ctx.db.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
  const actor = await loadActor(ctx.db, userId);
  await audit({ ...ctx, actor }, { action: 'auth.login', entityType: 'user', entityId: userId, metadata: { method } });
  return {
    status: 'ok',
    session: { token: session.token, expiresAt: session.expiresAt },
    mustEnableTwoFactor: !!actor?.mustEnableTwoFactor,
  };
}

export const login = defineService({
  name: 'auth.login',
  description: 'Sign in with email and password.',
  kind: 'mutation',
  access: 'public',
  transaction: false,
  input: loginInput,
  async handler(ctx, input): Promise<LoginResult> {
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
    if (!user || !user.active) {
      await burnPasswordCheck(input.password);
      throw unauthorized('Wrong email or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw tooManyRequests('Too many failed attempts. Try again in a few minutes.');
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const failed = user.failedLoginCount + 1;
      const lockedUntil = failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null;
      await ctx.db
        .update(users)
        .set({ failedLoginCount: lockedUntil ? 0 : failed, lockedUntil })
        .where(eq(users.id, user.id));
      await audit(ctx, { action: 'auth.login_failed', entityType: 'user', entityId: user.id, metadata: { locked: !!lockedUntil } });
      throw unauthorized('Wrong email or password');
    }
    if (user.totpSecret) {
      const challenge = randomToken();
      await ctx.db
        .insert(loginChallenges)
        .values({ id: sha256(challenge), userId: user.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
      return { status: 'second_factor', challenge };
    }
    return startSession(ctx, user.id, 'password');
  },
});

/** Uses up a recovery code if it matches one. */
async function consumeRecoveryCode(ctx: Ctx, userId: string, code: string): Promise<boolean> {
  const used = await ctx.db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256(code.toLowerCase())), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  return used.length > 0;
}

export const loginSecondFactor = defineService({
  name: 'auth.loginSecondFactor',
  description: 'Finish signing in with a code from an authenticator app or a recovery code.',
  kind: 'mutation',
  access: 'public',
  transaction: false,
  input: loginSecondFactorInput,
  async handler(ctx, input): Promise<LoginResult> {
    const id = sha256(input.challenge);
    const [challenge] = await ctx.db
      .select()
      .from(loginChallenges)
      .where(and(eq(loginChallenges.id, id), gt(loginChallenges.expiresAt, new Date())))
      .limit(1);
    if (!challenge) throw unauthorized('The sign-in expired. Start again.');
    if (challenge.attempts >= 5) {
      await ctx.db.delete(loginChallenges).where(eq(loginChallenges.id, id));
      throw tooManyRequests('Too many wrong codes. Start again.');
    }
    const [user] = await ctx.db.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
    const isRecovery = input.code.includes('-');
    const ok =
      !!user?.active &&
      !!user.totpSecret &&
      (isRecovery ? await consumeRecoveryCode(ctx, user.id, input.code) : verifyTotp(decrypt(user.totpSecret), input.code));
    if (!ok) {
      await ctx.db
        .update(loginChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(loginChallenges.id, id));
      throw unauthorized('That code is not right');
    }
    await ctx.db.delete(loginChallenges).where(eq(loginChallenges.id, id));
    return startSession(ctx, user!.id, isRecovery ? 'password+recovery-code' : 'password+totp');
  },
});

export const logout = defineService({
  name: 'auth.logout',
  description: 'Sign out of the current session.',
  kind: 'mutation',
  access: 'authenticated',
  tool: false,
  allowWithoutTwoFactor: true,
  input: empty,
  async handler(ctx) {
    if (ctx.sessionId) await revokeSession(ctx.db, ctx.sessionId);
    await audit(ctx, { action: 'auth.logout', entityType: 'user', entityId: ctx.actor!.userId });
    return { ok: true };
  },
});

export const me = defineService({
  name: 'auth.me',
  description: 'Who the signed-in user is: name, email, role, permissions and whether two-factor is on.',
  kind: 'query',
  access: 'authenticated',
  allowWithoutTwoFactor: true,
  input: empty,
  async handler(ctx) {
    const actor = ctx.actor!;
    const [[row], [codes]] = await Promise.all([
      ctx.db.select({ totpEnabledAt: users.totpEnabledAt, avatarFileId: users.avatarFileId }).from(users).where(eq(users.id, actor.userId)),
      ctx.db
        .select({ value: count() })
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, actor.userId), isNull(recoveryCodes.usedAt))),
    ]);
    return {
      id: actor.userId,
      email: actor.email,
      name: actor.name,
      role: actor.role,
      roleLabel: ROLE_INFO[actor.role].label,
      permissions: [...actor.permissions],
      totpEnabled: !!row?.totpEnabledAt,
      recoveryCodesLeft: codes?.value ?? 0,
      mustEnableTwoFactor: !!actor.mustEnableTwoFactor,
      avatarUrl: row?.avatarFileId ? `/api/files/${row.avatarFileId}/content` : null,
    };
  },
});

export async function issuePasswordReset(ctx: Ctx, user: { id: string; email: string; name: string }) {
  const token = randomToken();
  await ctx.db.insert(passwordResetTokens).values({ id: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  const product = await productName();
  await queueEmail(
    renderEmail({
      to: user.email,
      subject: `Reset your ${product} password`,
      greeting: `Hi ${user.name},`,
      paragraphs: ['Use the button below to choose a new password. The link works for one hour.'],
      action: { label: 'Choose a new password', url: `${appUrl()}/reset-password?token=${encodeURIComponent(token)}` },
      footer: 'If you did not ask for this, you can ignore this email.',
    }),
  );
}

export const requestPasswordReset = defineService({
  name: 'auth.requestPasswordReset',
  description: 'Email a password reset link. Always answers the same way, so it does not reveal whether an account exists.',
  kind: 'mutation',
  access: 'public',
  input: requestPasswordResetInput,
  async handler(ctx, input) {
    const [user] = await ctx.db.select().from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
    if (user?.active) {
      await issuePasswordReset(ctx, user);
      await audit(ctx, { action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id });
    }
    return { ok: true };
  },
});

export const resetPassword = defineService({
  name: 'auth.resetPassword',
  description: 'Set a new password with a reset link token.',
  kind: 'mutation',
  access: 'public',
  input: resetPasswordInput,
  async handler(ctx, input) {
    const id = sha256(input.token);
    const [token] = await ctx.db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .limit(1);
    if (!token) throw badRequest('This link has expired or was already used. Ask for a new one.');
    await ctx.db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
    await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, token.userId));
    await revokeUserSessions(ctx.db, token.userId);
    await audit(ctx, { action: 'auth.password_reset', entityType: 'user', entityId: token.userId });
    return { ok: true };
  },
});
