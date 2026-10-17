import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type EngineConfig, Ledger, type LedgerTx, replay } from '../../src/registry/engine.ts';
import { euConfig, H, incorporation, people, seConfig, tx } from './helpers.ts';

const HOLDERS = [H.anna, H.bjorn, H.cecilia, H.bolag];
const DETAILS = [people.anna, people.bjorn, people.cecilia, people.bolag];

type Intent = { op: string; a: number; b: number; amount: number; klass: 'A' | 'B'; dayStep: number };

const intent = fc.record({
  op: fc.constantFrom('transfer', 'transfer', 'transfer', 'issue', 'register', 'pledge', 'release', 'split', 'bonus'),
  a: fc.nat(3),
  b: fc.nat(3),
  amount: fc.integer({ min: 1, max: 5000 }),
  klass: fc.constantFrom('A', 'B'),
  dayStep: fc.integer({ min: 0, max: 40 }),
});

function date(day: number) {
  return new Date(Date.UTC(2024, 1, 1) + day * 86_400_000).toISOString().slice(0, 10);
}

/** Turns random intents into transactions that are valid for the ledger as it stands. */
function build(intents: Intent[], config: EngineConfig, foundation: LedgerTx): LedgerTx[] {
  const ledger = new Ledger(config);
  ledger.apply(foundation);
  const out = [foundation];
  let day = 0;
  let seq = 2;
  for (const i of intents) {
    day += i.dayStep;
    const effectiveDate = date(day);
    const holderShares = (h: string, c: string) => {
      const held = ledger.open.filter((l) => l.holderId === h && l.classCode === c && !l.interim).reduce((s, l) => s + l.count, 0n);
      const pledged = ledger.openPledges(h, c).reduce((s, p) => s + p.count, 0n);
      return held - pledged;
    };
    let candidate: LedgerTx | null = null;
    const from = HOLDERS[i.a]!;
    const to = HOLDERS[i.b]!;
    const free = holderShares(from, i.klass);
    const base = { effectiveDate, holders: DETAILS };
    if (i.op === 'transfer' && from !== to && free > 0n) {
      const count = BigInt(i.amount) % free || free;
      candidate = tx(
        {
          ...base,
          type: 'transfer',
          kind: 'sale',
          fromHolderId: from,
          toHolderId: to,
          pricePerShare: '3.25',
          lines: [{ classCode: i.klass, count: count.toString() }],
          restrictionSteps: { consent: { obtained: true } },
        },
        seq,
      );
    } else if (i.op === 'issue') {
      candidate = tx(
        {
          ...base,
          type: 'new_issue',
          form: 'cash',
          allocation: 'directed',
          classCode: i.klass,
          pricePerShare: '10',
          ...(i.amount % 2 ? { registrationDate: effectiveDate } : {}),
          subscriptions: [{ holderId: to, count: i.amount }],
        },
        seq,
      );
    } else if (i.op === 'register' && ledger.interimIssues.size) {
      candidate = tx(
        { ...base, type: 'registration', registrationDate: effectiveDate, ofTransactionId: [...ledger.interimIssues][0]! },
        seq,
      );
    } else if (i.op === 'pledge' && free > 0n) {
      const count = BigInt(i.amount) % free || free;
      candidate = tx(
        { ...base, type: 'pledge', holderId: from, lines: [{ classCode: i.klass, count: count.toString() }], pledgee: { name: 'Bank' } },
        seq,
      );
    } else if (i.op === 'release' && ledger.openPledges().length) {
      candidate = tx({ ...base, type: 'pledge_release', pledgeId: ledger.openPledges()[0]!.id }, seq);
    } else if (i.op === 'split' && !ledger.interimIssues.size && ledger.totalShares < 1_000_000n) {
      candidate = tx({ ...base, type: 'split', registrationDate: effectiveDate, ratio: 2 }, seq);
    } else if (i.op === 'bonus' && !ledger.interimIssues.size && config.settings.capitalMode === 'quota') {
      candidate = tx(
        {
          ...base,
          type: 'bonus_issue',
          registrationDate: effectiveDate,
          mode: 'new_shares',
          capitalIncrease: '100000',
          ratio: { newShares: 1, perShares: 5 },
        },
        seq,
      );
    }
    if (!candidate) continue;
    ledger.apply(candidate);
    out.push(candidate);
    seq++;
  }
  return out;
}

const signature = (l: Ledger) =>
  JSON.stringify({ open: l.open, closed: l.closed, movements: l.movements, pledges: l.pledges, capital: l.shareCapital }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );

const unnumberedFoundation = tx(
  {
    type: 'incorporation',
    effectiveDate: '2024-01-15',
    shareCapital: '2500000',
    holders: [people.anna, people.bjorn],
    classes: [
      { code: 'A', nominalPerShare: '1', votesPerShare: '10' },
      { code: 'B', nominalPerShare: '1' },
    ],
    allocations: [
      { holderId: H.anna, classCode: 'A', count: 1000 },
      { holderId: H.bjorn, classCode: 'B', count: 24000 },
    ],
  },
  1,
);

describe('registry engine properties', () => {
  for (const [label, config, foundation] of [
    ['numbered, se-abl', seConfig(), incorporation()],
    ['unnumbered, eu-base nominal', euConfig(), unnumberedFoundation],
  ] as const) {
    it(`random valid sequences never break an invariant and replay identically (${label})`, () => {
      fc.assert(
        fc.property(fc.array(intent, { minLength: 10, maxLength: 60 }), (intents) => {
          const items = build(intents, config, foundation);
          const first = replay(items, config);
          const second = replay([...items].reverse(), config);
          expect(first.ok).toBe(true);
          expect(second.ok).toBe(true);
          expect(signature(first.ledger)).toBe(signature(second.ledger));
          const issued = [...first.ledger.classes.values()].reduce((s, c) => s + c.issued, 0n);
          expect(first.ledger.open.reduce((s, l) => s + l.count, 0n)).toBe(issued);
        }),
        { numRuns: 150 },
      );
    });
  }

  it('rejects over-transfers and double-numbered shares with a named rule', () => {
    fc.assert(
      fc.property(fc.integer({ min: 24001, max: 1_000_000 }), fc.integer({ min: 1, max: 1000 }), (tooMany, start) => {
        const over = replay(
          [
            incorporation(),
            tx(
              {
                type: 'transfer',
                effectiveDate: '2024-02-01',
                kind: 'gift',
                fromHolderId: H.bjorn,
                toHolderId: H.anna,
                lines: [{ classCode: 'B', count: tooMany }],
              },
              2,
            ),
          ],
          seConfig(),
        );
        expect(!over.ok && over.errors[0]?.rule).toBe('INSUFFICIENT_SHARES');
        const dup = replay(
          [
            tx(
              {
                type: 'opening_balance',
                effectiveDate: '2024-01-01',
                shareCapital: '2500000',
                holders: [people.anna, people.bjorn],
                classes: [{ code: 'A' }],
                lots: [
                  { holderId: H.anna, classCode: 'A', count: 1000, ranges: [{ from: start, to: start + 999 }] },
                  { holderId: H.bjorn, classCode: 'A', count: 1000, ranges: [{ from: start + 500, to: start + 1499 }] },
                ],
              },
              1,
            ),
          ],
          seConfig(),
        );
        expect(!dup.ok && dup.errors[0]?.rule).toBe('UNIQUE_SHARE_NUMBERS');
      }),
      { numRuns: 50 },
    );
  });
});
