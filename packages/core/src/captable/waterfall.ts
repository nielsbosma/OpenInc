import type { ExitStep } from '@openinc/shared';
import { DEC_SCALE, formatDec } from '../registry/decimal.ts';
import { allocate, amountAt, max, min, pctOf, pow10, sum } from './math.ts';
import { asConverted, type CapState } from './state.ts';

interface Claim {
  stakeholderId: string;
  /** Class code, or the plan's id for awards. */
  source: string;
  units: bigint;
  strike: bigint;
  /** Minor units the claim may still take; null for no cap. */
  cap: bigint | null;
}

export interface WaterfallRow {
  stakeholderId: string;
  name: string;
  groupId: string | null;
  preference: string;
  participation: string;
  total: string;
  pct: string;
  invested: string;
}

export interface Waterfall {
  exitValue: string;
  transactionCosts: string;
  debt: string;
  distributable: string;
  /** Scaled major units one common unit receives. */
  commonPrice: string;
  classes: { code: string; preference: string; participation: string; converts: boolean }[];
  awards: { paid: string; cancelled: string };
  rows: WaterfallRow[];
}

export type ExitTerms = Omit<ExitStep, 'kind'>;

function payoutAt(claims: Claim[], price: bigint, digits: number): bigint[] {
  return claims.map((c) => {
    if (price <= c.strike) return 0n;
    const v = amountAt(c.units, price - c.strike, digits);
    return c.cap === null ? v : min(v, c.cap);
  });
}

/** The highest common price whose payouts fit in `pot`, by bisection: payouts only grow with the price. */
function solvePrice(claims: Claim[], pot: bigint, digits: number): bigint {
  if (pot <= 0n || claims.length === 0) return 0n;
  const smallest = claims.reduce((m, c) => (c.units > 0n && (m === 0n || c.units < m) ? c.units : m), 0n);
  if (smallest === 0n) return 0n;
  let lo = 0n;
  let hi = (pot * DEC_SCALE) / (smallest * pow10(digits)) + maxOf(...claims.map((c) => c.strike)) + 1n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (sum(payoutAt(claims, mid, digits)) <= pot) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

function maxOf(...xs: bigint[]) {
  return xs.reduce((a, b) => (b > a ? b : a), 0n);
}

/** The exit maths as one pass for a set of converting classes. */
function distribute(s: CapState, net: bigint, converting: Set<string>, unvested: ExitTerms['unvested']) {
  const digits = s.digits;
  const classes = [...s.classes.values()];
  const holdingsBy = (code: string) => s.holdings.filter((h) => h.classCode === code && h.units > 0n);
  const preference = new Map<string, bigint>();
  const prefPaid = new Map<string, bigint>();
  const prefByHolder = new Map<string, bigint>();
  let left = net;

  const preferred = classes.filter((c) => c.liqPrefMultiple > 0n && c.issuePrice > 0n && !converting.has(c.code));
  const ranks = [...new Set(preferred.map((c) => c.seniorityRank))].sort((a, b) => b - a);
  for (const rank of ranks) {
    const lines = preferred
      .filter((c) => c.seniorityRank === rank)
      .flatMap((c) =>
        holdingsBy(c.code).map((h) => ({ c, h, owed: amountAt(h.units, (c.issuePrice * c.liqPrefMultiple) / DEC_SCALE, digits) })),
      );
    const owed = sum(lines.map((l) => l.owed));
    const paid =
      owed <= left
        ? lines.map((l) => l.owed)
        : allocate(
            left,
            lines.map((l) => l.owed),
          );
    lines.forEach((l, i) => {
      preference.set(l.c.code, (preference.get(l.c.code) ?? 0n) + paid[i]!);
      prefPaid.set(`${l.h.stakeholderId}|${l.c.code}`, paid[i]!);
      prefByHolder.set(l.h.stakeholderId, (prefByHolder.get(l.h.stakeholderId) ?? 0n) + paid[i]!);
    });
    left -= sum(paid);
  }

  const claims: Claim[] = [];
  for (const c of classes) {
    const prefers = c.liqPrefMultiple > 0n && c.issuePrice > 0n && !converting.has(c.code);
    if (prefers && c.participation === 'none') continue;
    for (const h of holdingsBy(c.code)) {
      let cap: bigint | null = null;
      if (prefers && c.participation === 'capped' && c.liqPrefCapMultiple !== null)
        cap = max(
          0n,
          amountAt(h.units, (c.issuePrice * c.liqPrefCapMultiple) / DEC_SCALE, digits) -
            (prefPaid.get(`${h.stakeholderId}|${c.code}`) ?? 0n),
        );
      claims.push({ stakeholderId: h.stakeholderId, source: c.code, units: asConverted(c, h.units), strike: 0n, cap });
    }
  }
  let cancelled = 0n;
  for (const a of s.awards) {
    const units = unvested === 'accelerate' || a.acceleration === 'single' ? a.outstanding : a.vested;
    cancelled += a.outstanding - units;
    const c = s.classes.get(a.classCode);
    if (units > 0n)
      claims.push({
        stakeholderId: a.stakeholderId,
        source: a.planId,
        units: c ? asConverted(c, units) : units,
        strike: a.strike,
        cap: null,
      });
  }

  const price = solvePrice(claims, left, digits);
  const raw = payoutAt(claims, price, digits);
  // Rounding leaves a few minor units; they go to the claims in proportion so nothing is lost.
  const rest = left - sum(raw);
  const extra =
    rest > 0n && sum(raw) > 0n
      ? allocate(
          rest,
          raw.map((v, i) => (claims[i]!.cap !== null && v >= claims[i]!.cap! ? 0n : v)),
        )
      : raw.map(() => 0n);
  const paid = raw.map((v, i) => v + extra[i]!);
  return { price, preference, prefByHolder, claims, paid, cancelled, undistributed: left - sum(paid) };
}

export function runWaterfall(s: CapState, terms: ExitTerms): Waterfall {
  const exitValue = BigInt(terms.exitValue);
  const costs = BigInt(terms.transactionCosts);
  const debt = BigInt(terms.debt);
  const net = max(0n, exitValue - costs - debt);

  // Non-participating and capped preferred convert to common when that pays more; each round converts the
  // class that gains the most, until no class gains.
  const converting = new Set<string>();
  let result = distribute(s, net, converting, terms.unvested);
  for (;;) {
    const holderTotal = (r: typeof result, code: string) =>
      sum(r.claims.map((c, i) => (c.source === code ? r.paid[i]! : 0n))) + (r.preference.get(code) ?? 0n);
    let best: { code: string; gain: bigint; r: typeof result } | null = null;
    for (const c of s.classes.values()) {
      if (converting.has(c.code) || c.liqPrefMultiple === 0n || c.participation === 'full') continue;
      const trial = distribute(s, net, new Set([...converting, c.code]), terms.unvested);
      const gain = holderTotal(trial, c.code) - holderTotal(result, c.code);
      if (gain > 0n && (!best || gain > best.gain)) best = { code: c.code, gain, r: trial };
    }
    if (!best) break;
    converting.add(best.code);
    result = best.r;
  }

  const rows = new Map<string, { preference: bigint; participation: bigint; invested: bigint }>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { preference: 0n, participation: 0n, invested: 0n };
      rows.set(id, r);
    }
    return r;
  };
  for (const [id, v] of result.prefByHolder) row(id).preference += v;
  result.claims.forEach((c, i) => {
    row(c.stakeholderId).participation += result.paid[i]!;
  });
  for (const h of s.holdings) {
    const c = s.classes.get(h.classCode);
    if (c && h.units > 0n) row(h.stakeholderId).invested += amountAt(h.units, c.issuePrice, s.digits);
  }

  const awardsPaid = sum(result.claims.map((c, i) => (s.classes.has(c.source) ? 0n : result.paid[i]!)));
  const out: WaterfallRow[] = [...rows]
    .map(([id, r]) => {
      const total = r.preference + r.participation;
      const p = s.parties.get(id);
      return {
        stakeholderId: id,
        name: p?.name ?? 'Unknown',
        groupId: p?.groupId ?? null,
        preference: r.preference.toString(),
        participation: r.participation.toString(),
        total: total.toString(),
        pct: formatDec(pctOf(total, net), 6),
        invested: r.invested.toString(),
      };
    })
    .filter((r) => r.total !== '0' || r.invested !== '0')
    .sort((a, b) => (BigInt(b.total) > BigInt(a.total) ? 1 : BigInt(b.total) < BigInt(a.total) ? -1 : a.name.localeCompare(b.name)));

  return {
    exitValue: exitValue.toString(),
    transactionCosts: costs.toString(),
    debt: debt.toString(),
    distributable: net.toString(),
    commonPrice: formatDec(result.price, 6),
    classes: [...s.classes.values()].map((c) => ({
      code: c.code,
      preference: (result.preference.get(c.code) ?? 0n).toString(),
      participation: sum(result.claims.map((x, i) => (x.source === c.code ? result.paid[i]! : 0n))).toString(),
      converts: converting.has(c.code),
    })),
    awards: { paid: awardsPaid.toString(), cancelled: result.cancelled.toString() },
    rows: out,
  };
}

export interface WaterfallChart {
  series: { key: string; name: string }[];
  points: { exitValue: string; values: Record<string, string>; converting: string[] }[];
}

/** Payouts per stakeholder (the largest seven, the rest together) at evenly spaced exit values. */
export function waterfallChart(s: CapState, terms: ExitTerms, chartMax: bigint, steps = 40): WaterfallChart {
  const top = runWaterfall(s, { ...terms, exitValue: chartMax.toString() });
  const keys = top.rows.slice(0, 7).map((r) => r.stakeholderId);
  const series = [
    ...keys.map((k) => ({ key: k, name: s.parties.get(k)?.name ?? 'Unknown' })),
    ...(top.rows.length > 7 ? [{ key: 'others', name: 'Others' }] : []),
  ];
  const points: WaterfallChart['points'] = [];
  for (let i = 0; i <= steps; i++) {
    const exit = (chartMax * BigInt(i)) / BigInt(steps);
    const w = runWaterfall(s, { ...terms, exitValue: exit.toString() });
    const values: Record<string, string> = {};
    let others = 0n;
    for (const r of w.rows) {
      if (keys.includes(r.stakeholderId)) values[r.stakeholderId] = r.total;
      else others += BigInt(r.total);
    }
    if (top.rows.length > 7) values.others = others.toString();
    points.push({ exitValue: exit.toString(), values, converting: w.classes.filter((c) => c.converts).map((c) => c.code) });
  }
  return { series, points };
}
