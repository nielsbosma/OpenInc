import { createHash } from 'node:crypto';
import { eq, lots, registryTransactions, sql } from '@openinc/db';
import type { RegistryTransactionInput } from '@openinc/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb, createCtx, getDb } from '../../src/context.ts';
import { stopJobs } from '../../src/jobs.ts';
import * as registryExports from '../../src/registry/exports-files.ts';
import { runRegistryChainCheck } from '../../src/registry/jobs.ts';
import { services } from '../../src/registry.ts';
import { invoke } from '../../src/service.ts';
import { storeFile } from '../../src/services/files.ts';
import { freshInstall, reachable, userCtx } from './db.ts';
import { H, people } from './helpers.ts';

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
    admin = await freshInstall();
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

  it('lets another module prepare a draft that a person commits in the wizard', async () => {
    const d = await invoke(services.registry.draftTransaction, member, {
      transaction: {
        type: 'class_change',
        effectiveDate: '2024-05-01',
        registrationDate: '2024-05-01',
        classes: [{ code: 'P', liqPrefMultiple: '1', seniorityRank: 1 }],
      },
      origin: { module: 'cap-table', reference: 'scenario-7', label: 'Cap Table: Series A' },
    });
    expect(d.status).toBe('draft');
    expect(d.url).toBe(`/registry/transactions/${d.id}/edit`);
    expect(d.origin).toEqual({ module: 'cap-table', reference: 'scenario-7', label: 'Cap Table: Series A' });
    await invoke(services.registry.deleteDraft, member, { transactionId: d.id });
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

  it('exports the register, history, extracts and settlement notes', async () => {
    for (const lang of ['en', 'sv'] as const) {
      const pdf = await registryExports.registerExport(auditor, { asOf: '2024-12-31', format: 'pdf', lang });
      expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
      const xlsx = await registryExports.registerExport(auditor, { asOf: '2024-12-31', format: 'xlsx', lang });
      expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
      const history = await registryExports.historyExport(auditor, { format: 'csv', lang });
      expect(history.body.toString()).toContain(lang === 'sv' ? 'Bildande' : 'Incorporation');
      const extract = await registryExports.holderExtract(auditor, { holderId: H.anna, lang });
      expect(extract.body.subarray(0, 4).toString()).toBe('%PDF');
      const note = await registryExports.settlementNote(auditor, { transactionId: saleId, lang });
      expect(note.contentType).toBe('application/pdf');
    }
    const csv = await registryExports.registerExport(auditor, { format: 'csv', lang: 'en' });
    expect(csv.body.toString()).toContain('Anna Andersson');
    const full = JSON.parse((await registryExports.fullJsonExport(auditor)).body.toString());
    expect(full.transactions.length).toBe(5);
    await expect(registryExports.registerExport(createCtx({ surface: 'web' }), { format: 'pdf', lang: 'en' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
