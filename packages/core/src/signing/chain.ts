import { createHash } from 'node:crypto';
import { asc, desc, eq, signingEnvelopes, signingEvents, sql } from '@openinc/db';
import type { Ctx } from '../context.ts';
import { canonicalJson, GENESIS_HASH } from '../registry/hash.ts';

type EventRow = typeof signingEvents.$inferSelect;

export function eventHash(prevHash: string, e: Omit<EventRow, 'id' | 'hash' | 'prevHash'>): string {
  return createHash('sha256')
    .update(prevHash)
    .update(
      canonicalJson({
        envelopeId: e.envelopeId,
        recipientId: e.recipientId,
        seq: e.seq,
        type: e.type,
        payload: e.payload,
        ip: e.ip,
        userAgent: e.userAgent,
        occurredAt: e.occurredAt,
      }),
    )
    .digest('hex');
}

/** Appends one event to an envelope's chain. Callers run inside a transaction; the envelope row lock orders appends. */
export async function appendEvent(
  ctx: Ctx,
  input: { envelopeId: string; recipientId?: string | null; type: string; payload?: Record<string, unknown> },
): Promise<EventRow> {
  await ctx.db.execute(sql`select 1 from ${signingEnvelopes} where ${signingEnvelopes.id} = ${input.envelopeId} for update`);
  const [last] = await ctx.db
    .select({ seq: signingEvents.seq, hash: signingEvents.hash })
    .from(signingEvents)
    .where(eq(signingEvents.envelopeId, input.envelopeId))
    .orderBy(desc(signingEvents.seq))
    .limit(1);
  const fields = {
    envelopeId: input.envelopeId,
    recipientId: input.recipientId ?? null,
    seq: (last?.seq ?? 0) + 1,
    type: input.type,
    payload: JSON.parse(JSON.stringify(input.payload ?? {})) as Record<string, unknown>,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 500) ?? null,
    occurredAt: new Date(),
  };
  const prevHash = last?.hash ?? GENESIS_HASH;
  const [row] = await ctx.db
    .insert(signingEvents)
    .values({ ...fields, prevHash, hash: eventHash(prevHash, fields) })
    .returning();
  return row!;
}

export async function listEvents(ctx: Ctx, envelopeId: string): Promise<EventRow[]> {
  return ctx.db.select().from(signingEvents).where(eq(signingEvents.envelopeId, envelopeId)).orderBy(asc(signingEvents.seq));
}

/** Recomputes every hash. `brokenAt` is the first event whose hash or link does not match. */
export function verifyEvents(events: EventRow[]): { ok: boolean; head: string; brokenAt: number | null } {
  let prev = GENESIS_HASH;
  for (const [i, e] of events.entries()) {
    if (e.seq !== i + 1 || e.prevHash !== prev || eventHash(prev, e) !== e.hash) return { ok: false, head: prev, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, head: prev, brokenAt: null };
}
