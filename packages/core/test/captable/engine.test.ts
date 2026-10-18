import { pricedRoundStep } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { blackScholes } from '../../src/captable/fair-value.ts';
import { allocate, monthsBetween } from '../../src/captable/math.ts';
import { applyRound } from '../../src/captable/round.ts';
import { runScenario } from '../../src/captable/scenario.ts';
import { accrued, buildState, type CapClass, type CapData, type CapState, vestedUnits } from '../../src/captable/state.ts';
import { buildTable } from '../../src/captable/table.ts';
import { runWaterfall } from '../../src/captable/waterfall.ts';
import { DEC_SCALE, parseDec } from '../../src/registry/decimal.ts';
import { H, incorporation, seConfig } from '../registry/helpers.ts';

const F = '00000000-0000-4000-8000-000000000f01';
const I = '00000000-0000-4000-8000-000000000f02';
const E = '00000000-0000-4000-8000-000000000f03';
const S1 = '00000000-0000-4000-8000-000000000f04';
const PLAN = '00000000-0000-4000-8000-000000000f05';

function cls(code: string, over: Partial<CapClass> = {}): CapClass {
  return {
    code,
    name: code,
    votesPerShare: DEC_SCALE,
    unitsPerShare: 1n,
    seniorityRank: 0,
    liqPrefMultiple: 0n,
    liqPrefCapMultiple: null,
    participation: 'none',
    antiDilution: 'none',
    issuePrice: 0n,
    conversionPrice: 0n,
    ...over,
  };
}

function state(over: Partial<CapState> = {}): CapState {
  const s: CapState = {
    asOf: '2025-01-01',
    currency: 'EUR',
    digits: 2,
    capitalMode: 'quota',
    classes: new Map([['C', cls('C')]]),
    holdings: [{ stakeholderId: F, classCode: 'C', units: 9_000_000n }],
    awards: [],
    pools: [],
    unpriced: [],
    parties: new Map([
      [F, { id: F, name: 'Founder', kind: 'person', groupId: null, inRegister: true }],
      [I, { id: I, name: 'Investor', kind: 'company', groupId: null, inRegister: true }],
      [E, { id: E, name: 'Employee', kind: 'person', groupId: null, inRegister: false }],
      [S1, { id: S1, name: 'Angel', kind: 'person', groupId: null, inRegister: false }],
    ]),
    groups: [],
    lastRound: null,
    lastValuation: null,
    warnings: [],
    ...over,
  };
  return s;
}

const preferred = (over: Partial<CapClass> = {}) =>
  cls('P', { liqPrefMultiple: DEC_SCALE, issuePrice: DEC_SCALE, conversionPrice: DEC_SCALE, seniorityRank: 1, ...over });

const round = (input: Record<string, unknown>) => {
  const { kind: _kind, ...step } = pricedRoundStep.parse({ kind: 'priced_round', date: '2025-06-01', classCode: 'A', ...input });
  return step;
};

const eur = (major: number) => (BigInt(major) * 100n).toString();

describe('cap table maths', () => {
  it('splits amounts exactly with the largest remainder', () => {
    expect(allocate(10n, [1n, 1n, 1n])).toEqual([4n, 3n, 3n]);
    expect(allocate(100n, [0n, 0n])).toEqual([0n, 0n]);
  });

  it('vests monthly after a cliff', () => {
    const schedule = { cliffMonths: 12, totalMonths: 48, frequencyMonths: 1 };
    const g = { units: 4800n, vestingStart: '2024-01-15' };
    expect(monthsBetween('2024-01-15', '2025-01-14')).toBe(11);
    expect(vestedUnits(g, schedule, '2025-01-14')).toBe(0n);
    expect(vestedUnits(g, schedule, '2025-01-15')).toBe(1200n);
    expect(vestedUnits(g, schedule, '2025-07-15')).toBe(1800n);
    expect(vestedUnits(g, schedule, '2030-01-01')).toBe(4800n);
    expect(vestedUnits(g, { ...schedule, frequencyMonths: 3 }, '2025-06-15')).toBe(1500n);
  });

  it('accrues simple and compound interest', () => {
    const loan = { principal: 100_000n, interestRatePct: parseDec('10'), interest: 'simple' as const, signedOn: '2024-01-01' };
    expect(accrued(loan, '2024-12-31')).toBe(110_000n);
    expect(accrued({ ...loan, interest: 'compound' }, '2026-01-01')).toBe(121_033n);
  });

  it('prices Black-Scholes like the textbook', () => {
    const v = blackScholes({ share: 100, strike: 100, years: 1, volatility: 0.2, riskFree: 0.05, dividend: 0 });
    expect(v.value).toBeCloseTo(10.4506, 3);
  });
});

describe('cap table state', () => {
  const data = (over: Partial<CapData> = {}): CapData => ({
    currency: 'SEK',
    digits: 2,
    config: seConfig(),
    items: [incorporation()],
    settings: { includeUnallocatedPool: true },
    groups: [],
    stakeholders: [{ id: E, name: 'Employee', kind: 'person', groupId: null }],
    schedules: [{ id: 's', cliffMonths: 12, totalMonths: 48, frequencyMonths: 1, acceleration: 'none' }],
    plans: [{ id: PLAN, name: 'Option Plan', kind: 'option', classCode: 'B' }],
    poolChanges: [{ planId: PLAN, date: '2024-02-01', delta: 5000n }],
    grants: [
      {
        id: 'g1',
        planId: PLAN,
        stakeholderId: E,
        units: 1000n,
        strikePrice: '1',
        grantDate: '2024-02-01',
        vestingStart: '2024-02-01',
        scheduleId: 's',
        terminatedOn: null,
        leaver: null,
      },
    ],
    exercises: [],
    unpriced: [],
    valuations: [],
    ...over,
  });

  it('combines the register with grants and the pool', () => {
    const s = buildState(data(), '2025-02-01');
    expect(s.holdings.map((h) => [h.stakeholderId, h.classCode, h.units])).toEqual([
      [H.anna, 'A', 1000n],
      [H.bjorn, 'B', 24000n],
    ]);
    expect(s.awards[0]).toMatchObject({ outstanding: 1000n, vested: 250n });
    expect(s.pools[0]).toMatchObject({ size: 5000n, used: 1000n });
    const t = buildTable(s, { includePool: true, view: 'fully_diluted' });
    expect(t.totals.fullyDiluted).toBe('30000');
    expect(t.rows.find((r) => r.stakeholderId === E)?.fullyDilutedPct).toBe('3.333333');
    expect(t.rows.at(-1)).toMatchObject({ planId: PLAN, fullyDiluted: '4000' });
    expect(buildTable(s, { includePool: true, view: 'issued' }).totals.fullyDiluted).toBe('25000');
  });

  it('keeps only the vested part for a good leaver and nothing for a bad one', () => {
    const terminated = (leaver: 'good' | 'bad') =>
      buildState(data({ grants: data().grants.map((g) => ({ ...g, terminatedOn: '2025-08-01', leaver })) }), '2026-01-01');
    expect(terminated('good').awards[0]).toMatchObject({ outstanding: 375n, vested: 375n });
    expect(terminated('good').pools[0]?.used).toBe(375n);
    expect(terminated('bad').awards).toEqual([]);
  });

  it('counts an exercise only once its register transaction is committed', () => {
    const exercises = [{ grantId: 'g1', date: '2025-03-01', units: 200n, registryTxId: 'not-committed' }];
    expect(buildState(data({ exercises }), '2025-06-01').awards[0]?.outstanding).toBe(1000n);
    const committed = data({ exercises: [{ ...exercises[0]!, registryTxId: incorporation().id }] });
    expect(buildState(committed, '2025-06-01').awards[0]).toMatchObject({ outstanding: 800n });
  });
});

describe('priced rounds', () => {
  it('prices a round from the pre-money valuation on the fully diluted count', () => {
    const s = state({ pools: [{ planId: PLAN, name: 'Plan', kind: 'option', classCode: 'C', size: 1_000_000n, used: 0n }] });
    const r = applyRound(s, round({ preMoney: eur(10_000_000), investments: [{ stakeholderId: I, amount: eur(2_500_000) }] }), []);
    expect(r.pricePerShare).toBe('1');
    expect(r.investments[0]?.units).toBe('2500000');
    expect(r.postMoney).toBe(eur(12_500_000));
    expect(r.postFullyDiluted).toBe('12500000');
  });

  it('converts a post-money SAFE so it owns its share of the capitalization at the cap', () => {
    const s = state({
      holdings: [{ stakeholderId: F, classCode: 'C', units: 10_000_000n }],
      unpriced: [
        {
          id: 'safe',
          stakeholderId: S1,
          profile: 'safe_post',
          kind: 'safe',
          principal: BigInt(eur(1_000_000)),
          valuationCap: BigInt(eur(10_000_000)),
          discountPct: 0n,
          interestRatePct: 0n,
          interest: 'simple',
          postMoney: true,
          mfn: false,
          signedOn: '2024-06-01',
          maturityDate: null,
        },
      ],
    });
    const r = applyRound(s, round({ preMoney: eur(20_000_000), investments: [{ stakeholderId: I, amount: eur(5_000_000) }] }), []);
    const safe = r.conversions[0]!;
    expect(safe.basis).toBe('cap');
    const units = Number(safe.units);
    expect(Math.abs(units - 1_111_111)).toBeLessThan(3);
    expect(Number(r.pricePerShare)).toBeCloseTo(1.8, 4);
    expect(s.unpriced).toEqual([]);
  });

  it('uses the discount when it beats the cap', () => {
    const s = state({
      holdings: [{ stakeholderId: F, classCode: 'C', units: 10_000_000n }],
      unpriced: [
        {
          id: 'note',
          stakeholderId: S1,
          profile: 'convertible_loan',
          kind: 'note',
          principal: BigInt(eur(100_000)),
          valuationCap: BigInt(eur(50_000_000)),
          discountPct: parseDec('20'),
          interestRatePct: 0n,
          interest: 'simple',
          postMoney: false,
          mfn: false,
          signedOn: '2024-06-01',
          maturityDate: null,
        },
      ],
    });
    const r = applyRound(s, round({ pricePerShare: '2', investments: [{ stakeholderId: I, amount: eur(1_000_000) }] }), []);
    expect(r.conversions[0]).toMatchObject({ basis: 'discount', pricePerShare: '1.6', units: '62500' });
  });

  it('tops up the pool to its post-money target inside the pre-money', () => {
    const s = state({ pools: [{ planId: PLAN, name: 'Plan', kind: 'option', classCode: 'C', size: 0n, used: 0n }] });
    const r = applyRound(
      s,
      round({ preMoney: eur(9_000_000), poolTargetPct: 10, investments: [{ stakeholderId: I, amount: eur(1_000_000) }] }),
      [],
    );
    expect(Number(r.pool!.pctAfter)).toBeCloseTo(10, 3);
    expect(Number(r.investments[0]!.units) / Number(r.postFullyDiluted)).toBeCloseTo(0.1, 4);
  });

  it('shows what a holder must buy to keep their percentage', () => {
    const s = state({
      holdings: [
        { stakeholderId: F, classCode: 'C', units: 8_000_000n },
        { stakeholderId: I, classCode: 'C', units: 2_000_000n },
      ],
    });
    const r = applyRound(
      s,
      round({ pricePerShare: '1', proRataIds: [I], investments: [{ stakeholderId: S1, amount: eur(2_500_000) }] }),
      [],
    );
    const p = r.proRata[0]!;
    expect(p.pctBefore).toBe('20');
    expect(Number(p.unitsToKeep)).toBe(625_000);
  });

  it('applies full-ratchet protection in a down round', () => {
    const s = state({
      classes: new Map([
        ['C', cls('C')],
        ['P', preferred({ antiDilution: 'full_ratchet', issuePrice: parseDec('2'), conversionPrice: parseDec('2') })],
      ]),
    });
    applyRound(s, round({ pricePerShare: '1', investments: [{ stakeholderId: I, amount: eur(100_000) }] }), []);
    expect(s.classes.get('P')!.conversionPrice).toBe(DEC_SCALE);
  });
});

describe('exit waterfall', () => {
  const twoClasses = (pref: Partial<CapClass> = {}) =>
    state({
      classes: new Map([
        ['C', cls('C')],
        ['P', preferred(pref)],
      ]),
      holdings: [
        { stakeholderId: F, classCode: 'C', units: 1_000_000n },
        { stakeholderId: I, classCode: 'P', units: 1_000_000n },
      ],
    });
  const exit = (s: CapState, major: number, over: Record<string, unknown> = {}) =>
    runWaterfall(s, { exitValue: eur(major), transactionCosts: '0', debt: '0', unvested: 'cancel', ...over });
  const paid = (w: ReturnType<typeof runWaterfall>, id: string) => Number(w.rows.find((r) => r.stakeholderId === id)?.total ?? 0) / 100;

  it('pays a non-participating preference first and converts when common is worth more', () => {
    const low = exit(twoClasses(), 1_500_000);
    expect(paid(low, I)).toBe(1_000_000);
    expect(paid(low, F)).toBe(500_000);
    const high = exit(twoClasses(), 10_000_000);
    expect(high.classes.find((c) => c.code === 'P')?.converts).toBe(true);
    expect(paid(high, I)).toBe(5_000_000);
  });

  it('lets participating preferred take its preference and its share', () => {
    const w = exit(twoClasses({ participation: 'full' }), 1_500_000);
    expect(paid(w, I)).toBe(1_250_000);
    expect(paid(w, F)).toBe(250_000);
  });

  it('caps participation and converts above the cap', () => {
    const capped = { participation: 'capped' as const, liqPrefCapMultiple: 2n * DEC_SCALE };
    expect(paid(exit(twoClasses(capped), 3_000_000), I)).toBe(2_000_000);
    expect(paid(exit(twoClasses(capped), 10_000_000), I)).toBe(5_000_000);
  });

  it('pays options their spread over the strike', () => {
    const s = state({
      holdings: [{ stakeholderId: F, classCode: 'C', units: 900_000n }],
      awards: [
        {
          id: 'g',
          planId: PLAN,
          stakeholderId: E,
          kind: 'option',
          classCode: 'C',
          outstanding: 100_000n,
          vested: 100_000n,
          strike: DEC_SCALE,
          acceleration: 'none',
        },
      ],
    });
    const w = exit(s, 2_000_000);
    expect(w.commonPrice).toBe('2.1');
    expect(paid(w, F)).toBe(1_890_000);
    expect(paid(w, E)).toBe(110_000);
    const underwater = exit(s, 500_000);
    expect(paid(underwater, E)).toBe(0);
    expect(paid(underwater, F)).toBe(500_000);
  });

  it('pays the more senior preference first', () => {
    const s = state({
      classes: new Map([
        ['C', cls('C')],
        ['P', preferred()],
        ['Q', preferred({ code: 'Q', seniorityRank: 2 })],
      ]),
      holdings: [
        { stakeholderId: F, classCode: 'C', units: 1_000_000n },
        { stakeholderId: I, classCode: 'P', units: 1_000_000n },
        { stakeholderId: S1, classCode: 'Q', units: 1_000_000n },
      ],
    });
    const w = exit(s, 1_200_000);
    expect(paid(w, S1)).toBe(1_000_000);
    expect(paid(w, I)).toBe(200_000);
    expect(paid(w, F)).toBe(0);
  });

  it('distributes every minor unit of the proceeds', () => {
    const w = exit(twoClasses({ participation: 'full' }), 1_234_567, { transactionCosts: '3333' });
    const total = w.rows.reduce((s, r) => s + BigInt(r.total), 0n);
    expect(total).toBe(BigInt(w.distributable));
  });
});

describe('scenarios', () => {
  it('runs steps on a copy and leaves the base alone', () => {
    const base = state({ pools: [{ planId: PLAN, name: 'Plan', kind: 'option', classCode: 'C', size: 1_000_000n, used: 0n }] });
    const run = runScenario(
      base,
      [
        { kind: 'grant_batch', planId: PLAN, grants: [{ stakeholderId: E, units: '100000', strikePrice: '0.5' }] },
        round({
          preMoney: eur(10_000_000),
          investments: [{ newInvestor: { name: 'Fund', kind: 'company', country: 'DE', email: '' }, amount: eur(2_000_000) }],
        }) as never,
        { kind: 'exit', exitValue: eur(50_000_000), transactionCosts: '0', debt: '0', unvested: 'accelerate' },
      ].map((s, i) => (i === 1 ? { kind: 'priced_round', ...(s as object) } : s)) as never,
      true,
    );
    expect(base.holdings).toHaveLength(1);
    expect(run.end.rows.some((r) => r.name === 'Fund')).toBe(true);
    const w = run.steps[2]!.result;
    expect(w.kind).toBe('exit');
    if (w.kind === 'exit') expect(w.waterfall.rows.find((r) => r.stakeholderId === E)?.total).not.toBe('0');
  });
});
