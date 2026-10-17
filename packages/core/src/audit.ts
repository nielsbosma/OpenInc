import { auditLog } from '@openinc/db';
import type { Ctx } from './context.ts';

const SECRET_KEYS =
  /^(password|passwordHash|currentPassword|newPassword|token|tokenHash|totpSecret|totpPendingSecret|apiKey|secret|codeHash)$/i;

/** Masks secrets and makes values JSON-safe. A set secret shows as '••••' so the log still says that it changed. */
export function redact(value: unknown, secretKeys: ReadonlySet<string> = new Set()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, secretKeys));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) || secretKeys.has(k) ? (v ? '••••' : (v ?? null)) : redact(v, secretKeys),
      ]),
    );
  }
  return value;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  /** Extra field names to mask, e.g. a settings group's secret fields. */
  secretKeys?: string[];
}

/** Records who did what, when, from which surface, with before and after values. Call it inside the mutating service. */
export async function audit(ctx: Ctx, entry: AuditEntry): Promise<void> {
  const secrets = new Set(entry.secretKeys ?? []);
  await ctx.db.insert(auditLog).values({
    actorId: ctx.actor?.userId ?? null,
    actorLabel: ctx.actor?.email ?? ctx.surface,
    surface: ctx.surface,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: redact(entry.before, secrets),
    after: redact(entry.after, secrets),
    metadata: redact({ ...entry.metadata, ip: ctx.ip, userAgent: ctx.userAgent }) as Record<string, unknown>,
  });
}

/** Only the fields that changed, for compact before/after entries. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}
