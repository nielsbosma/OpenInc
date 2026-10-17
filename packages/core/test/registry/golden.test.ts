import { readFileSync } from 'node:fs';
import { registryTransaction } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { type LedgerTx, replay } from '../../src/registry/engine.ts';
import { ledgerJson, registerCsv } from '../../src/registry/exports.ts';
import { registerView } from '../../src/registry/views.ts';
import { seConfig } from './helpers.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/se-history.json', import.meta.url), 'utf8')) as {
  transactions: { id: string; seq: number; tx: unknown }[];
};
const items: LedgerTx[] = fixture.transactions.map((t) => ({ id: t.id, seq: t.seq, tx: registryTransaction.parse(t.tx) }));

function exportsAt(list: LedgerTx[], until?: string) {
  const result = replay(list, seConfig(), { until });
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '));
  const date = until ?? '2099-12-31';
  // Git stores the golden files with LF line endings; the CSV itself uses CRLF.
  return { csv: registerCsv(registerView(result.ledger, seConfig(), date)).replace(/\r\n/g, '\n'), json: ledgerJson(result.ledger) };
}

describe('golden fixture: Swedish AB history', () => {
  it('replays from scratch to the stored exports', async () => {
    const end = exportsAt(items);
    await expect(end.csv).toMatchFileSnapshot('./fixtures/__golden__/se-history.register.csv');
    await expect(exportsAt(items, '2022-12-31').csv).toMatchFileSnapshot('./fixtures/__golden__/se-history.2022-12-31.csv');
    await expect(end.json).toMatchFileSnapshot('./fixtures/__golden__/se-history.ledger.txt');
  });

  it('gives identical exports whatever order the transactions are loaded in', () => {
    const reference = exportsAt(items);
    for (let i = 0; i < 5; i++) {
      const shuffled = [...items].sort(() => Math.random() - 0.5);
      expect(exportsAt(shuffled)).toEqual(reference);
    }
  });
});
