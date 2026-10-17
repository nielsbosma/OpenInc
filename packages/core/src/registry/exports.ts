import type { Ledger } from './engine.ts';
import { canonicalJson } from './hash.ts';
import type { RegisterView } from './views.ts';

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: unknown[][]): string {
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const ranges = (rs: { from: bigint; to: bigint }[]) => rs.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`)).join(' ');

/** One row per holder and class, in register order. */
export function registerCsv(view: RegisterView): string {
  const rows: unknown[][] = [
    [
      'Holder',
      'Kind',
      'National ID',
      'Country',
      'Address',
      'Class',
      'Shares',
      'Share Numbers',
      'Interim',
      'Pledged',
      'Votes',
      'Capital %',
      'Votes %',
    ],
  ];
  for (const h of view.holders)
    for (const p of h.positions)
      rows.push([
        h.name,
        h.kind,
        h.nationalId,
        h.country,
        h.address,
        p.classCode,
        p.count,
        ranges(p.ranges),
        p.interim ? 'yes' : '',
        p.pledged || '',
        h.votes,
        h.capitalPct,
        h.votesPct,
      ]);
  return toCsv(rows);
}

/** Everything the ledger derived, in a stable order: replaying the same transactions always gives the same text. */
export function ledgerJson(ledger: Ledger): string {
  const sortKey = (a: { key: string }, b: { key: string }) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  return canonicalJson({
    classes: [...ledger.classes.values()].map((c) => ({ code: c.def.code, issued: c.issued, nominal: c.nominal })),
    shareCapital: ledger.shareCapital,
    capitalHistory: ledger.capitalHistory,
    lots: [...ledger.open, ...ledger.closed].sort(sortKey),
    movements: ledger.movements,
    pledges: ledger.pledges,
    holderVersions: ledger.holderVersions,
  });
}
