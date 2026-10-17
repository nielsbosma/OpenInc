import { and, type DbOrTx, eq, gt, lt, ne, sessions, users } from '@openinc/db';
import { permissionsFor } from '@openinc/shared';
import type { Actor } from '../context.ts';
import { randomToken, sha256 } from '../lib/crypto.ts';
import { getSettingsOrDefaults } from '../settings.ts';

export const SESSION_COOKIE = 'openinc_session';
const TOUCH_AFTER_MS = 5 * 60 * 1000;

async function sessionTtlMs(): Promise<number> {
  return (await getSettingsOrDefaults('security')).sessionDays * 24 * 60 * 60 * 1000;
}

/** An inactive account resolves to null, so deactivating someone signs them out everywhere at once. */
export async function loadActor(db: DbOrTx, userId: string): Promise<Actor | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !user.active) return null;
  const security = await getSettingsOrDefaults('security');
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: permissionsFor(user.role),
    mustEnableTwoFactor: security.enforceTwoFactor && !user.totpEnabledAt,
  };
}

export async function createSession(db: DbOrTx, userId: string, meta: { ip?: string; userAgent?: string }) {
  const token = randomToken();
  const id = sha256(token);
  const expiresAt = new Date(Date.now() + (await sessionTtlMs()));
  await db.insert(sessions).values({ id, userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) });
  return { token, id, expiresAt };
}

/** Sessions slide: each use (at most every five minutes) extends them by the configured session length. */
export async function resolveSession(db: DbOrTx, token: string): Promise<{ actor: Actor; sessionId: string; expiresAt: Date } | null> {
  const id = sha256(token);
  const [session] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;
  const actor = await loadActor(db, session.userId);
  if (!actor) return null;
  let expiresAt = session.expiresAt;
  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    expiresAt = new Date(Date.now() + (await sessionTtlMs()));
    await db.update(sessions).set({ lastSeenAt: new Date(), expiresAt }).where(eq(sessions.id, id));
  }
  return { actor, sessionId: id, expiresAt };
}

export async function revokeSession(db: DbOrTx, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeUserSessions(db: DbOrTx, userId: string, exceptSessionId?: string) {
  await db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: DbOrTx) {
  return db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({ id: sessions.id });
}
