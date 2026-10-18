import { readFileSync } from 'node:fs';
import { registryTransaction } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../src/captable/scenario.ts';
import { buildState, type CapData } from '../../src/captable/state.ts';
import { buildTable } from '../../src/captable/table.ts';
import { type LedgerTx, replay } from '../../src/registry/engine.ts';
import { registerView } from '../../src/registry/views.ts';
import { seConfig } from '../registry/helpers.ts';

const fixture = JSON.parse(readFileSync(new URL('../registry/fixtures/se-history.json', import.meta.url), 'utf8')) as {
  transactions: { id: string; seq: number; tx: unknown }[];
};
const items: LedgerTx[] = fixture.transactions.map((t) => ({ id: t.id, seq: t.seq, tx: registryTransaction.parse(t.tx) }));

const data: CapData = {
  currency: 'SEK',
  digits: 2,
  config: seConfig(),
  items,
  settings: { includeUnallocatedPool: true },
  groups: [],
  stakeholders: [],
  schedules: [],
  plans: [],
  poolChanges: [],
  grants: [],
  exercises: [],
  unpriced: [],
  valuations: [],
};

describe('reconciliation with the share register', () => {
  const dates = [...new Set(items.map((i) => i.tx.effectiveDate))].sort();

  it('has the register’s shares per holder and class on every transaction date', () => {
    for (const date of dates) {
      const r = replay(items, seConfig(), { until: date });
      if (!r.ok) throw new Error(r.errors[0]?.message);
      const register = registerView(r.ledger, seConfig(), date);
      const expected = register.holders.flatMap((h) => h.positions.map((p) => `${h.holderId}|${p.classCode}|${p.count}`)).sort();
      const s = buildState(data, date);
      const actual = s.holdings
        .filter((h) => h.units > 0n)
        .map((h) => `${h.stakeholderId}|${h.classCode}|${h.units}`)
        .sort();
      expect(actual, date).toEqual(expected);
      const table = buildTable(s, { includePool: true, view: 'issued' });
      expect(table.totals.issued, date).toBe(String(register.totalShares));
    }
  });

  it('never creates or loses shares in random scenarios', () => {
    const base = buildState(data, dates.at(-1)!);
    const holders = base.holdings.filter((h) => h.units > 1n);
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 25; i++) {
      const h = holders[rand(holders.length)]!;
      const units = BigInt(1 + rand(Number(h.units < 1000n ? h.units : 1000n)));
      const to = holders[rand(holders.length)]!.stakeholderId;
      const amount = String(100_000 + rand(10_000_000));
      const run = runScenario(
        base,
        [
          {
            kind: 'secondary',
            fromStakeholderId: h.stakeholderId,
            toStakeholderId: to,
            classCode: h.classCode,
            units: String(units),
            pricePerShare: '1',
          },
          {
            kind: 'priced_round',
            name: 'Round',
            date: '2030-01-01',
            pricePerShare: '3',
            investments: [{ stakeholderId: to, amount }],
            classCode: 'R',
            className: '',
            votesPerShare: '1',
            seniorityRank: 1,
            liqPrefMultiple: '1',
            liqPrefCapMultiple: null,
            participation: 'none',
            antiDilution: 'none',
            poolTargetPct: null,
            poolBasis: 'post',
            proRataIds: [],
          },
        ],
        true,
      );
      const before = BigInt(run.base.totals.issued);
      const after = BigInt(run.end.totals.issued);
      expect(after - before).toBe(BigInt(amount) / 300n);
    }
  });
});
