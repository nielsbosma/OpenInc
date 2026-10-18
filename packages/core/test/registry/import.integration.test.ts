import { MockLanguageModelV4 } from 'ai/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Ctx, closeDb, createCtx } from '../../src/context.ts';
import { stopJobs } from '../../src/jobs.ts';
import { runImport } from '../../src/registry/import/run.ts';
import { services } from '../../src/registry.ts';
import { invoke } from '../../src/service.ts';
import { storeFile } from '../../src/services/files.ts';
import { freshInstall, reachable, userCtx } from './db.ts';
import { snapshotExtraction } from './helpers.ts';

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };

describe.runIf(await reachable())('AI import (database)', () => {
  let admin: Ctx;
  let member: Ctx;
  let board: Ctx;
  let prompt = '';

  beforeAll(async () => {
    admin = await freshInstall();
    member = await userCtx('member', 'member@example.com');
    board = await userCtx('board', 'board@example.com');
    await invoke(services.registry.setup, admin, { country: 'SE', legalForm: 'AB', nationalNumber: '556123-4567' });
    await invoke(services.settings.update, admin, {
      group: 'ai',
      values: { provider: 'anthropic', model: 'test-model', apiKey: 'test-key' },
    });
  });

  afterAll(async () => {
    await stopJobs();
    await closeDb();
  });

  it('reads a CSV through the model, checks it, and makes drafts only when asked', async () => {
    const csv =
      'Aktieägare;Personnummer;Antal;Aktienummer\r\nÅsa Öberg;19811218-9876;15 000;1-15000\r\nInvest AB;556036-0793;10 000;15001-25000\r\n';
    const file = await storeFile(member, {
      name: 'aktiebok.csv',
      contentType: 'text/csv',
      kind: 'registry-import',
      data: Buffer.from(csv, 'latin1'),
    });
    const started = await invoke(services.registry.startImport, member, { fileId: file.id });

    const extraction = snapshotExtraction();
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        prompt = JSON.stringify(options.prompt);
        const tokenized = {
          ...extraction,
          holders: extraction.holders.map((h, i) => ({ ...h, nationalId: `[ID_${i + 1}]` })),
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(tokenized) }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage,
          warnings: [],
        } as never;
      },
    });
    await runImport(createCtx({ surface: 'worker' }), started.id, model);

    expect(prompt).toContain('Åsa Öberg');
    expect(prompt).not.toContain('19811218-9876');
    const review = await invoke(services.registry.getImport, member, { importId: started.id });
    expect(review.status).toBe('review');
    expect(review.source?.sheets[0]?.rows[1]?.[0]).toBe('Åsa Öberg');
    expect(review.result?.extraction.holders.map((h) => h.nationalId)).toEqual(['19811218-9876', '556036-0793']);
    expect(review.result?.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const register = await invoke(services.registry.getRegister, member, {});
    expect(register.initialized).toBe(false);

    const edited = {
      ...review.result!.extraction,
      holdings: review.result!.extraction.holdings.map((h, i) => (i === 1 ? { ...h, count: '9000' } : h)),
    };
    const rechecked = await invoke(services.registry.updateImport, member, { importId: started.id, extraction: edited });
    expect(rechecked.issues.some((i) => i.severity === 'error')).toBe(true);
    await expect(invoke(services.registry.createImportDrafts, member, { importId: started.id })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });

    await invoke(services.registry.updateImport, member, { importId: started.id, extraction: review.result!.extraction });
    const { draftTxIds } = await invoke(services.registry.createImportDrafts, member, { importId: started.id });
    expect(draftTxIds).toHaveLength(1);
    expect((await invoke(services.registry.getRegister, member, {})).initialized).toBe(false);

    await invoke(services.registry.commit, board, { transactionId: draftTxIds[0]! });
    const after = await invoke(services.registry.getRegister, member, { asOf: '2024-12-31' });
    expect(after.holders.map((h) => [h.name, h.shares])).toEqual([
      ['Åsa Öberg', 15000n],
      ['Invest AB', 10000n],
    ]);
  });

  it('records a failure the person can read when the model call fails', async () => {
    const file = await storeFile(member, {
      name: 'list.csv',
      contentType: 'text/csv',
      kind: 'registry-import',
      data: Buffer.from('a;b\n1;2\n'),
    });
    const started = await invoke(services.registry.startImport, member, { fileId: file.id });
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw Object.assign(new Error('rate limited'), { statusCode: 429 });
      },
    });
    await runImport(createCtx({ surface: 'worker' }), started.id, model);
    const row = await invoke(services.registry.getImport, member, { importId: started.id });
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/429|rate/);
  });
});
