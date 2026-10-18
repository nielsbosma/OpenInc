import { type RegistryTransaction, TRANSACTION_LABELS } from '@openinc/shared';

const n = (v: string | number) => new Intl.NumberFormat('en').format(BigInt(v));

/** A one-line description for lists and the audit log. */
export function summarize(tx: RegistryTransaction, names: Map<string, string>): string {
  const name = (id: string) => tx.holders.find((h) => h.holderId === id)?.name ?? names.get(id) ?? 'unknown holder';
  const lines = (ls: { classCode: string; count: string | number }[]) => ls.map((l) => `${n(l.count)} ${l.classCode}`).join(' and ');
  switch (tx.type) {
    case 'incorporation':
      return `Incorporation: ${n(tx.allocations.reduce((s, a) => s + BigInt(a.count), 0n).toString())} shares to ${tx.allocations.length} holder${tx.allocations.length === 1 ? '' : 's'}`;
    case 'opening_balance':
      return `Opening balance: ${n(tx.lots.reduce((s, a) => s + BigInt(a.count), 0n).toString())} shares, ${new Set(tx.lots.map((l) => l.holderId)).size} holders`;
    case 'transfer':
      return `${tx.kind === 'sale' ? 'Sale' : tx.kind.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}: ${lines(tx.lines)} from ${name(tx.fromHolderId)} to ${name(tx.toHolderId)}`;
    case 'holder_change':
      return `Holder details: ${tx.holders.map((h) => h.name).join(', ')}`;
    case 'new_issue':
      return `New issue: ${n(tx.subscriptions.reduce((s, x) => s + BigInt(x.count), 0n).toString())} ${tx.classCode} at ${tx.pricePerShare}`;
    case 'registration':
      return `Registration on ${tx.registrationDate}`;
    case 'bonus_issue':
      return tx.mode === 'quota_value'
        ? 'Bonus issue without new shares'
        : `Bonus issue: ${tx.ratio?.newShares} new per ${tx.ratio?.perShares} held`;
    case 'split':
      return `Split 1:${tx.ratio}`;
    case 'reverse_split':
      return `Reverse split ${tx.ratio}:1`;
    case 'pledge':
      return `Pledge: ${lines(tx.lines)} of ${name(tx.holderId)} to ${tx.pledgee.name}`;
    case 'pledge_release':
      return 'Pledge release';
    case 'class_change':
      return `Class terms: ${tx.classes.map((c) => c.code).join(', ')}`;
    case 'reversal':
      return `Reversal: ${tx.reason}`;
  }
  return TRANSACTION_LABELS[(tx as RegistryTransaction).type];
}

/** Every holder a transaction names, for lookups and filters. */
export function holderIdsOf(tx: RegistryTransaction): string[] {
  const ids = new Set(tx.holders.map((h) => h.holderId));
  switch (tx.type) {
    case 'incorporation':
      for (const a of tx.allocations) ids.add(a.holderId);
      break;
    case 'opening_balance':
      for (const l of tx.lots) ids.add(l.holderId);
      break;
    case 'transfer':
      ids.add(tx.fromHolderId).add(tx.toHolderId);
      break;
    case 'new_issue':
      for (const s of tx.subscriptions) ids.add(s.holderId);
      break;
    case 'reverse_split':
      if (tx.poolHolderId) ids.add(tx.poolHolderId);
      break;
    case 'pledge':
      ids.add(tx.holderId);
      break;
  }
  return [...ids];
}
