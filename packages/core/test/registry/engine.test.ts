import { describe, expect, it } from 'vitest';
import { replay } from '../../src/registry/engine.ts';
import { registerView } from '../../src/registry/views.ts';
import { euConfig, H, incorporation, people, seConfig, tx } from './helpers.ts';

function ok(result: ReturnType<typeof replay>) {
  if (!result.ok) throw new Error(`${result.errors.map((e) => `${e.rule}: ${e.message}`).join('\n')}`);
  return result;
}

const holding = (result: ReturnType<typeof replay>, holderId: string, classCode: string) =>
  result.ledger.open
    .filter((l) => l.holderId === holderId && l.classCode === classCode)
    .map((l) => ({ count: l.count, from: l.from, to: l.to, interim: l.interim }));

describe('registry engine', () => {
  it('incorporates with numbered shares and computes votes and quota value', () => {
    const r = ok(replay([incorporation()], seConfig()));
    expect(holding(r, H.anna, 'A')).toEqual([{ count: 1000n, from: 1n, to: 1000n, interim: false }]);
    expect(holding(r, H.bjorn, 'B')).toEqual([{ count: 24000n, from: 1001n, to: 25000n, interim: false }]);
    const view = registerView(r.ledger, seConfig(), '2024-01-15');
    expect(view.quotaValue).toBe('1');
    expect(view.totalVotes).toBe('34000');
    expect(view.holders.find((h) => h.holderId === H.anna)?.votesPct).toBe('29.411765');
  });

  it('rejects an invalid personnummer under se-abl but not under eu-base', () => {
    const bad = (pack: 'se' | 'eu') =>
      replay(
        [
          tx(
            {
              type: 'incorporation',
              effectiveDate: '2024-01-01',
              shareCapital: pack === 'se' ? '2500000' : '2500000',
              holders: [{ ...people.anna, nationalId: '19811218-9875' }],
              classes: [{ code: 'A', nominalPerShare: pack === 'eu' ? '1' : null }],
              allocations: [{ holderId: H.anna, classCode: 'A', count: 25000 }],
            },
            1,
          ),
        ],
        pack === 'se' ? seConfig() : euConfig(),
      );
    const se = bad('se');
    expect(se.ok).toBe(false);
    expect(!se.ok && se.errors[0]?.rule).toBe('SE_PERSONAL_NUMBER');
    expect(bad('eu').ok).toBe(true);
  });

  it('enforces the minimum share capital of a Swedish AB', () => {
    const r = replay(
      [
        tx(
          {
            type: 'incorporation',
            effectiveDate: '2024-01-01',
            shareCapital: '100000',
            holders: [people.anna],
            classes: [{ code: 'A' }],
            allocations: [{ holderId: H.anna, classCode: 'A', count: 1000 }],
          },
          1,
        ),
      ],
      seConfig(),
    );
    expect(!r.ok && r.errors.map((e) => e.rule)).toEqual(['SE_MIN_SHARE_CAPITAL']);
  });

  it('transfers named share numbers and needs the consent step for restricted classes', () => {
    const sale = (steps: object) =>
      tx(
        {
          type: 'transfer',
          effectiveDate: '2024-03-01',
          kind: 'sale',
          fromHolderId: H.anna,
          toHolderId: H.cecilia,
          holders: [people.cecilia],
          lines: [{ classCode: 'A', count: 100, ranges: [{ from: 401, to: 500 }] }],
          pricePerShare: '12.5',
          restrictionSteps: steps,
        },
        2,
      );
    const blocked = replay([incorporation(), sale({})], seConfig());
    expect(!blocked.ok && blocked.errors[0]?.rule).toBe('RESTRICTION_CONSENT');

    const r = ok(replay([incorporation(), sale({ consent: { obtained: true, date: '2024-02-20' } })], seConfig()));
    expect(holding(r, H.anna, 'A')).toEqual([
      { count: 400n, from: 1n, to: 400n, interim: false },
      { count: 500n, from: 501n, to: 1000n, interim: false },
    ]);
    expect(holding(r, H.cecilia, 'A')).toEqual([{ count: 100n, from: 401n, to: 500n, interim: false }]);
    const m = r.ledger.movements.find((x) => x.toHolderId === H.cecilia)!;
    expect(m.consideration).toBe(125000n);
  });

  it('rejects transferring shares the holder does not have', () => {
    const r = replay(
      [
        incorporation(),
        tx(
          {
            type: 'transfer',
            effectiveDate: '2024-03-01',
            kind: 'gift',
            fromHolderId: H.bjorn,
            toHolderId: H.anna,
            lines: [{ classCode: 'B', count: 10, ranges: [{ from: 1, to: 10 }] }],
          },
          2,
        ),
      ],
      seConfig(),
    );
    expect(!r.ok && r.errors[0]?.rule).toBe('NOT_HOLDERS_SHARES');
  });

  it('keeps new shares interim until registration under se-abl and blocks transferring them', () => {
    const issue = tx(
      {
        type: 'new_issue',
        effectiveDate: '2024-05-01',
        decisionDate: '2024-04-20',
        form: 'cash',
        allocation: 'directed',
        classCode: 'B',
        pricePerShare: '50',
        holders: [people.bolag],
        subscriptions: [{ holderId: H.bolag, count: 5000 }],
      },
      2,
    );
    const r = ok(replay([incorporation(), issue], seConfig()));
    expect(holding(r, H.bolag, 'B')).toEqual([{ count: 5000n, from: 25001n, to: 30000n, interim: true }]);
    expect(r.ledger.shareCapital).toBe(3000000n);

    const sell = tx(
      {
        type: 'transfer',
        effectiveDate: '2024-05-10',
        kind: 'sale',
        fromHolderId: H.bolag,
        toHolderId: H.anna,
        pricePerShare: '50',
        lines: [{ classCode: 'B', count: 10 }],
      },
      3,
    );
    const blocked = replay([incorporation(), issue, sell], seConfig());
    expect(!blocked.ok && blocked.errors[0]?.rule).toBe('INTERIM_SHARES');

    const registered = tx(
      { type: 'registration', effectiveDate: '2024-05-08', registrationDate: '2024-05-08', ofTransactionId: issue.id },
      4,
    );
    const after = ok(replay([incorporation(), issue, registered, sell], seConfig()));
    expect(holding(after, H.bolag, 'B')).toEqual([{ count: 4990n, from: 25011n, to: 30000n, interim: false }]);

    const split = tx({ type: 'split', effectiveDate: '2024-05-06', registrationDate: '2024-05-06', ratio: 2 }, 5);
    const r2 = replay([incorporation(), issue, split], seConfig());
    expect(!r2.ok && r2.errors[0]?.rule).toBe('INTERIM_PENDING');
  });

  it('needs Bolagsverket registration before a split under se-abl', () => {
    const r = replay([incorporation(), tx({ type: 'split', effectiveDate: '2024-06-01', ratio: 2 }, 2)], seConfig());
    expect(!r.ok && r.errors[0]?.rule).toBe('REGISTRATION_REQUIRED');
  });

  it('splits and renumbers shares and pledges', () => {
    const pledge = tx(
      {
        type: 'pledge',
        effectiveDate: '2024-02-01',
        holderId: H.bjorn,
        lines: [{ classCode: 'B', count: 100 }],
        pledgee: { name: 'Bank AB' },
      },
      2,
    );
    const split = tx({ type: 'split', effectiveDate: '2024-06-01', registrationDate: '2024-06-01', ratio: 3 }, 3);
    const r = ok(replay([incorporation(), pledge, split], seConfig()));
    expect(holding(r, H.anna, 'A')).toEqual([{ count: 3000n, from: 1n, to: 3000n, interim: false }]);
    expect(holding(r, H.bjorn, 'B')).toEqual([{ count: 72000n, from: 3001n, to: 75000n, interim: false }]);
    expect(r.ledger.openPledges()[0]).toMatchObject({ count: 300n, ranges: [{ from: 3001n, to: 3300n }] });
    expect(r.ledger.nextNumber).toBe(75001n);
  });

  it('blocks transferring pledged shares until the pledge is released', () => {
    const pledge = tx(
      {
        type: 'pledge',
        effectiveDate: '2024-02-01',
        holderId: H.bjorn,
        lines: [{ classCode: 'B', count: 24000 }],
        pledgee: { name: 'Bank AB' },
      },
      2,
    );
    const gift = tx(
      {
        type: 'transfer',
        effectiveDate: '2024-03-01',
        kind: 'gift',
        fromHolderId: H.bjorn,
        toHolderId: H.cecilia,
        holders: [people.cecilia],
        lines: [{ classCode: 'B', count: 10 }],
      },
      3,
    );
    const blocked = replay([incorporation(), pledge, gift], seConfig());
    expect(!blocked.ok && blocked.errors[0]?.rule).toBe('PLEDGED_SHARES');
    const release = tx({ type: 'pledge_release', effectiveDate: '2024-02-15', pledgeId: pledge.id }, 4);
    ok(replay([incorporation(), pledge, release, gift], seConfig()));
  });

  it('issues bonus shares pro rata with rounding, or raises the quota value only', () => {
    const bonus = tx(
      {
        type: 'bonus_issue',
        effectiveDate: '2024-07-01',
        registrationDate: '2024-07-01',
        mode: 'new_shares',
        capitalIncrease: '625000',
        ratio: { newShares: 1, perShares: 3 },
        rounding: 'down',
      },
      2,
    );
    const r = ok(replay([incorporation(), bonus], seConfig()));
    expect(holding(r, H.anna, 'A')).toEqual([
      { count: 1000n, from: 1n, to: 1000n, interim: false },
      { count: 333n, from: 25001n, to: 25333n, interim: false },
    ]);
    expect(holding(r, H.bjorn, 'B')).toEqual([
      { count: 24000n, from: 1001n, to: 25000n, interim: false },
      { count: 8000n, from: 25334n, to: 33333n, interim: false },
    ]);
    expect(r.ledger.totalShares).toBe(33333n);
    expect(r.ledger.shareCapital).toBe(3125000n);

    const quota = tx(
      { type: 'bonus_issue', effectiveDate: '2024-07-01', registrationDate: '2024-07-01', mode: 'quota_value', capitalIncrease: '2500000' },
      2,
    );
    const q = ok(replay([incorporation(), quota], seConfig()));
    expect(registerView(q.ledger, seConfig(), '2024-07-01').quotaValue).toBe('2');
  });

  it('consolidates shares in a reverse split with buy-out or pooling of fractions', () => {
    const gift = tx(
      {
        type: 'transfer',
        effectiveDate: '2024-03-01',
        kind: 'gift',
        fromHolderId: H.bjorn,
        toHolderId: H.cecilia,
        holders: [people.cecilia, people.pool],
        lines: [{ classCode: 'B', count: 7 }],
      },
      2,
    );
    const rs = (over: object) =>
      tx({ type: 'reverse_split', effectiveDate: '2024-08-01', registrationDate: '2024-08-01', ratio: 10, fractions: 'round', ...over }, 3);
    const buyOut = ok(replay([incorporation(), gift, rs({ fractions: 'buy_out', buyOutPricePerShare: '2' })], seConfig()));
    expect(holding(buyOut, H.cecilia, 'B')).toEqual([]);
    expect(holding(buyOut, H.bjorn, 'B')).toEqual([{ count: 2399n, from: 101n, to: 2499n, interim: false }]);
    expect(buyOut.ledger.movements.filter((m) => m.consideration !== null && m.toHolderId === null).map((m) => m.consideration)).toEqual([
      1400n,
      600n,
    ]);

    const pooled = ok(replay([incorporation(), gift, rs({ fractions: 'pool', poolHolderId: H.pool })], seConfig()));
    expect(holding(pooled, H.pool, 'B')).toEqual([{ count: 1n, from: 2500n, to: 2500n, interim: false }]);
    expect(pooled.ledger.totalShares).toBe(2500n);

    const rounded = ok(replay([incorporation(), gift, rs({ rounding: 'nearest' })], seConfig()));
    expect(holding(rounded, H.cecilia, 'B')).toEqual([{ count: 1n, from: 101n, to: 101n, interim: false }]);
  });

  it('treats a gift to an estate and on to an heir as two transfers', () => {
    const toEstate = tx(
      {
        type: 'transfer',
        effectiveDate: '2025-01-10',
        kind: 'inheritance',
        fromHolderId: H.anna,
        toHolderId: H.estate,
        holders: [people.estate],
        lines: [{ classCode: 'A', count: 1000 }],
        restrictionSteps: { consent: { obtained: true } },
      },
      2,
    );
    const toHeir = tx(
      {
        type: 'transfer',
        effectiveDate: '2025-06-01',
        kind: 'division_of_property',
        fromHolderId: H.estate,
        toHolderId: H.cecilia,
        holders: [people.cecilia],
        lines: [{ classCode: 'A', count: 1000 }],
        restrictionSteps: { consent: { obtained: true } },
      },
      3,
    );
    const r = ok(replay([incorporation(), toEstate, toHeir], seConfig()));
    expect(holding(r, H.cecilia, 'A')).toEqual([{ count: 1000n, from: 1n, to: 1000n, interim: false }]);
    const mid = ok(replay([incorporation(), toEstate, toHeir], seConfig(), { until: '2025-03-01' }));
    expect(holding(mid, H.estate, 'A')).toHaveLength(1);
  });

  it('names the later transaction a backdated entry conflicts with', () => {
    const sale = tx(
      {
        type: 'transfer',
        effectiveDate: '2024-06-01',
        kind: 'sale',
        fromHolderId: H.bjorn,
        toHolderId: H.cecilia,
        holders: [people.cecilia],
        pricePerShare: '1',
        lines: [{ classCode: 'B', count: 20000 }],
      },
      2,
    );
    const backdatedGift = tx(
      {
        type: 'transfer',
        effectiveDate: '2024-03-01',
        kind: 'gift',
        fromHolderId: H.bjorn,
        toHolderId: H.anna,
        lines: [{ classCode: 'B', count: 5000 }],
      },
      3,
    );
    const r = replay([incorporation(), sale, backdatedGift], seConfig());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failedAt.id).toBe(sale.id);
    expect(!r.ok && r.errors[0]?.rule).toBe('INSUFFICIENT_SHARES');
  });

  it('checks share capital against nominal values in nominal mode', () => {
    const inc = tx(
      {
        type: 'incorporation',
        effectiveDate: '2024-01-01',
        shareCapital: '2500000',
        holders: [people.anna],
        classes: [{ code: 'Ordinary', nominalPerShare: '1' }],
        allocations: [{ holderId: H.anna, classCode: 'Ordinary', count: 25000 }],
      },
      1,
    );
    ok(replay([inc], euConfig()));
    const wrong = { ...inc, tx: { ...inc.tx, shareCapital: '2400000' } } as typeof inc;
    const r = replay([wrong], euConfig());
    expect(!r.ok && r.errors[0]?.rule).toBe('SHARE_CAPITAL');
  });
});
