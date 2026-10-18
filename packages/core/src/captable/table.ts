import { DEC_SCALE, divRound, formatDec } from '../registry/decimal.ts';
import { amountAt, pctOf, sum } from './math.ts';
import { asConverted, type CapState, currentPrice, unallocated } from './state.ts';

export interface TableRow {
  /** Null for the unallocated pool rows. */
  stakeholderId: string | null;
  planId: string | null;
  name: string;
  groupId: string | null;
  inRegister: boolean;
  /** Units per class code. */
  byClass: Record<string, string>;
  /** Outstanding options and warrants: they become shares on exercise. */
  awards: string;
  vestedAwards: string;
  /** Virtual shares pay cash and never dilute, so they stay out of the fully diluted count. */
  virtual: string;
  issued: string;
  fullyDiluted: string;
  issuedPct: string;
  fullyDilutedPct: string;
  votesPct: string;
  /** Minor units at the current price; null when there is no price. */
  value: string | null;
}

export interface CapTable {
  asOf: string;
  currency: string;
  classes: { code: string; name: string; issued: string; votesPerShare: string; conversionRatio: string }[];
  rows: TableRow[];
  totals: { issued: string; awards: string; pool: string; virtual: string; fullyDiluted: string; votes: string };
  price: { pricePerShare: string; date: string; source: string } | null;
  /** Fully diluted units at the price, in minor units. */
  impliedValuation: string | null;
  unpriced: { id: string; stakeholderId: string; name: string; profile: string; amount: string; valuationCap: string | null }[];
  warnings: string[];
}

const fmt = (scaled: bigint) => formatDec(divRound(scaled, 10_000n) * 10_000n, 6);

/** Fully diluted counts per stakeholder, plus pool rows. */
export function positions(s: CapState, includePool: boolean) {
  const rows = new Map<
    string,
    { issued: bigint; converted: bigint; byClass: Map<string, bigint>; awards: bigint; vested: bigint; virtual: bigint; votes: bigint }
  >();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { issued: 0n, converted: 0n, byClass: new Map(), awards: 0n, vested: 0n, virtual: 0n, votes: 0n };
      rows.set(id, r);
    }
    return r;
  };
  for (const h of s.holdings) {
    if (h.units === 0n) continue;
    const c = s.classes.get(h.classCode);
    const r = row(h.stakeholderId);
    r.issued += h.units;
    r.converted += asConverted(c, h.units);
    r.byClass.set(h.classCode, (r.byClass.get(h.classCode) ?? 0n) + h.units);
    r.votes += (h.units * (c?.votesPerShare ?? DEC_SCALE)) / ((c?.unitsPerShare ?? 1n) * DEC_SCALE);
  }
  for (const a of s.awards) {
    const r = row(a.stakeholderId);
    if (a.kind === 'virtual') r.virtual += a.outstanding;
    else {
      r.awards += a.outstanding;
      r.vested += a.vested;
    }
  }
  const pools = includePool ? s.pools.filter((p) => p.kind !== 'virtual' && unallocated(p) > 0n) : [];
  return { rows, pools };
}

export function fullyDilutedTotal(s: CapState, includePool = true): bigint {
  const { rows, pools } = positions(s, includePool);
  return sum([...rows.values()].map((r) => r.converted + r.awards)) + sum(pools.map(unallocated));
}

export function buildTable(s: CapState, opts: { includePool: boolean; view: 'fully_diluted' | 'issued' }): CapTable {
  const { rows, pools } = positions(s, opts.includePool && opts.view === 'fully_diluted');
  const price = currentPrice(s);
  const totalIssued = sum([...rows.values()].map((r) => r.issued));
  const totalConverted = sum([...rows.values()].map((r) => r.converted));
  const totalAwards = sum([...rows.values()].map((r) => r.awards));
  const totalPool = sum(pools.map(unallocated));
  const totalVirtual = sum([...rows.values()].map((r) => r.virtual));
  const totalVotes = sum([...rows.values()].map((r) => r.votes));
  const fd = opts.view === 'issued' ? totalConverted : totalConverted + totalAwards + totalPool;

  const out: TableRow[] = [];
  for (const [id, r] of rows) {
    const p = s.parties.get(id);
    const fdUnits = opts.view === 'issued' ? r.converted : r.converted + r.awards;
    if (opts.view === 'issued' && r.issued === 0n) continue;
    out.push({
      stakeholderId: id,
      planId: null,
      name: p?.name ?? 'Unknown',
      groupId: p?.groupId ?? null,
      inRegister: p?.inRegister ?? false,
      byClass: Object.fromEntries([...r.byClass].map(([k, v]) => [k, v.toString()])),
      awards: r.awards.toString(),
      vestedAwards: r.vested.toString(),
      virtual: r.virtual.toString(),
      issued: r.issued.toString(),
      fullyDiluted: fdUnits.toString(),
      issuedPct: fmt(pctOf(r.converted, totalConverted)),
      fullyDilutedPct: fmt(pctOf(fdUnits, fd)),
      votesPct: fmt(pctOf(r.votes, totalVotes)),
      value: price ? amountAt(r.converted, price.price, s.digits).toString() : null,
    });
  }
  out.sort((a, b) =>
    BigInt(b.fullyDiluted) > BigInt(a.fullyDiluted)
      ? 1
      : BigInt(b.fullyDiluted) < BigInt(a.fullyDiluted)
        ? -1
        : a.name.localeCompare(b.name),
  );
  for (const p of pools)
    out.push({
      stakeholderId: null,
      planId: p.planId,
      name: `${p.name} (Unallocated)`,
      groupId: null,
      inRegister: false,
      byClass: {},
      awards: '0',
      vestedAwards: '0',
      virtual: '0',
      issued: '0',
      fullyDiluted: unallocated(p).toString(),
      issuedPct: '0',
      fullyDilutedPct: fmt(pctOf(unallocated(p), fd)),
      votesPct: '0',
      value: null,
    });

  return {
    asOf: s.asOf,
    currency: s.currency,
    classes: [...s.classes.values()].map((c) => ({
      code: c.code,
      name: c.name,
      issued: sum(s.holdings.filter((h) => h.classCode === c.code).map((h) => h.units)).toString(),
      votesPerShare: fmt(c.votesPerShare),
      conversionRatio: fmt(c.issuePrice && c.conversionPrice ? (c.issuePrice * DEC_SCALE) / c.conversionPrice : DEC_SCALE),
    })),
    rows: out,
    totals: {
      issued: totalIssued.toString(),
      awards: opts.view === 'issued' ? '0' : totalAwards.toString(),
      pool: totalPool.toString(),
      virtual: totalVirtual.toString(),
      fullyDiluted: fd.toString(),
      votes: totalVotes.toString(),
    },
    price: price ? { pricePerShare: formatDec(price.price), date: price.date, source: price.source } : null,
    impliedValuation: price ? amountAt(fd, price.price, s.digits).toString() : null,
    unpriced: s.unpriced.map((u) => ({
      id: u.id,
      stakeholderId: u.stakeholderId,
      name: s.parties.get(u.stakeholderId)?.name ?? 'Unknown',
      profile: u.profile,
      amount: u.principal.toString(),
      valuationCap: u.valuationCap?.toString() ?? null,
    })),
    warnings: s.warnings,
  };
}
