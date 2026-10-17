import { createHash } from 'node:crypto';
import { eq, lots, registryTransactions, sql, users } from '@openinc/db';
import type { RegistryTransactionInput } from '@openinc/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadActor } from '../../src/auth/sessions.ts';
import { type Ctx, closeDb, createCtx, getDb } from '../../src/context.ts';
import { stopJobs } from '../../src/jobs.ts';
import { setupCode } from '../../src/lib/crypto.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { runRegistryChainCheck } from '../../src/registry/jobs.ts';
import { services } from '../../src/registry.ts';
import { invoke } from '../../src/service.ts';
import { storeFile } from '../../src/services/files.ts';
import { invalidateSettings } from '../../src/settings.ts';
import { boot, resetSystemStatus } from '../../src/system/lifecycle.ts';
import { H, people } from './helpers.ts';

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
  await client.query(
    'drop schema if exists registry cascade; drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;',
  );
  await client.end();
}

const anon = () => createCtx({ surface: 'web' });

async function userCtx(role: 'board' | 'member' | 'auditor', email: string, surface: Ctx['surface'] = 'web'): Promise<Ctx> {
  const [user] = await getDb()
    .insert(users)
    .values({ email, name: email.split('@')[0]!, role, passwordHash: await hashPassword('a-long-password-1') })
    .returning();
  return createCtx({ surface, actor: (await loadActor(getDb(), user!.id))! });
}

const draft = (ctx: Ctx, transaction: RegistryTransactionInput) => invoke(services.registry.draftTransaction, ctx, { transaction });

const commit = (ctx: Ctx, transactionId: string) => invoke(services.registry.commit, ctx, { transactionId });

describe.runIf(await reachable())('share register (database)', () => {
  let admin: Ctx;
  let board: Ctx;
  let member: Ctx;
  let auditor: Ctx;
  let incorporationId: string;
  let saleId: string;
  let saleEnteredAt: Date;

  beforeAll(async () => {
    await wipe();
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
    admin = createCtx({ surface: 'web', actor: (await loadActor(getDb(), row!.id))! });
    await invoke(services.settings.update, admin, {
      group: 'company',
      values: { name: 'Exempel AB', country: 'SE', currency: 'SEK', timeZone: 'Europe/Stockholm' },
    });
    board = await userCtx('board', 'board@example.com');
    member = await userCtx('member', 'member@example.com');
    auditor = await userCtx('auditor', 'auditor@example.com');
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it('is set up with the Swedish rule pack for an AB', async () => {
    await expect(invoke(services.registry.status, auditor, {})).resolves.toEqual({ setUp: false });
    await expect(
      invoke(services.registry.setup, member, { country: 'SE', legalForm: 'AB', nationalNumber: '556123-4567' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const settings = await invoke(services.registry.setup, admin, { country: 'SE', legalForm: 'AB', nationalNumber: '556123-4567' });
    expect(settings.rulePack).toBe('se-abl');
    expect(settings.numbering).toBe(true);
  });

  it('commits an incorporation with a hash and sequence number', async () => {
    const d = await draft(member, {
      type: 'incorporation',
      effectiveDate: '2024-01-15',
      shareCapital: '2500000',
      holders: [people.anna, people.bjorn],
      classes: [{ code: 'A', votesPerShare: '10' }, { code: 'B' }],
      allocations: [
        { holderId: H.anna, classCode: 'A', count: 1000 },
        { holderId: H.bjorn, classCode: 'B', count: 24000 },
      ],
    });
    expect(d.status).toBe('draft');
    await expect(commit(member, d.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const committed = await commit(board, d.id);
    expect(committed.seq).toBe(1);
    expect(committed.hash).toMatch(/^[0-9a-f]{64}$/);
    incorporationId = committed.id;
    const register = await invoke(services.registry.getRegister, auditor, { asOf: '2024-01-15' });
    expect(register.totalShares).toBe(25000n);
    expect(register.holders.map((h) => h.name)).toEqual(['Anna Andersson', 'Björn Berg']);
  });

  it('commits a sale and shows the register as of any date', async () => {
    const d = await draft(member, {
      type: 'transfer',
      effectiveDate: '2024-06-01',
      kind: 'sale',
      fromHolderId: H.bjorn,
      toHolderId: H.cecilia,
      holders: [people.cecilia],
      pricePerShare: '2',
      lines: [{ classCode: 'B', count: 20000 }],
    });
    const preview = await invoke(services.registry.validate, member, { transactionId: d.id });
    expect(preview.ok).toBe(true);
    expect(preview.changedHolderIds.sort()).toEqual([H.bjorn, H.cecilia].sort());
    const c = await commit(board, d.id);
    saleId = c.id;
    saleEnteredAt = c.enteredAt!;
    const before = await invoke(services.registry.getRegister, auditor, { asOf: '2024-05-31' });
    const after = await invoke(services.registry.getRegister, auditor, { asOf: '2024-06-01' });
    expect(before.holders.find((h) => h.holderId === H.cecilia)).toBeUndefined();
    expect(after.holders.find((h) => h.holderId === H.cecilia)?.shares).toBe(20000n);
  });

  it('blocks a backdated transaction that breaks a later one, naming it', async () => {
    const d = await draft(member, {
      type: 'transfer',
      effectiveDate: '2024-03-01',
      kind: 'gift',
      fromHolderId: H.bjorn,
      toHolderId: H.anna,
      lines: [{ classCode: 'B', count: 5000 }],
    });
    await expect(commit(board, d.id)).rejects.toThrow(/conflicts with transaction #2 Transfer on 2024-06-01/);
    const v = await invoke(services.registry.validate, member, { transactionId: d.id });
    expect(v.ok).toBe(false);
    expect(v.conflict?.seq).toBe(2);
    expect(v.errors[0]?.rule).toBe('INSUFFICIENT_SHARES');
    await invoke(services.registry.deleteDraft, member, { transactionId: d.id });
  });

  it('accepts a harmless backdated transaction and rebuilds later lots', async () => {
    const d = await draft(member, {
      type: 'transfer',
      effectiveDate: '2024-03-01',
      kind: 'gift',
      fromHolderId: H.bjorn,
      toHolderId: H.anna,
      lines: [{ classCode: 'B', count: 1000 }],
    });
    const c = await commit(board, d.id);
    expect(c.seq).toBe(3);
    const register = await invoke(services.registry.getRegister, auditor, { asOf: '2024-12-31' });
    expect(register.holders.find((h) => h.holderId === H.bjorn)?.shares).toBe(3000n);
    const known = await invoke(services.registry.getRegister, auditor, { asOf: '2024-12-31', knownAt: saleEnteredAt.toISOString() });
    expect(known.holders.find((h) => h.holderId === H.bjorn)?.shares).toBe(4000n);
  });

  it('never lets anyone change or delete a committed row', async () => {
    await expect(
      getDb().update(registryTransactions).set({ note: 'edited' }).where(eq(registryTransactions.id, incorporationId)),
    ).rejects.toThrow();
    await expect(getDb().delete(registryTransactions).where(eq(registryTransactions.id, incorporationId))).rejects.toThrow();
    await expect(
      invoke(services.registry.updateDraft, member, {
        transactionId: incorporationId,
        transaction: { type: 'split', effectiveDate: '2024-01-01', ratio: 2 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('reverses a transaction by replaying without it', async () => {
    await invoke(services.registry.reverse, board, {
      transactionId: saleId,
      reason: 'Entered with the wrong buyer',
      effectiveDate: '2024-07-01',
    });
    const register = await invoke(services.registry.getRegister, auditor, { asOf: '2024-12-31' });
    expect(register.holders.find((h) => h.holderId === H.cecilia)).toBeUndefined();
    const sale = await invoke(services.registry.getTransaction, auditor, { transactionId: saleId });
    expect(sale.status).toBe('reversed');
    expect(sale.reversedBy?.seq).toBe(4);
  });

  it('keeps the hash chain intact and detects tampering', async () => {
    expect(await invoke(services.registry.verifyChain, auditor, {})).toMatchObject({ ok: true, checked: 4 });
    const db = getDb();
    await db.execute(sql`alter table registry.transaction disable trigger transaction_immutable`);
    await db.execute(sql`update registry.transaction set payload = jsonb_set(payload, '{note}', '"tampered"') where seq = 2`);
    await db.execute(sql`alter table registry.transaction enable trigger transaction_immutable`);
    expect(await runRegistryChainCheck(createCtx({ surface: 'worker' }))).toMatchObject({ ok: false, brokenAtSeq: 2 });
    await db.execute(sql`alter table registry.transaction disable trigger transaction_immutable`);
    await db.execute(sql`update registry.transaction set payload = jsonb_set(payload, '{note}', '""') where seq = 2`);
    await db.execute(sql`alter table registry.transaction enable trigger transaction_immutable`);
    expect(await runRegistryChainCheck(createCtx({ surface: 'worker' }))).toMatchObject({ ok: true });
  });

  it('rebuilds the derived lots identically', async () => {
    const before = await getDb().select().from(lots).orderBy(lots.key);
    await invoke(services.registry.rebuild, admin, {});
    const after = await getDb().select().from(lots).orderBy(lots.key);
    expect(after).toEqual(before);
  });

  it('needs a second person under four-eyes approval and refuses commits over MCP', async () => {
    await invoke(services.registry.setup, admin, { country: 'SE', legalForm: 'AB', nationalNumber: '556123-4567', fourEyes: true });
    const d = await draft(board, {
      type: 'pledge',
      effectiveDate: '2024-08-01',
      holderId: H.anna,
      lines: [{ classCode: 'A', count: 100 }],
      pledgee: { name: 'Nordbank AB' },
    });
    await expect(commit(board, d.id)).rejects.toThrow(/someone other than/);
    const mcpAdmin = { ...admin, surface: 'mcp' as const };
    await expect(commit(mcpAdmin, d.id)).rejects.toThrow(/turned off/);
    const c = await commit(admin, d.id);
    expect(c.approvedBy).toBe(admin.actor!.userId);
  });

  it('attaches evidence with its SHA-256', async () => {
    const file = await storeFile(member, {
      name: 'board-minutes.pdf',
      contentType: 'application/pdf',
      kind: 'registry-document',
      data: Buffer.from('%PDF-1.4 minutes'),
    });
    const doc = await invoke(services.registry.attachDocument, member, {
      transactionId: incorporationId,
      fileId: file.id,
      kind: 'minutes',
    });
    expect(doc.sha256).toBe(createHash('sha256').update('%PDF-1.4 minutes').digest('hex'));
    const tx = await invoke(services.registry.getTransaction, auditor, { transactionId: incorporationId });
    expect(tx.documents).toHaveLength(1);
  });
});
