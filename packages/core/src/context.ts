import { createDb, type Database, type DbOrTx } from '@openinc/db';
import type { Permission, Role } from '@openinc/shared';
import { getEnv } from './env.ts';

/** Where a call came from. Recorded on every audit entry. */
export type Surface = 'web' | 'mcp' | 'ai' | 'worker' | 'system';

export interface Actor {
  userId: string;
  email: string;
  name: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
  /** An Admin enforces two-factor and this user has not set it up: only the setup itself is allowed. */
  mustEnableTwoFactor?: boolean;
}

export interface Ctx {
  db: DbOrTx;
  actor: Actor | null;
  surface: Surface;
  ip?: string;
  userAgent?: string;
  sessionId?: string;
  /** The dataroom portal's visitor cookie, for the link named in the call. Never a staff session. */
  portalSession?: string;
}

let db: Database | undefined;

export function getDb(): Database {
  db ??= createDb(getEnv().DATABASE_URL);
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    const pool = db.$client;
    db = undefined;
    await pool.end();
  }
}

export function createCtx(init: Partial<Omit<Ctx, 'surface'>> & { surface: Surface }): Ctx {
  return { db: getDb(), actor: null, ...init };
}

export function systemCtx(surface: Surface = 'system'): Ctx {
  return createCtx({ surface });
}

export function can(ctx: Ctx, permission: Permission): boolean {
  return ctx.actor?.permissions.has(permission) ?? false;
}
