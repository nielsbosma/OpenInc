import type { PricedRoundStep } from '@openinc/shared';
import { DEC_SCALE, formatDec, parseDec } from '../registry/decimal.ts';
import { amountAt, ceilDiv, discounted, HUNDRED, max, min, pctOf, priceOf, sum, unitsFor } from './math.ts';
import { accrued, type CapClass, type CapState, type UnpricedHolding, unallocated } from './state.ts';
import { fullyDilutedTotal, positions } from './table.ts';

export interface Conversion {
  id: string;
  stakeholderId: string;
  /** Minor units converted, interest included. */
  amount: string;
  pricePerShare: string;
  units: string;
  basis: 'cap' | 'discount' | 'round';
  /** The later instrument whose terms a most-favoured-nation clause took. */
  mfnFrom: string | null;
}

export interface RoundResult {
  name: string;
  date: string;
  classCode: string;
  pricePerShare: string;
  preMoney: string;
  postMoney: string;
  raised: string;
  preFullyDiluted: string;
  postFullyDiluted: string;
  investments: { stakeholderId: string; name: string; amount: string; units: string; invested: string }[];
  conversions: Conversion[];
  pool: { planId: string; topUp: string; unallocatedAfter: string; pctAfter: string } | null;
  proRata: { stakeholderId: string; name: string; pctBefore: string; pctAfter: string; unitsToKeep: string; amountToKeep: string }[];
}

/** Down-round protection: adjusts the conversion price of protected classes when new units go out below it. */
export function applyAntiDilution(
  s: CapState,
  issuedClass: string,
  price: bigint,
  added: bigint,
  before: { total: bigint; byClass: Map<string, bigint> },
) {
  for (const c of s.classes.values()) {
    if (c.code === issuedClass || c.antiDilution === 'none' || c.conversionPrice === 0n || price >= c.conversionPrice) continue;
    if (c.antiDilution === 'full_ratchet') c.conversionPrice = price;
    else {
      const a = c.antiDilution === 'broad_weighted_average' ? before.total : (before.byClass.get(c.code) ?? 0n);
      const b = (added * price) / c.conversionPrice;
      if (a + added > 0n) c.conversionPrice = (c.conversionPrice * (a + b)) / (a + added);
    }
  }
}

export function issuedUnits(s: CapState) {
  const byClass = new Map<string, bigint>();
  for (const h of s.holdings) byClass.set(h.classCode, (byClass.get(h.classCode) ?? 0n) + h.units);
  return { total: sum([...byClass.values()]), byClass };
}

export function addHolding(s: CapState, stakeholderId: string, classCode: string, units: bigint) {
  const h = s.holdings.find((x) => x.stakeholderId === stakeholderId && x.classCode === classCode);
  if (h) h.units += units;
  else s.holdings.push({ stakeholderId, classCode, units });
}

export function ensureParty(s: CapState, id: string, details?: { name: string; kind: 'person' | 'company' | 'estate' | 'joint' }) {
  if (s.parties.has(id)) return;
  s.parties.set(id, { id, name: details?.name ?? 'New Stakeholder', kind: details?.kind ?? 'company', groupId: null, inRegister: false });
}

const pct = (v: string | number) => parseDec(String(v));

/** A most-favoured-nation instrument takes the best cap and discount of any instrument signed after it. */
export function withMfn(s: CapState, u: UnpricedHolding): UnpricedHolding & { mfnFrom: string | null } {
  if (!u.mfn) return { ...u, mfnFrom: null };
  let best = { ...u, mfnFrom: null as string | null };
  for (const later of s.unpriced) {
    if (later.id === u.id || later.signedOn <= u.signedOn) continue;
    const cap = later.valuationCap !== null && (best.valuationCap === null || later.valuationCap < best.valuationCap);
    const discount = later.discountPct > best.discountPct;
    if (cap || discount)
      best = {
        ...best,
        valuationCap: cap ? later.valuationCap : best.valuationCap,
        discountPct: discount ? later.discountPct : best.discountPct,
        mfnFrom: later.id,
      };
  }
  return best;
}

/**
 * Applies a priced round to the state in place and says what it did. The pre-money valuation covers the
 * fully diluted capitalization including converting instruments and the pool top-up (the "option pool
 * shuffle"), so the new money alone sets the investors' stake. Post-money SAFEs measure their cap against
 * the capitalization including all converting SAFEs; pre-money SAFEs and loans against the capitalization
 * before them. Conversion takes the lower of the cap price and the discounted round price.
 */
export function applyRound(s: CapState, step: Omit<PricedRoundStep, 'kind'>, newIds: string[]): RoundResult {
  const digits = s.digits;
  const base = fullyDilutedTotal(s, true);
  const converting = s.unpriced.filter((u) => !step.convertIds || step.convertIds.includes(u.id)).map((u) => withMfn(s, u));
  const amounts = converting.map((u) => (u.kind === 'note' ? accrued(u, step.date) : u.principal));
  const investments = step.investments.map((inv, i) => ({
    id: inv.stakeholderId ?? newIds[i]!,
    amount: BigInt(inv.amount),
    details: inv.newInvestor,
  }));
  const raised = sum(investments.map((i) => i.amount));
  const target = step.poolTargetPct === null ? null : pct(step.poolTargetPct);
  const poolPlan =
    s.pools.find((p) => p.planId === step.poolPlanId) ??
    s.pools.find((p) => p.kind === 'option') ??
    s.pools.find((p) => p.kind !== 'virtual') ??
    null;
  const existingUnalloc = poolPlan ? unallocated(poolPlan) : 0n;

  const fixedPrice = step.pricePerShare === undefined ? null : parseDec(String(step.pricePerShare));
  const preMoney = step.preMoney === undefined ? null : BigInt(step.preMoney);

  let price = fixedPrice ?? (preMoney !== null && base > 0n ? priceOf(preMoney, base, digits) : DEC_SCALE);
  let conv: { units: bigint; price: bigint; basis: Conversion['basis'] }[] = converting.map(() => ({
    units: 0n,
    price: 0n,
    basis: 'round',
  }));
  let topUp = 0n;
  let newUnits = 0n;
  let last = '';
  for (let iter = 0; iter < 200; iter++) {
    const safeTotal = sum(conv.map((c) => c.units));
    conv = converting.map((u, i) => {
      const options: { price: bigint; basis: Conversion['basis'] }[] = [{ price, basis: 'round' }];
      if (u.discountPct > 0n) options.push({ price: discounted(price, u.discountPct), basis: 'discount' });
      if (u.valuationCap !== null) {
        const capBase = u.postMoney ? base + safeTotal : base;
        if (capBase > 0n) options.push({ price: priceOf(u.valuationCap, capBase, digits), basis: 'cap' });
      }
      const best = options.reduce((a, b) => (b.price < a.price ? b : a));
      return { ...best, units: unitsFor(amounts[i]!, best.price, digits) };
    });
    const safeUnits = sum(conv.map((c) => c.units));
    newUnits = sum(investments.map((i) => unitsFor(i.amount, price, digits)));
    if (target !== null && target < HUNDRED) {
      const basis = step.poolBasis === 'post' ? base + safeUnits + newUnits : base + safeUnits;
      const wanted = ceilDiv(target * basis - existingUnalloc * HUNDRED, HUNDRED - target);
      topUp = max(0n, wanted);
    }
    const next = fixedPrice ?? (preMoney !== null ? priceOf(preMoney, base + safeUnits + topUp, digits) : price);
    const signature = `${next}|${safeUnits}|${topUp}`;
    price = next;
    if (signature === last) break;
    last = signature;
  }

  const preFd = base + sum(conv.map((c) => c.units)) + topUp;
  const fdBefore = positions(s, true);
  const fdTotalBefore = base;

  let cls = s.classes.get(step.classCode);
  const before = issuedUnits(s);
  if (!cls) {
    cls = {
      code: step.classCode,
      name: step.className || step.classCode,
      votesPerShare: parseDec(String(step.votesPerShare)),
      unitsPerShare: 1n,
      seniorityRank: step.seniorityRank,
      liqPrefMultiple: parseDec(String(step.liqPrefMultiple)),
      liqPrefCapMultiple: step.liqPrefCapMultiple === null ? null : parseDec(String(step.liqPrefCapMultiple)),
      participation: step.participation,
      antiDilution: step.antiDilution,
      issuePrice: price,
      conversionPrice: price,
    } satisfies CapClass;
    s.classes.set(cls.code, cls);
  } else if (cls.issuePrice === 0n) {
    cls.issuePrice = price;
    cls.conversionPrice = price;
  }

  const investmentRows = investments.map((inv) => {
    ensureParty(s, inv.id, inv.details);
    const units = unitsFor(inv.amount, price, digits);
    addHolding(s, inv.id, cls.code, units);
    return {
      stakeholderId: inv.id,
      name: s.parties.get(inv.id)!.name,
      amount: inv.amount.toString(),
      units: units.toString(),
      invested: amountAt(units, price, digits).toString(),
    };
  });
  const conversions: Conversion[] = converting.map((u, i) => {
    addHolding(s, u.stakeholderId, cls.code, conv[i]!.units);
    return {
      id: u.id,
      stakeholderId: u.stakeholderId,
      amount: amounts[i]!.toString(),
      pricePerShare: formatDec(conv[i]!.price),
      units: conv[i]!.units.toString(),
      basis: conv[i]!.basis,
      mfnFrom: u.mfnFrom,
    };
  });
  const convertedIds = new Set(converting.map((u) => u.id));
  s.unpriced = s.unpriced.filter((u) => !convertedIds.has(u.id));

  let pool: RoundResult['pool'] = null;
  if (target !== null) {
    let plan = poolPlan;
    if (!plan) {
      plan = {
        planId: 'pool:new',
        name: 'Option Pool',
        kind: 'option',
        classCode: [...s.classes.keys()][0] ?? cls.code,
        size: 0n,
        used: 0n,
      };
      s.pools.push(plan);
    }
    plan.size += topUp;
    pool = { planId: plan.planId, topUp: topUp.toString(), unallocatedAfter: unallocated(plan).toString(), pctAfter: '' };
  }

  const added = issuedUnits(s).total - before.total;
  applyAntiDilution(s, cls.code, price, added, before);
  s.lastRound = { price, date: step.date, classCode: cls.code };

  const postFd = fullyDilutedTotal(s, true);
  if (pool) pool.pctAfter = formatDec(pctOf(BigInt(pool.unallocatedAfter), postFd), 6);

  const proRata = step.proRataIds.map((id) => {
    const r = fdBefore.rows.get(id);
    const mine = r ? r.converted + r.awards : 0n;
    const after = positions(s, true).rows.get(id);
    const mineAfter = after ? after.converted + after.awards : 0n;
    const keepPct = pctOf(mine, fdTotalBefore);
    const unitsToKeep = max(0n, ceilDiv(keepPct * postFd - mineAfter * HUNDRED, HUNDRED - min(keepPct, HUNDRED - 1n)));
    return {
      stakeholderId: id,
      name: s.parties.get(id)?.name ?? 'Unknown',
      pctBefore: formatDec(keepPct, 6),
      pctAfter: formatDec(pctOf(mineAfter, postFd), 6),
      unitsToKeep: unitsToKeep.toString(),
      amountToKeep: amountAt(unitsToKeep, price, digits).toString(),
    };
  });

  const preMoneyValue = preMoney ?? amountAt(preFd, price, digits);
  return {
    name: step.name,
    date: step.date,
    classCode: cls.code,
    pricePerShare: formatDec(price),
    preMoney: preMoneyValue.toString(),
    postMoney: (preMoneyValue + raised).toString(),
    raised: raised.toString(),
    preFullyDiluted: preFd.toString(),
    postFullyDiluted: postFd.toString(),
    investments: investmentRows,
    conversions,
    pool,
    proRata,
  };
}
