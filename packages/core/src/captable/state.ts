import type { AntiDilution, HolderKind, Participation, PlanKind, UnpricedKind } from '@openinc/shared';
import { DEC_SCALE, parseDec } from '../registry/decimal.ts';
import { type EngineConfig, Ledger, type LedgerTx, sortForReplay } from '../registry/engine.ts';
import { ceilDiv, daysBetween, HUNDRED, minDate, monthsBetween } from './math.ts';

/**
 * The cap table as of one date: a pure function of the register's committed transactions and the
 * cap table's own rows. Scenarios start from this and change a copy.
 */

export interface CapClass {
  code: string;
  name: string;
  /** Scaled. */
  votesPerShare: bigint;
  /** 1 in quota mode; the whole-unit nominal amount of one share in nominal mode (GmbH-style capital). */
  unitsPerShare: bigint;
  seniorityRank: number;
  /** Scaled multiples. */
  liqPrefMultiple: bigint;
  liqPrefCapMultiple: bigint | null;
  participation: Participation;
  antiDilution: AntiDilution;
  /** Scaled major units per unit; 0 when the register holds no issue price for the class. */
  issuePrice: bigint;
  /** After anti-dilution adjustments. Each unit converts into issuePrice / conversionPrice common units. */
  conversionPrice: bigint;
}

export interface Holding {
  stakeholderId: string;
  classCode: string;
  units: bigint;
}

export interface Award {
  id: string;
  planId: string;
  stakeholderId: string;
  kind: PlanKind;
  classCode: string;
  /** Granted, not exercised, not forfeited. */
  outstanding: bigint;
  /** Of the outstanding units, those vested by the date. */
  vested: bigint;
  /** Scaled major units per unit. */
  strike: bigint;
  acceleration: 'none' | 'single' | 'double';
}

export interface Pool {
  planId: string;
  name: string;
  kind: PlanKind;
  classCode: string;
  size: bigint;
  /** Granted less forfeited: exercised units stay used. */
  used: bigint;
}

export interface UnpricedHolding {
  id: string;
  stakeholderId: string;
  profile: string;
  kind: UnpricedKind;
  /** Minor units. */
  principal: bigint;
  valuationCap: bigint | null;
  /** Scaled percentages. */
  discountPct: bigint;
  interestRatePct: bigint;
  interest: 'simple' | 'compound';
  postMoney: boolean;
  mfn: boolean;
  signedOn: string;
  maturityDate: string | null;
}

export interface Party {
  id: string;
  name: string;
  kind: HolderKind;
  groupId: string | null;
  inRegister: boolean;
}

export interface Group {
  id: string;
  name: string;
  color: string;
}

export interface CapState {
  asOf: string;
  currency: string;
  digits: number;
  capitalMode: 'quota' | 'nominal';
  classes: Map<string, CapClass>;
  holdings: Holding[];
  awards: Award[];
  pools: Pool[];
  unpriced: UnpricedHolding[];
  parties: Map<string, Party>;
  groups: Group[];
  /** The last priced issue in the register: scaled price per unit and its date. */
  lastRound: { price: bigint; date: string; classCode: string } | null;
  lastValuation: { price: bigint; date: string; source: string } | null;
  warnings: string[];
}

export interface CapRows {
  settings: { includeUnallocatedPool: boolean };
  groups: Group[];
  stakeholders: { id: string; name: string; kind: HolderKind; groupId: string | null }[];
  schedules: {
    id: string;
    name?: string;
    cliffMonths: number;
    totalMonths: number;
    frequencyMonths: number;
    acceleration: 'none' | 'single' | 'double';
  }[];
  plans: { id: string; name: string; kind: PlanKind; classCode: string }[];
  poolChanges: { planId: string; date: string; delta: bigint }[];
  grants: {
    id: string;
    planId: string;
    stakeholderId: string;
    units: bigint;
    strikePrice: string;
    grantDate: string;
    vestingStart: string;
    scheduleId: string | null;
    terminatedOn: string | null;
    leaver: 'good' | 'bad' | null;
  }[];
  exercises: { grantId: string; date: string; units: bigint; registryTxId: string | null }[];
  unpriced: {
    id: string;
    stakeholderId: string;
    profile: string;
    kind: UnpricedKind;
    amount: bigint;
    valuationCap: bigint | null;
    discountPct: string;
    interestRatePct: string;
    interest: 'simple' | 'compound';
    postMoney: boolean;
    mfn: boolean;
    signedOn: string;
    maturityDate: string | null;
    conversionTxId: string | null;
    cancelledOn: string | null;
  }[];
  valuations: { date: string; pricePerShare: string; source: string }[];
}

export interface CapData extends CapRows {
  currency: string;
  digits: number;
  /** Null until the share register is set up. */
  config: EngineConfig | null;
  /** Committed, unreversed register transactions. */
  items: LedgerTx[];
}

export function vestedUnits(
  grant: { units: bigint; vestingStart: string },
  schedule: { cliffMonths: number; totalMonths: number; frequencyMonths: number } | null,
  date: string,
): bigint {
  if (!schedule) return grant.units;
  if (date < grant.vestingStart) return 0n;
  const months = monthsBetween(grant.vestingStart, date);
  if (months < schedule.cliffMonths) return 0n;
  if (months >= schedule.totalMonths) return grant.units;
  const steps = Math.floor(months / schedule.frequencyMonths) * schedule.frequencyMonths;
  return (grant.units * BigInt(steps)) / BigInt(schedule.totalMonths);
}

/** Principal plus interest accrued to a date, in minor units. */
export function accrued(u: Pick<UnpricedHolding, 'principal' | 'interestRatePct' | 'interest' | 'signedOn'>, date: string): bigint {
  if (u.interestRatePct === 0n || date <= u.signedOn) return u.principal;
  const days = BigInt(daysBetween(u.signedOn, date));
  if (u.interest === 'simple') return u.principal + (u.principal * u.interestRatePct * days) / (HUNDRED * 365n);
  const years = days / 365n;
  let amount = u.principal;
  for (let i = 0n; i < years; i++) amount += (amount * u.interestRatePct) / HUNDRED;
  return amount + (amount * u.interestRatePct * (days % 365n)) / (HUNDRED * 365n);
}

function unitsPerShare(config: EngineConfig, nominal: bigint | null): bigint {
  if (config.settings.capitalMode !== 'nominal' || nominal === null) return 1n;
  const whole = nominal / DEC_SCALE;
  return whole > 0n ? whole : 1n;
}

function isEffective(txId: string | null, date: string, committed: Map<string, string>, fallbackDate: string): boolean {
  if (!txId) return fallbackDate <= date;
  const effective = committed.get(txId);
  return effective !== undefined && effective <= date;
}

interface AntiDilutionState {
  issuePrice: bigint;
  conversionPrice: bigint;
}

/** Walks the register in effective order to find each class's issue price and anti-dilution adjustments. */
function priceHistory(data: CapData, asOf: string) {
  const config = data.config!;
  const ledger = new Ledger(config);
  const prices = new Map<string, AntiDilutionState>();
  let lastRound: CapState['lastRound'] = null;
  const unitsOf = (code: string) => {
    const c = ledger.classes.get(code);
    return c ? c.issued * unitsPerShare(config, c.nominal) : 0n;
  };
  const totalUnits = () => [...ledger.classes.keys()].reduce((s, code) => s + unitsOf(code), 0n);

  for (const item of sortForReplay(data.items)) {
    if (item.tx.effectiveDate > asOf) break;
    const tx = item.tx;
    const before = { total: totalUnits(), byClass: new Map([...ledger.classes.keys()].map((c) => [c, unitsOf(c)])) };
    ledger.apply(item);
    const perUnit = (code: string, price: string) => {
      const c = ledger.classes.get(code);
      return parseDec(price) / unitsPerShare(config, c?.nominal ?? null);
    };
    if (tx.type === 'incorporation') {
      for (const a of tx.allocations)
        if (a.pricePerShare !== undefined && !prices.has(a.classCode)) {
          const p = perUnit(a.classCode, String(a.pricePerShare));
          prices.set(a.classCode, { issuePrice: p, conversionPrice: p });
        }
    } else if (tx.type === 'new_issue') {
      const price = perUnit(tx.classCode, String(tx.pricePerShare));
      const added = unitsOf(tx.classCode) - (before.byClass.get(tx.classCode) ?? 0n);
      for (const [code, state] of prices) {
        if (code === tx.classCode || price >= state.conversionPrice) continue;
        const def = ledger.classes.get(code)?.def;
        if (!def || def.antiDilution === 'none') continue;
        if (def.antiDilution === 'full_ratchet') state.conversionPrice = price;
        else {
          const a = def.antiDilution === 'broad_weighted_average' ? before.total : (before.byClass.get(code) ?? 0n);
          const b = (added * price) / state.conversionPrice;
          if (a + added > 0n) state.conversionPrice = (state.conversionPrice * (a + b)) / (a + added);
        }
      }
      if (!prices.has(tx.classCode)) prices.set(tx.classCode, { issuePrice: price, conversionPrice: price });
      if (price > 0n) lastRound = { price, date: tx.effectiveDate, classCode: tx.classCode };
    } else if (tx.type === 'split' || tx.type === 'reverse_split') {
      const r = BigInt(tx.ratio);
      for (const state of prices.values()) {
        state.issuePrice = tx.type === 'split' ? state.issuePrice / r : state.issuePrice * r;
        state.conversionPrice = tx.type === 'split' ? state.conversionPrice / r : state.conversionPrice * r;
      }
      const round = lastRound as CapState['lastRound'];
      if (round) lastRound = { ...round, price: tx.type === 'split' ? round.price / r : round.price * r };
    } else if (tx.type === 'bonus_issue' && tx.mode === 'new_shares' && before.total > 0n) {
      const after = totalUnits();
      for (const state of prices.values()) {
        state.issuePrice = (state.issuePrice * before.total) / after;
        state.conversionPrice = (state.conversionPrice * before.total) / after;
      }
    }
  }
  return { ledger, prices, lastRound };
}

export function buildState(data: CapData, asOf: string): CapState {
  const warnings: string[] = [];
  const parties = new Map<string, Party>();
  const classes = new Map<string, CapClass>();
  const holdings: Holding[] = [];
  let lastRound: CapState['lastRound'] = null;
  const committed = new Map(data.items.map((i) => [i.id, i.tx.effectiveDate]));

  if (data.config) {
    const history = priceHistory(data, asOf);
    lastRound = history.lastRound;
    const { ledger } = history;
    for (const [code, c] of ledger.classes) {
      const price = history.prices.get(code);
      const liqPrefMultiple = parseDec(String(c.def.liqPrefMultiple));
      classes.set(code, {
        code,
        name: c.def.name,
        votesPerShare: parseDec(String(c.def.votesPerShare)),
        unitsPerShare: unitsPerShare(data.config, c.nominal),
        seniorityRank: c.def.seniorityRank,
        liqPrefMultiple,
        liqPrefCapMultiple: c.def.liqPrefCapMultiple === null ? null : parseDec(String(c.def.liqPrefCapMultiple)),
        participation: c.def.participation,
        antiDilution: c.def.antiDilution,
        issuePrice: price?.issuePrice ?? 0n,
        conversionPrice: price?.conversionPrice ?? price?.issuePrice ?? 0n,
      });
      if (liqPrefMultiple > 0n && !price && c.issued > 0n && ledger.classes.size > 1)
        warnings.push(`The register holds no issue price for class ${code}, so its liquidation preference counts as zero.`);
    }
    const byKey = new Map<string, Holding>();
    for (const lot of ledger.open) {
      const key = `${lot.holderId}|${lot.classCode}`;
      const units = lot.count * (classes.get(lot.classCode)?.unitsPerShare ?? 1n);
      const h = byKey.get(key);
      if (h) h.units += units;
      else byKey.set(key, { stakeholderId: lot.holderId, classCode: lot.classCode, units });
    }
    holdings.push(...byKey.values());
    for (const [id, d] of ledger.holders) parties.set(id, { id, name: d.name, kind: d.kind, groupId: null, inRegister: true });
  }

  for (const s of data.stakeholders) {
    const existing = parties.get(s.id);
    if (existing) existing.groupId = s.groupId;
    else parties.set(s.id, { id: s.id, name: s.name, kind: s.kind, groupId: s.groupId, inRegister: false });
  }

  const schedules = new Map(data.schedules.map((s) => [s.id, s]));
  const planById = new Map(data.plans.map((p) => [p.id, p]));
  const awards: Award[] = [];
  const used = new Map<string, bigint>();
  for (const g of data.grants) {
    if (g.grantDate > asOf) continue;
    const plan = planById.get(g.planId);
    if (!plan) continue;
    const schedule = g.scheduleId ? (schedules.get(g.scheduleId) ?? null) : null;
    const exercised = data.exercises
      .filter((e) => e.grantId === g.id && isEffective(e.registryTxId, asOf, committed, e.date))
      .reduce((s, e) => s + e.units, 0n);
    const terminated = g.terminatedOn !== null && g.terminatedOn <= asOf;
    const vestDate = terminated ? minDate(asOf, g.terminatedOn!) : asOf;
    const vestedTotal = vestedUnits(g, schedule, vestDate);
    const keep = terminated ? (g.leaver === 'bad' ? exercised : vestedTotal > exercised ? vestedTotal : exercised) : g.units;
    const forfeited = g.units - keep;
    const outstanding = keep - exercised;
    const vested = (vestedTotal > exercised ? vestedTotal - exercised : 0n) < outstanding ? vestedTotal - exercised : outstanding;
    used.set(g.planId, (used.get(g.planId) ?? 0n) + g.units - forfeited);
    if (outstanding > 0n)
      awards.push({
        id: g.id,
        planId: g.planId,
        stakeholderId: g.stakeholderId,
        kind: plan.kind,
        classCode: plan.classCode,
        outstanding,
        vested: vested > 0n ? vested : 0n,
        strike: parseDec(g.strikePrice),
        acceleration: schedule?.acceleration ?? 'none',
      });
  }

  const pools: Pool[] = data.plans.map((p) => ({
    planId: p.id,
    name: p.name,
    kind: p.kind,
    classCode: p.classCode,
    size: data.poolChanges.filter((c) => c.planId === p.id && c.date <= asOf).reduce((s, c) => s + c.delta, 0n),
    used: used.get(p.id) ?? 0n,
  }));
  for (const p of pools) if (p.used > p.size) warnings.push(`${p.name} has granted ${p.used - p.size} more than its pool.`);

  const unpriced: UnpricedHolding[] = data.unpriced
    .filter(
      (u) =>
        u.signedOn <= asOf &&
        !(u.cancelledOn && u.cancelledOn <= asOf) &&
        !(u.conversionTxId && isEffective(u.conversionTxId, asOf, committed, '9999-12-31')),
    )
    .map((u) => ({
      id: u.id,
      stakeholderId: u.stakeholderId,
      profile: u.profile,
      kind: u.kind,
      principal: u.amount,
      valuationCap: u.valuationCap,
      discountPct: parseDec(u.discountPct),
      interestRatePct: parseDec(u.interestRatePct),
      interest: u.interest,
      postMoney: u.postMoney,
      mfn: u.mfn,
      signedOn: u.signedOn,
      maturityDate: u.maturityDate,
    }));

  const valuation = data.valuations.filter((v) => v.date <= asOf).sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  return {
    asOf,
    currency: data.currency,
    digits: data.digits,
    capitalMode: data.config?.settings.capitalMode ?? 'quota',
    classes,
    holdings,
    awards,
    pools,
    unpriced,
    parties,
    groups: data.groups,
    lastRound,
    lastValuation: valuation ? { price: parseDec(valuation.pricePerShare), date: valuation.date, source: valuation.source } : null,
    warnings,
  };
}

export function cloneState(s: CapState): CapState {
  return {
    ...s,
    classes: new Map([...s.classes].map(([k, v]) => [k, { ...v }])),
    holdings: s.holdings.map((h) => ({ ...h })),
    awards: s.awards.map((a) => ({ ...a })),
    pools: s.pools.map((p) => ({ ...p })),
    unpriced: s.unpriced.map((u) => ({ ...u })),
    parties: new Map([...s.parties].map(([k, v]) => [k, { ...v }])),
    warnings: [...s.warnings],
  };
}

/** Common units one unit of the class converts into, scaled. */
export function conversionRatio(c: CapClass): bigint {
  if (c.issuePrice === 0n || c.conversionPrice === 0n) return DEC_SCALE;
  return (c.issuePrice * DEC_SCALE) / c.conversionPrice;
}

export function asConverted(c: CapClass | undefined, units: bigint): bigint {
  if (!c) return units;
  return (units * conversionRatio(c)) / DEC_SCALE;
}

export const unallocated = (p: Pool) => (p.size > p.used ? p.size - p.used : 0n);

/** The price the cap table values shares at: the later of the last priced round and the last valuation. */
export function currentPrice(s: CapState): { price: bigint; date: string; source: string } | null {
  const round = s.lastRound ? { price: s.lastRound.price, date: s.lastRound.date, source: 'round' } : null;
  if (!round) return s.lastValuation;
  if (!s.lastValuation) return round;
  return s.lastValuation.date > round.date ? s.lastValuation : round;
}

export { ceilDiv };
