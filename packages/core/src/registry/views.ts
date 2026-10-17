import type { AntiDilution, HolderKind, Participation } from '@openinc/shared';
import { formatDec, parseDec, percent, perShare } from './decimal.ts';
import type { EngineConfig, Ledger } from './engine.ts';

export interface PositionView {
  classCode: string;
  count: bigint;
  ranges: { from: bigint; to: bigint }[];
  interim: boolean;
  pledged: bigint;
}

export interface HolderRow {
  holderId: string;
  kind: HolderKind;
  name: string;
  nationalId: string;
  country: string;
  address: string;
  shares: bigint;
  /** Scaled by 10^10: votes per share can be fractional. */
  votes: string;
  capitalPct: string;
  votesPct: string;
  positions: PositionView[];
}

export interface ClassRow {
  code: string;
  name: string;
  votesPerShare: string;
  nominalPerShare: string | null;
  issued: bigint;
  capitalPct: string;
  votesPct: string;
  restrictions: { consent: boolean; preEmption: boolean; firstRefusal: boolean };
  dividendTerms: Record<string, unknown>;
  liquidationTerms: Record<string, unknown>;
  conversionClause: string;
  redemptionClause: string;
  seniorityRank: number;
  liqPrefMultiple: string;
  liqPrefCapMultiple: string | null;
  participation: Participation;
  antiDilution: AntiDilution;
  /** The transaction that last set the class terms. */
  termsFromTx: string;
}

export interface RegisterView {
  asOf: string;
  initialized: boolean;
  shareCapital: bigint;
  totalShares: bigint;
  totalVotes: string;
  /** Major units per share; in nominal mode the capital over all shares. */
  quotaValue: string;
  nextShareNumber: bigint | null;
  classes: ClassRow[];
  holders: HolderRow[];
  pledges: {
    id: string;
    holderId: string;
    classCode: string;
    count: bigint;
    ranges: { from: bigint; to: bigint }[];
    pledgee: { name: string; nationalId: string; address: string };
    since: string;
  }[];
  interimIssues: string[];
}

export function registerView(ledger: Ledger, config: EngineConfig, asOf: string): RegisterView {
  const totalShares = ledger.totalShares;
  const votesPerShare = new Map([...ledger.classes].map(([code, c]) => [code, parseDec(c.def.votesPerShare)]));
  let totalVotesScaled = 0n;
  for (const [code, c] of ledger.classes) totalVotesScaled += c.issued * votesPerShare.get(code)!;

  const byHolder = new Map<string, PositionView[]>();
  const sorted = [...ledger.open].sort((a, b) =>
    a.from !== null && b.from !== null ? (a.from < b.from ? -1 : 1) : a.classCode.localeCompare(b.classCode),
  );
  for (const lot of sorted) {
    const list = byHolder.get(lot.holderId) ?? [];
    let pos = list.find((p) => p.classCode === lot.classCode && p.interim === lot.interim);
    if (!pos) {
      pos = { classCode: lot.classCode, count: 0n, ranges: [], interim: lot.interim, pledged: 0n };
      list.push(pos);
    }
    pos.count += lot.count;
    if (lot.from !== null) pos.ranges.push({ from: lot.from, to: lot.to! });
    byHolder.set(lot.holderId, list);
  }
  for (const p of ledger.openPledges()) {
    const pos = byHolder.get(p.holderId)?.find((x) => x.classCode === p.classCode && !x.interim);
    if (pos) pos.pledged += p.count;
  }

  const holders: HolderRow[] = [...byHolder].map(([holderId, positions]) => {
    const d = ledger.holders.get(holderId);
    const shares = positions.reduce((s, p) => s + p.count, 0n);
    const votesScaled = positions.reduce((s, p) => s + p.count * votesPerShare.get(p.classCode)!, 0n);
    return {
      holderId,
      kind: d?.kind ?? 'person',
      name: d?.name ?? holderId,
      nationalId: d?.nationalId ?? '',
      country: d?.country ?? '',
      address: d?.address ?? '',
      shares,
      votes: formatDec(votesScaled),
      capitalPct: percent(shares, totalShares),
      votesPct: percent(votesScaled, totalVotesScaled),
      positions,
    };
  });
  holders.sort((a, b) => {
    const fa = a.positions.find((p) => p.ranges.length)?.ranges[0]?.from;
    const fb = b.positions.find((p) => p.ranges.length)?.ranges[0]?.from;
    if (fa !== undefined && fb !== undefined && fa !== fb) return fa < fb ? -1 : 1;
    return b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : a.name.localeCompare(b.name);
  });

  const classes: ClassRow[] = [...ledger.classes.values()].map((c) => ({
    code: c.def.code,
    name: c.def.name,
    votesPerShare: formatDec(votesPerShare.get(c.def.code)!),
    nominalPerShare: c.nominal === null ? null : formatDec(c.nominal),
    issued: c.issued,
    capitalPct: percent(c.issued, totalShares),
    votesPct: percent(c.issued * votesPerShare.get(c.def.code)!, totalVotesScaled),
    restrictions: c.def.restrictions,
    dividendTerms: c.def.dividendTerms,
    liquidationTerms: c.def.liquidationTerms,
    conversionClause: c.def.conversionClause,
    redemptionClause: c.def.redemptionClause,
    seniorityRank: c.def.seniorityRank,
    liqPrefMultiple: formatDec(parseDec(c.def.liqPrefMultiple)),
    liqPrefCapMultiple: c.def.liqPrefCapMultiple === null ? null : formatDec(parseDec(c.def.liqPrefCapMultiple)),
    participation: c.def.participation,
    antiDilution: c.def.antiDilution,
    termsFromTx: c.fromTx,
  }));

  return {
    asOf,
    initialized: ledger.initialized,
    shareCapital: ledger.shareCapital,
    totalShares,
    totalVotes: formatDec(totalVotesScaled),
    quotaValue: formatDec(perShare(ledger.shareCapital, totalShares, config.currencyDigits)),
    nextShareNumber: config.settings.numbering ? ledger.nextNumber : null,
    classes,
    holders,
    pledges: ledger.openPledges().map((p) => ({
      id: p.id,
      holderId: p.holderId,
      classCode: p.classCode,
      count: p.count,
      ranges: p.ranges,
      pledgee: p.pledgee,
      since: p.fromDate,
    })),
    interimIssues: [...ledger.interimIssues],
  };
}

/** Rows whose holder or holding changed between two views, for the wizard's before/after preview. */
export function changedHolders(before: RegisterView, after: RegisterView): string[] {
  const sig = (h: HolderRow | undefined) =>
    h ? JSON.stringify(h.positions, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)) + h.name + h.address + h.nationalId : '';
  const ids = new Set([...before.holders.map((h) => h.holderId), ...after.holders.map((h) => h.holderId)]);
  return [...ids].filter((id) => sig(before.holders.find((h) => h.holderId === id)) !== sig(after.holders.find((h) => h.holderId === id)));
}
