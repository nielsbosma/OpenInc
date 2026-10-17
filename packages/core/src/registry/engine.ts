import {
  type HolderDetails,
  type RegistrySettingsView,
  type RegistryTransaction,
  type RulePack,
  type ShareClassDef,
  TRANSACTION_LABELS,
  type Violation,
} from '@openinc/shared';
import { amountMinor, DEC_SCALE, divRound, parseDec, toBig } from './decimal.ts';

/**
 * The ledger: a pure fold over committed transactions in effective order. Everything the register
 * shows (lots, movements, holder versions, pledges) comes out of `replay`, so a rebuild from the
 * transactions alone always gives the same result.
 */

export interface LedgerTx {
  id: string;
  /** Commit order. Breaks ties between transactions on the same effective date. Drafts sort last. */
  seq: number;
  tx: RegistryTransaction;
}

export interface EngineConfig {
  settings: RegistrySettingsView;
  rulePack: RulePack;
  currency: string;
  currencyDigits: number;
}

export interface Range {
  from: bigint;
  to: bigint;
}

export interface Lot {
  key: string;
  holderId: string;
  classCode: string;
  count: bigint;
  from: bigint | null;
  to: bigint | null;
  interim: boolean;
  /** The new issue that created an interim lot, until it is registered. */
  interimTx: string | null;
  fromTx: string;
  fromDate: string;
  toTx: string | null;
  toDate: string | null;
}

export interface Movement {
  txId: string;
  classCode: string;
  fromHolderId: string | null;
  toHolderId: string | null;
  count: bigint;
  from: bigint | null;
  to: bigint | null;
  nominalAmount: bigint | null;
  pricePerShare: string | null;
  consideration: bigint | null;
}

export interface Pledge {
  id: string;
  txId: string;
  holderId: string;
  classCode: string;
  count: bigint;
  ranges: Range[];
  pledgee: { name: string; nationalId: string; address: string };
  fromTx: string;
  fromDate: string;
  toTx: string | null;
  toDate: string | null;
}

export interface ClassState {
  def: ShareClassDef;
  issued: bigint;
  /** Scaled decimal, major units. Only in nominal mode. */
  nominal: bigint | null;
  fromTx: string;
}

export interface HolderVersion {
  holderId: string;
  txId: string;
  validFrom: string;
  validTo: string | null;
  details: HolderDetails;
}

export interface CapitalPoint {
  txId: string;
  date: string;
  shareCapital: bigint;
}

export class LedgerError extends Error {
  constructor(public readonly violations: Violation[]) {
    super(violations.map((v) => v.message).join('; '));
  }
}

const fail = (rule: string, message: string): never => {
  throw new LedgerError([{ rule, message, severity: 'error' }]);
};

const rangeSize = (r: Range) => r.to - r.from + 1n;

function subtractRange(lot: Range, cut: Range): Range[] {
  const out: Range[] = [];
  if (cut.from > lot.from) out.push({ from: lot.from, to: cut.from - 1n < lot.to ? cut.from - 1n : lot.to });
  if (cut.to < lot.to) out.push({ from: cut.to + 1n > lot.from ? cut.to + 1n : lot.from, to: lot.to });
  return out.filter((r) => r.from <= r.to);
}

function overlap(a: Range, b: Range): Range | null {
  const from = a.from > b.from ? a.from : b.from;
  const to = a.to < b.to ? a.to : b.to;
  return from <= to ? { from, to } : null;
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.from <= last.to + 1n) {
      if (r.to > last.to) last.to = r.to;
    } else out.push({ ...r });
  }
  return out;
}

function fmtRange(r: Range) {
  return r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`;
}

function round(numerator: bigint, denominator: bigint, mode: 'down' | 'nearest' | 'up'): bigint {
  if (mode === 'down') return numerator / denominator;
  if (mode === 'up') return (numerator + denominator - 1n) / denominator;
  return divRound(numerator, denominator);
}

export class Ledger {
  initialized = false;
  classes = new Map<string, ClassState>();
  shareCapital = 0n;
  nextNumber = 1n;
  open: Lot[] = [];
  closed: Lot[] = [];
  pledges: Pledge[] = [];
  holders = new Map<string, HolderDetails>();
  holderVersions: HolderVersion[] = [];
  movements: Movement[] = [];
  capitalHistory: CapitalPoint[] = [];
  interimIssues = new Set<string>();
  warnings: Violation[] = [];
  applied: { id: string; date: string; type: RegistryTransaction['type'] }[] = [];

  private keyCounter = 0;
  private current!: LedgerTx;

  constructor(private readonly config: EngineConfig) {}

  get numbered() {
    return this.config.settings.numbering;
  }

  get totalShares(): bigint {
    let total = 0n;
    for (const c of this.classes.values()) total += c.issued;
    return total;
  }

  openPledges(holderId?: string, classCode?: string) {
    return this.pledges.filter(
      (p) => p.toTx === null && (!holderId || p.holderId === holderId) && (!classCode || p.classCode === classCode),
    );
  }

  holderName(id: string | null) {
    return id ? (this.holders.get(id)?.name ?? id) : '';
  }

  /** Applies one transaction or throws a LedgerError naming the broken rules. */
  apply(item: LedgerTx): void {
    this.current = item;
    this.keyCounter = 0;
    const { tx } = item;
    if (tx.type === 'reversal') fail('REVERSAL_IN_REPLAY', 'A reversal has no effect of its own');
    if (!this.initialized && tx.type !== 'incorporation' && tx.type !== 'opening_balance')
      fail('NOT_INITIALIZED', `${TRANSACTION_LABELS[tx.type]} on ${tx.effectiveDate} comes before the incorporation or opening balance`);
    if (this.config.rulePack.registrationRequired.includes(tx.type) && !tx.registrationDate)
      fail(
        'REGISTRATION_REQUIRED',
        `${TRANSACTION_LABELS[tx.type]} can only be entered once ${this.config.rulePack.terms.registrationAuthority} has registered it. Park it as Awaiting Registration.`,
      );
    this.applyHolders(tx.holders);
    switch (tx.type) {
      case 'incorporation':
      case 'opening_balance':
        this.applyFoundation(tx);
        break;
      case 'transfer':
        this.applyTransfer(tx);
        break;
      case 'holder_change':
        break;
      case 'new_issue':
        this.applyNewIssue(tx);
        break;
      case 'registration':
        this.applyRegistration(tx);
        break;
      case 'bonus_issue':
        this.applyBonusIssue(tx);
        break;
      case 'split':
        this.applySplit(tx);
        break;
      case 'reverse_split':
        this.applyReverseSplit(tx);
        break;
      case 'pledge':
        this.applyPledge(tx);
        break;
      case 'pledge_release':
        this.applyPledgeRelease(tx);
        break;
    }
    this.checkInvariants();
    const last = this.capitalHistory.at(-1);
    if (!last || last.shareCapital !== this.shareCapital)
      this.capitalHistory.push({ txId: item.id, date: tx.effectiveDate, shareCapital: this.shareCapital });
    this.applied.push({ id: item.id, date: tx.effectiveDate, type: tx.type });
  }

  // ── building blocks ────────────────────────────────────────────────────────

  private newKey() {
    return `${this.current.id}:${this.keyCounter++}`;
  }

  private openLot(holderId: string, classCode: string, count: bigint, range: Range | null, interimTx: string | null = null): Lot {
    const lot: Lot = {
      key: this.newKey(),
      holderId,
      classCode,
      count,
      from: range?.from ?? null,
      to: range?.to ?? null,
      interim: interimTx !== null,
      interimTx,
      fromTx: this.current.id,
      fromDate: this.current.tx.effectiveDate,
      toTx: null,
      toDate: null,
    };
    this.open.push(lot);
    return lot;
  }

  private closeLot(lot: Lot) {
    lot.toTx = this.current.id;
    lot.toDate = this.current.tx.effectiveDate;
    this.open = this.open.filter((l) => l !== lot);
    // A lot opened and closed by the same transaction never existed for anyone looking at the register.
    if (lot.fromTx !== this.current.id) this.closed.push(lot);
  }

  private requireHolder(id: string) {
    if (!this.holders.has(id)) fail('UNKNOWN_HOLDER', `Holder ${id} has no details. Add their name and ID in this transaction.`);
  }

  private requireClass(code: string): ClassState {
    const c = this.classes.get(code);
    if (!c) return fail('UNKNOWN_CLASS', `There is no share class ${code}`);
    return c;
  }

  private applyHolders(list: HolderDetails[]) {
    for (const details of list) {
      const problems = this.config.rulePack.checkHolder(details);
      const errors = problems.filter((p) => p.severity === 'error');
      if (errors.length) throw new LedgerError(errors);
      this.warnings.push(...problems.map((p) => ({ ...p, transactionId: this.current.id })));
      const date = this.current.tx.effectiveDate;
      for (const v of this.holderVersions) if (v.holderId === details.holderId && v.validTo === null) v.validTo = date;
      this.holderVersions = this.holderVersions.filter(
        (v) => !(v.holderId === details.holderId && v.validFrom === date && v.validTo === date),
      );
      this.holderVersions.push({ holderId: details.holderId, txId: this.current.id, validFrom: date, validTo: null, details });
      this.holders.set(details.holderId, details);
    }
  }

  private nominalMinor(c: ClassState, count: bigint): bigint | null {
    return c.nominal === null ? null : amountMinor(c.nominal, count, this.config.currencyDigits);
  }

  private quotaIncrease(count: bigint): bigint {
    const total = this.totalShares;
    if (total === 0n) return 0n;
    return divRound(this.shareCapital * count, total);
  }

  /** Merges a holder's adjacent ordinary lots of a class, keeping lots that did not change. */
  private normalize(holderId: string, classCode: string) {
    const mine = this.open.filter((l) => l.holderId === holderId && l.classCode === classCode && !l.interim);
    if (mine.length < 2) return;
    if (!this.numbered) {
      const total = mine.reduce((s, l) => s + l.count, 0n);
      for (const l of mine) this.closeLot(l);
      this.openLot(holderId, classCode, total, null);
      return;
    }
    const merged = mergeRanges(mine.map((l) => ({ from: l.from!, to: l.to! })));
    const same = (l: Lot, r: Range) => l.from === r.from && l.to === r.to;
    for (const l of mine) if (!merged.some((r) => same(l, r))) this.closeLot(l);
    for (const r of merged) if (!mine.some((l) => same(l, r))) this.openLot(holderId, classCode, rangeSize(r), r);
  }

  private pledgedRanges(holderId: string, classCode: string): Range[] {
    return this.openPledges(holderId, classCode).flatMap((p) => p.ranges);
  }

  private pledgedCount(holderId: string, classCode: string): bigint {
    return this.openPledges(holderId, classCode).reduce((s, p) => s + p.count, 0n);
  }

  /**
   * Finds the shares a holder gives up: the named ranges, or the lowest free numbers. Free means
   * not interim and, unless `allowPledged`, not pledged.
   */
  private pickShares(
    holderId: string,
    classCode: string,
    count: bigint,
    ranges: { from: string | number; to: string | number }[] | undefined,
    opts: { allowPledged?: boolean; purpose: string },
  ): Range[] | bigint {
    const name = this.holderName(holderId);
    const lots = this.open.filter((l) => l.holderId === holderId && l.classCode === classCode);
    const ordinary = lots.filter((l) => !l.interim);
    const interimCount = lots.filter((l) => l.interim).reduce((s, l) => s + l.count, 0n);
    const pledged = opts.allowPledged ? 0n : this.pledgedCount(holderId, classCode);
    const held = ordinary.reduce((s, l) => s + l.count, 0n);

    if (!this.numbered) {
      if (ranges?.length) fail('NUMBERING_OFF', 'Share numbering is off, so leave out share numbers');
      if (held - pledged >= count) return count;
      if (held >= count)
        fail('PLEDGED_SHARES', `${name} holds ${held} ${classCode} shares but ${pledged} are pledged. Release the pledge first.`);
      if (held + interimCount >= count)
        fail('INTERIM_SHARES', `${name}'s ${classCode} shares include interim shares that are not registered yet`);
      return fail('INSUFFICIENT_SHARES', `${name} holds ${held} ${classCode} shares, fewer than the ${count} to ${opts.purpose}`);
    }

    const pledgedRanges = opts.allowPledged ? [] : this.pledgedRanges(holderId, classCode);
    if (ranges?.length) {
      const wanted = mergeRanges(ranges.map((r) => ({ from: toBig(r.from), to: toBig(r.to) })));
      for (const r of wanted) if (r.from > r.to) fail('INVALID_RANGE', `Share numbers ${r.from}–${r.to} are reversed`);
      const total = wanted.reduce((s, r) => s + rangeSize(r), 0n);
      if (total !== count) fail('RANGE_COUNT_MISMATCH', `The share numbers cover ${total} shares, not ${count}`);
      for (const r of wanted) {
        for (const l of lots.filter((x) => x.interim))
          if (overlap(r, { from: l.from!, to: l.to! }))
            fail('INTERIM_SHARES', `Shares ${fmtRange(r)} include interim shares that are not registered yet`);
        for (const p of pledgedRanges)
          if (overlap(r, p)) fail('PLEDGED_SHARES', `Shares ${fmtRange(overlap(r, p)!)} are pledged. Release the pledge first.`);
        const covered = ordinary.reduce((s, l) => {
          const o = overlap(r, { from: l.from!, to: l.to! });
          return s + (o ? rangeSize(o) : 0n);
        }, 0n);
        if (covered !== rangeSize(r)) fail('NOT_HOLDERS_SHARES', `${name} does not hold all of the ${classCode} shares ${fmtRange(r)}`);
      }
      return wanted;
    }

    let free = mergeRanges(ordinary.map((l) => ({ from: l.from!, to: l.to! })));
    for (const p of pledgedRanges) free = free.flatMap((f) => (overlap(f, p) ? subtractRange(f, p) : [f]));
    const out: Range[] = [];
    let left = count;
    for (const f of free) {
      if (left === 0n) break;
      const take = rangeSize(f) < left ? rangeSize(f) : left;
      out.push({ from: f.from, to: f.from + take - 1n });
      left -= take;
    }
    if (left > 0n) {
      if (held >= count)
        fail('PLEDGED_SHARES', `${name} holds ${held} ${classCode} shares but some are pledged. Release the pledge first.`);
      if (held + interimCount >= count)
        fail('INTERIM_SHARES', `${name}'s ${classCode} shares include interim shares that are not registered yet`);
      fail('INSUFFICIENT_SHARES', `${name} holds ${held} ${classCode} shares, fewer than the ${count} to ${opts.purpose}`);
    }
    return out;
  }

  /** Takes picked shares out of a holder's ordinary lots, keeping the remainder as new lots. */
  private removeShares(holderId: string, classCode: string, picked: Range[] | bigint) {
    const lots = this.open.filter((l) => l.holderId === holderId && l.classCode === classCode && !l.interim);
    if (typeof picked === 'bigint') {
      let left = picked;
      for (const l of lots) {
        if (left === 0n) break;
        const take = l.count < left ? l.count : left;
        this.closeLot(l);
        if (l.count > take) this.openLot(holderId, classCode, l.count - take, null);
        left -= take;
      }
      return;
    }
    for (const l of lots) {
      const lr = { from: l.from!, to: l.to! };
      if (!picked.some((p) => overlap(lr, p))) continue;
      let rest = [lr];
      for (const p of picked) rest = rest.flatMap((r) => (overlap(r, p) ? subtractRange(r, p) : [r]));
      this.closeLot(l);
      for (const r of rest) this.openLot(holderId, classCode, rangeSize(r), r);
    }
  }

  private addShares(holderId: string, classCode: string, picked: Range[] | bigint, interimTx: string | null = null) {
    if (typeof picked === 'bigint') this.openLot(holderId, classCode, picked, null, interimTx);
    else for (const r of picked) this.openLot(holderId, classCode, rangeSize(r), r, interimTx);
  }

  private allocateNumbers(count: bigint): Range | null {
    if (!this.numbered) return null;
    const r = { from: this.nextNumber, to: this.nextNumber + count - 1n };
    this.nextNumber += count;
    return r;
  }

  private movement(m: Omit<Movement, 'txId' | 'from' | 'to' | 'nominalAmount' | 'pricePerShare' | 'consideration'> & Partial<Movement>) {
    this.movements.push({
      txId: this.current.id,
      from: null,
      to: null,
      nominalAmount: null,
      pricePerShare: null,
      consideration: null,
      ...m,
    });
  }

  private blockWhileInterim(what: string) {
    if (this.interimIssues.size > 0)
      fail('INTERIM_PENDING', `${what} cannot be entered while interim shares from a new issue are waiting for registration`);
  }

  // ── transactions ───────────────────────────────────────────────────────────

  private applyFoundation(tx: Extract<RegistryTransaction, { type: 'incorporation' | 'opening_balance' }>) {
    if (this.initialized) fail('ALREADY_INITIALIZED', 'The register already has an incorporation or opening balance');
    this.initialized = true;
    const seen = new Set<string>();
    for (const def of tx.classes) {
      if (seen.has(def.code)) fail('DUPLICATE_CLASS', `Share class ${def.code} is listed twice`);
      seen.add(def.code);
      if (this.config.settings.capitalMode === 'nominal' && def.nominalPerShare === null)
        fail('NOMINAL_REQUIRED', `Share class ${def.code} needs a nominal value per share`);
      this.classes.set(def.code, {
        def,
        issued: 0n,
        nominal: this.config.settings.capitalMode === 'nominal' && def.nominalPerShare !== null ? parseDec(def.nominalPerShare) : null,
        fromTx: this.current.id,
      });
    }
    this.shareCapital = toBig(tx.shareCapital);
    const entries =
      tx.type === 'incorporation'
        ? tx.allocations.map((a) => ({ ...a, ranges: undefined, interim: false }))
        : tx.lots.map((l) => ({ ...l, pricePerShare: undefined }));
    // Given share numbers first, so the automatic ones continue after the highest.
    if (this.numbered) {
      for (const e of entries) for (const r of e.ranges ?? []) if (toBig(r.to) >= this.nextNumber) this.nextNumber = toBig(r.to) + 1n;
    }
    const taken: Range[] = [];
    for (const e of entries) {
      this.requireHolder(e.holderId);
      const c = this.requireClass(e.classCode);
      const count = toBig(e.count);
      let picked: Range[] | bigint = count;
      if (this.numbered) {
        if (e.ranges?.length) {
          picked = mergeRanges(e.ranges.map((r) => ({ from: toBig(r.from), to: toBig(r.to) })));
          const total = picked.reduce((s, r) => s + rangeSize(r), 0n);
          if (total !== count)
            fail('RANGE_COUNT_MISMATCH', `${this.holderName(e.holderId)}: the share numbers cover ${total} shares, not ${count}`);
          for (const r of picked)
            for (const t of taken)
              if (overlap(r, t)) fail('UNIQUE_SHARE_NUMBERS', `Share numbers ${fmtRange(overlap(r, t)!)} are given twice`);
        } else picked = [this.allocateNumbers(count)!];
        taken.push(...picked);
      } else if (e.ranges?.length) fail('NUMBERING_OFF', 'Share numbering is off, so leave out share numbers');
      this.addShares(e.holderId, e.classCode, picked, e.interim ? this.current.id : null);
      if (e.interim) this.interimIssues.add(this.current.id);
      c.issued += count;
      for (const r of typeof picked === 'bigint' ? [null] : picked)
        this.movement({
          classCode: e.classCode,
          fromHolderId: null,
          toHolderId: e.holderId,
          count: r ? rangeSize(r) : count,
          from: r?.from ?? null,
          to: r?.to ?? null,
          nominalAmount: this.nominalMinor(c, r ? rangeSize(r) : count),
          pricePerShare: e.pricePerShare !== undefined ? String(e.pricePerShare) : null,
          consideration:
            e.pricePerShare !== undefined
              ? amountMinor(parseDec(e.pricePerShare), r ? rangeSize(r) : count, this.config.currencyDigits)
              : null,
        });
    }
    for (const h of new Set(entries.map((e) => e.holderId))) for (const code of this.classes.keys()) this.normalize(h, code);
    if (tx.type === 'opening_balance') {
      tx.pledges.forEach((p, i) => {
        this.requireClass(p.classCode);
        const picked = this.pickShares(p.holderId, p.classCode, toBig(p.count), p.ranges, { purpose: 'pledge' });
        this.pledges.push({
          id: `${this.current.id}:p${i}`,
          txId: this.current.id,
          holderId: p.holderId,
          classCode: p.classCode,
          count: toBig(p.count),
          ranges: typeof picked === 'bigint' ? [] : picked,
          pledgee: p.pledgee,
          fromTx: this.current.id,
          fromDate: tx.effectiveDate,
          toTx: null,
          toDate: null,
        });
      });
    }
  }

  private applyTransfer(tx: Extract<RegistryTransaction, { type: 'transfer' }>) {
    if (tx.fromHolderId === tx.toHolderId) fail('SAME_HOLDER', 'The transferor and the acquirer are the same holder');
    this.requireHolder(tx.fromHolderId);
    this.requireHolder(tx.toHolderId);
    const terms = this.config.rulePack.terms;
    const steps = tx.restrictionSteps;
    const price = tx.pricePerShare !== undefined ? parseDec(tx.pricePerShare) : null;
    if (tx.kind === 'sale' && price === null) fail('PRICE_REQUIRED', 'A sale needs a price per share');
    for (const line of tx.lines) {
      const c = this.requireClass(line.classCode);
      const r = c.def.restrictions;
      if (r.consent && !steps.consent?.obtained)
        fail('RESTRICTION_CONSENT', `Class ${line.classCode} has a ${terms.consent}: record that the company consented to this transfer`);
      if (r.preEmption && !steps.preEmption)
        fail(
          'RESTRICTION_PRE_EMPTION',
          `Class ${line.classCode} has a ${terms.preEmption}: record how the offer to the other holders ended`,
        );
      if (r.firstRefusal && !steps.firstRefusal)
        fail(
          'RESTRICTION_FIRST_REFUSAL',
          `Class ${line.classCode} has a ${terms.firstRefusal}: record how the offer to the other holders ended`,
        );
      const count = toBig(line.count);
      const picked = this.pickShares(tx.fromHolderId, line.classCode, count, line.ranges, { purpose: 'transfer' });
      this.removeShares(tx.fromHolderId, line.classCode, picked);
      this.addShares(tx.toHolderId, line.classCode, picked);
      this.normalize(tx.fromHolderId, line.classCode);
      this.normalize(tx.toHolderId, line.classCode);
      for (const rr of typeof picked === 'bigint' ? [null] : picked) {
        const n = rr ? rangeSize(rr) : count;
        this.movement({
          classCode: line.classCode,
          fromHolderId: tx.fromHolderId,
          toHolderId: tx.toHolderId,
          count: n,
          from: rr?.from ?? null,
          to: rr?.to ?? null,
          nominalAmount: this.nominalMinor(c, n),
          pricePerShare: price !== null ? String(tx.pricePerShare) : null,
          consideration: price !== null ? amountMinor(price, n, this.config.currencyDigits) : null,
        });
      }
    }
  }

  private applyNewIssue(tx: Extract<RegistryTransaction, { type: 'new_issue' }>) {
    const c = this.requireClass(tx.classCode);
    const price = parseDec(tx.pricePerShare);
    const total = tx.subscriptions.reduce((s, x) => s + toBig(x.count), 0n);
    const quotaIncrease =
      c.nominal !== null ? this.nominalMinor(c, c.issued + total)! - this.nominalMinor(c, c.issued)! : this.quotaIncrease(total);
    const increase = tx.capitalIncrease !== undefined ? toBig(tx.capitalIncrease) : quotaIncrease;
    if (c.nominal !== null && increase !== quotaIncrease)
      fail(
        'SHARE_CAPITAL',
        `With a nominal value of ${tx.classCode} shares the capital increase must be ${quotaIncrease} (minor units), not ${increase}`,
      );
    const interim = this.config.rulePack.interimUntilRegistered.includes('new_issue') && !tx.registrationDate;
    const existing = new Set(this.open.map((l) => l.holderId));
    for (const s of tx.subscriptions) {
      this.requireHolder(s.holderId);
      if (tx.allocation === 'pro_rata' && !existing.has(s.holderId))
        this.warnings.push({
          rule: 'PRO_RATA_NEW_HOLDER',
          severity: 'warning',
          message: `${this.holderName(s.holderId)} subscribes in a pro rata issue without holding shares before it`,
          transactionId: this.current.id,
        });
      const count = toBig(s.count);
      const range = this.allocateNumbers(count);
      this.addShares(s.holderId, tx.classCode, range ? [range] : count, interim ? this.current.id : null);
      if (!interim) this.normalize(s.holderId, tx.classCode);
      this.movement({
        classCode: tx.classCode,
        fromHolderId: null,
        toHolderId: s.holderId,
        count,
        from: range?.from ?? null,
        to: range?.to ?? null,
        nominalAmount: c.nominal !== null ? this.nominalMinor(c, count) : divRound(increase * count, total),
        pricePerShare: String(tx.pricePerShare),
        consideration: amountMinor(price, count, this.config.currencyDigits),
      });
    }
    c.issued += total;
    this.shareCapital += increase;
    if (interim) {
      this.interimIssues.add(this.current.id);
      this.warnings.push({
        rule: 'INTERIM_SHARES_ENTERED',
        severity: 'warning',
        message: `The new shares are interim shares until ${this.config.rulePack.terms.registrationAuthority} registers the issue. Enter a Registration when it does.`,
        transactionId: this.current.id,
      });
    }
  }

  private applyRegistration(tx: Extract<RegistryTransaction, { type: 'registration' }>) {
    if (!this.interimIssues.has(tx.ofTransactionId))
      fail('NOT_AWAITING_REGISTRATION', 'That transaction has no interim shares waiting for registration at this date');
    const lots = this.open.filter((l) => l.interimTx === tx.ofTransactionId);
    const touched = new Set<string>();
    for (const l of lots) {
      this.closeLot(l);
      this.openLot(l.holderId, l.classCode, l.count, l.from === null ? null : { from: l.from, to: l.to! });
      touched.add(`${l.holderId}\u0000${l.classCode}`);
    }
    for (const t of touched) {
      const [h, c] = t.split('\u0000') as [string, string];
      this.normalize(h, c);
    }
    this.interimIssues.delete(tx.ofTransactionId);
  }

  private holdingsByGroup(): { holderId: string; classCode: string; count: bigint; first: bigint }[] {
    const groups = new Map<string, { holderId: string; classCode: string; count: bigint; first: bigint }>();
    for (const l of this.open) {
      const k = `${l.holderId}\u0000${l.classCode}`;
      const g = groups.get(k) ?? { holderId: l.holderId, classCode: l.classCode, count: 0n, first: l.from ?? 0n };
      g.count += l.count;
      if (l.from !== null && l.from < g.first) g.first = l.from;
      groups.set(k, g);
    }
    const classOrder = [...this.classes.keys()];
    return [...groups.values()].sort((a, b) =>
      this.numbered
        ? a.first < b.first
          ? -1
          : a.first > b.first
            ? 1
            : 0
        : classOrder.indexOf(a.classCode) - classOrder.indexOf(b.classCode) ||
          this.holderName(a.holderId).localeCompare(this.holderName(b.holderId)),
    );
  }

  private applyBonusIssue(tx: Extract<RegistryTransaction, { type: 'bonus_issue' }>) {
    this.blockWhileInterim('A bonus issue');
    const increase = toBig(tx.capitalIncrease);
    if (increase <= 0n) fail('SHARE_CAPITAL', 'A bonus issue must increase the share capital');
    if (tx.mode === 'quota_value') {
      if (this.config.settings.capitalMode === 'nominal') {
        const total = this.totalShares;
        const perShareScaled = (increase * DEC_SCALE) / (total * 10n ** BigInt(this.config.currencyDigits));
        if (amountMinor(perShareScaled, total, this.config.currencyDigits) !== increase)
          fail('NOMINAL_NOT_DIVISIBLE', 'The increase does not divide evenly over the shares, so the nominal value would not be exact');
        for (const c of this.classes.values()) c.nominal = (c.nominal ?? 0n) + perShareScaled;
      }
      this.shareCapital += increase;
      return;
    }
    if (!tx.ratio) return fail('RATIO_REQUIRED', 'Say how many new shares are issued per held shares');
    const num = toBig(tx.ratio.newShares);
    const den = toBig(tx.ratio.perShares);
    if (tx.classCode) this.requireClass(tx.classCode);
    let issued = 0n;
    for (const g of this.holdingsByGroup()) {
      const count = round(g.count * num, den, tx.rounding);
      if (count === 0n) continue;
      const classCode = tx.classCode ?? g.classCode;
      const c = this.requireClass(classCode);
      const range = this.allocateNumbers(count);
      this.addShares(g.holderId, classCode, range ? [range] : count);
      this.normalize(g.holderId, classCode);
      c.issued += count;
      issued += count;
      this.movement({
        classCode,
        fromHolderId: null,
        toHolderId: g.holderId,
        count,
        from: range?.from ?? null,
        to: range?.to ?? null,
        nominalAmount: this.nominalMinor(c, count),
      });
    }
    if (issued === 0n) fail('NO_SHARES', 'The ratio gives no new shares to anyone');
    this.shareCapital += increase;
  }

  private applySplit(tx: Extract<RegistryTransaction, { type: 'split' }>) {
    this.blockWhileInterim('A split');
    const k = BigInt(tx.ratio);
    for (const c of this.classes.values()) {
      if (c.nominal !== null) {
        if (c.nominal % k !== 0n) fail('NOMINAL_NOT_DIVISIBLE', `The nominal value of ${c.def.code} shares does not divide by ${tx.ratio}`);
        c.nominal /= k;
      }
      c.issued *= k;
    }
    for (const l of [...this.open]) {
      this.closeLot(l);
      const range = l.from === null ? null : { from: (l.from - 1n) * k + 1n, to: l.to! * k };
      this.movement({ classCode: l.classCode, fromHolderId: l.holderId, toHolderId: null, count: l.count, from: l.from, to: l.to });
      this.openLot(l.holderId, l.classCode, l.count * k, range);
      this.movement({
        classCode: l.classCode,
        fromHolderId: null,
        toHolderId: l.holderId,
        count: l.count * k,
        from: range?.from ?? null,
        to: range?.to ?? null,
      });
    }
    for (const p of this.openPledges()) {
      p.count *= k;
      p.ranges = p.ranges.map((r) => ({ from: (r.from - 1n) * k + 1n, to: r.to * k }));
    }
    this.nextNumber = (this.nextNumber - 1n) * k + 1n;
  }

  private applyReverseSplit(tx: Extract<RegistryTransaction, { type: 'reverse_split' }>) {
    this.blockWhileInterim('A reverse split');
    if (this.openPledges().length)
      fail('PLEDGES_BLOCK_REVERSE_SPLIT', 'Release the open pledges before a reverse split, then pledge the new shares again');
    const k = BigInt(tx.ratio);
    if (tx.fractions === 'buy_out' && tx.buyOutPricePerShare === undefined)
      fail('BUY_OUT_PRICE_REQUIRED', 'Say what the company pays per old share for the fractions it buys out');
    if (tx.fractions === 'pool') {
      if (!tx.poolHolderId) fail('POOL_HOLDER_REQUIRED', 'Pick the holder that collects the fractions');
      this.requireHolder(tx.poolHolderId!);
    }
    const groups = this.holdingsByGroup();
    const before = groups.map((g) => ({ ...g }));
    const pooled = new Map<string, bigint>();
    if (tx.fractions === 'pool') {
      for (const g of groups) {
        if (g.holderId === tx.poolHolderId) continue;
        const r = g.count % k;
        if (r === 0n) continue;
        g.count -= r;
        pooled.set(g.classCode, (pooled.get(g.classCode) ?? 0n) + r);
        this.movement({ classCode: g.classCode, fromHolderId: g.holderId, toHolderId: tx.poolHolderId!, count: r });
      }
      for (const [classCode, r] of pooled) {
        const target = groups.find((g) => g.holderId === tx.poolHolderId && g.classCode === classCode);
        if (target) target.count += r;
        else groups.push({ holderId: tx.poolHolderId!, classCode, count: r, first: 1n << 62n });
      }
    }
    for (const l of [...this.open]) this.closeLot(l);
    for (const b of before) this.movement({ classCode: b.classCode, fromHolderId: b.holderId, toHolderId: null, count: b.count });
    for (const c of this.classes.values()) {
      c.issued = 0n;
      if (c.nominal !== null) c.nominal *= k;
    }
    this.nextNumber = 1n;
    const price = tx.buyOutPricePerShare !== undefined ? parseDec(tx.buyOutPricePerShare) : null;
    for (const g of groups) {
      const rounding = tx.fractions === 'round' ? tx.rounding : 'down';
      const count = round(g.count, k, rounding);
      const remainder = g.count - count * k;
      if (tx.fractions === 'buy_out' && remainder > 0n)
        this.movement({
          classCode: g.classCode,
          fromHolderId: g.holderId,
          toHolderId: null,
          count: remainder,
          pricePerShare: String(tx.buyOutPricePerShare),
          consideration: amountMinor(price!, remainder, this.config.currencyDigits),
        });
      if (count <= 0n) continue;
      const c = this.requireClass(g.classCode);
      const range = this.allocateNumbers(count);
      this.openLot(g.holderId, g.classCode, count, range);
      c.issued += count;
      this.movement({
        classCode: g.classCode,
        fromHolderId: null,
        toHolderId: g.holderId,
        count,
        from: range?.from ?? null,
        to: range?.to ?? null,
      });
    }
  }

  private applyPledge(tx: Extract<RegistryTransaction, { type: 'pledge' }>) {
    this.requireHolder(tx.holderId);
    tx.lines.forEach((line, i) => {
      this.requireClass(line.classCode);
      const count = toBig(line.count);
      const picked = this.pickShares(tx.holderId, line.classCode, count, line.ranges, { purpose: 'pledge' });
      this.pledges.push({
        id: i === 0 ? this.current.id : `${this.current.id}:${i}`,
        txId: this.current.id,
        holderId: tx.holderId,
        classCode: line.classCode,
        count,
        ranges: typeof picked === 'bigint' ? [] : picked,
        pledgee: tx.pledgee,
        fromTx: this.current.id,
        fromDate: tx.effectiveDate,
        toTx: null,
        toDate: null,
      });
    });
  }

  private applyPledgeRelease(tx: Extract<RegistryTransaction, { type: 'pledge_release' }>) {
    const matching = this.openPledges().filter((p) => p.id === tx.pledgeId || p.txId === tx.pledgeId);
    if (!matching.length) fail('UNKNOWN_PLEDGE', 'There is no open pledge with that id at this date');
    for (const p of matching) {
      p.toTx = this.current.id;
      p.toDate = tx.effectiveDate;
    }
  }

  // ── invariants ─────────────────────────────────────────────────────────────

  checkInvariants() {
    const errors: Violation[] = [];
    for (const [code, c] of this.classes) {
      const inLots = this.open.filter((l) => l.classCode === code).reduce((s, l) => s + l.count, 0n);
      if (inLots !== c.issued)
        errors.push({ rule: 'ISSUED_MATCHES_LOTS', severity: 'error', message: `${code}: ${c.issued} shares issued but ${inLots} held` });
    }
    for (const l of this.open) {
      if (l.count <= 0n) errors.push({ rule: 'POSITIVE_LOTS', severity: 'error', message: `A lot of ${l.count} shares` });
      if (this.numbered && (l.from === null || l.to === null || rangeSize({ from: l.from, to: l.to }) !== l.count))
        errors.push({ rule: 'LOT_RANGE', severity: 'error', message: `A lot of ${l.count} shares without matching share numbers` });
    }
    if (this.numbered) {
      const sorted = [...this.open].sort((a, b) => (a.from! < b.from! ? -1 : a.from! > b.from! ? 1 : 0));
      for (let i = 1; i < sorted.length; i++)
        if (sorted[i]!.from! <= sorted[i - 1]!.to!)
          errors.push({
            rule: 'UNIQUE_SHARE_NUMBERS',
            severity: 'error',
            message: `Share number ${sorted[i]!.from} is held by both ${this.holderName(sorted[i - 1]!.holderId)} and ${this.holderName(sorted[i]!.holderId)}`,
          });
    }
    if (this.config.settings.capitalMode === 'nominal') {
      let expected = 0n;
      for (const c of this.classes.values()) expected += this.nominalMinor(c, c.issued) ?? 0n;
      if (expected !== this.shareCapital)
        errors.push({
          rule: 'SHARE_CAPITAL',
          severity: 'error',
          message: `The share capital (${this.shareCapital} minor units) does not equal the shares times their nominal value (${expected})`,
        });
    }
    for (const v of this.config.rulePack.checkCapital({
      shareCapital: this.shareCapital,
      totalShares: this.totalShares,
      currency: this.config.currency,
      settings: this.config.settings,
    })) {
      if (v.severity === 'error') errors.push(v);
      else this.warnings.push({ ...v, transactionId: this.current.id });
    }
    for (const p of this.openPledges()) {
      const held = this.open.filter((l) => l.holderId === p.holderId && l.classCode === p.classCode).reduce((s, l) => s + l.count, 0n);
      if (held < this.pledgedCount(p.holderId, p.classCode))
        errors.push({
          rule: 'PLEDGE_EXCEEDS_HOLDING',
          severity: 'error',
          message: `${this.holderName(p.holderId)} has more pledged than held`,
        });
    }
    if (errors.length) throw new LedgerError(errors);
  }
}

export function sortForReplay(items: LedgerTx[]): LedgerTx[] {
  return [...items].sort((a, b) =>
    a.tx.effectiveDate < b.tx.effectiveDate ? -1 : a.tx.effectiveDate > b.tx.effectiveDate ? 1 : a.seq - b.seq,
  );
}

export interface ReplayOk {
  ok: true;
  ledger: Ledger;
  warnings: Violation[];
}

export interface ReplayFailed {
  ok: false;
  ledger: Ledger;
  failedAt: LedgerTx;
  errors: Violation[];
  warnings: Violation[];
}

/** Replays transactions in effective order, up to and including `until` when given. Stops at the first broken rule. */
export function replay(items: LedgerTx[], config: EngineConfig, opts: { until?: string } = {}): ReplayOk | ReplayFailed {
  const ledger = new Ledger(config);
  for (const item of sortForReplay(items)) {
    if (opts.until && item.tx.effectiveDate > opts.until) break;
    try {
      ledger.apply(item);
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      return {
        ok: false,
        ledger,
        failedAt: item,
        errors: error.violations.map((v) => ({ ...v, transactionId: item.id })),
        warnings: ledger.warnings,
      };
    }
  }
  return { ok: true, ledger, warnings: [...config.rulePack.checkSettings(config.settings), ...ledger.warnings] };
}
