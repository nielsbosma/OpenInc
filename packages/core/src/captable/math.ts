import { DEC_SCALE, divRound } from '../registry/decimal.ts';

/** Prices are scaled decimals (10 places) in major units; money is integer minor units; counts are units. */

export const HUNDRED = 100n * DEC_SCALE;

export const pow10 = (digits: number) => 10n ** BigInt(digits);

export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error('Division by zero');
  return a <= 0n ? -(-a / b) : (a + b - 1n) / b;
}

export const max = (a: bigint, b: bigint) => (a > b ? a : b);
export const min = (a: bigint, b: bigint) => (a < b ? a : b);
export const sum = (xs: bigint[]) => xs.reduce((s, x) => s + x, 0n);

/** Minor units bought by `units` at a scaled major-unit price, rounded half up. */
export function amountAt(units: bigint, price: bigint, digits: number): bigint {
  return divRound(units * price * pow10(digits), DEC_SCALE);
}

/** Whole units an amount (minor units) buys at a scaled price, rounded down. */
export function unitsFor(amount: bigint, price: bigint, digits: number): bigint {
  if (price <= 0n) return 0n;
  return (amount * DEC_SCALE) / (price * pow10(digits));
}

/** A scaled major-unit price from an amount (minor units) over a number of units, rounded half up. */
export function priceOf(amount: bigint, units: bigint, digits: number): bigint {
  if (units <= 0n) return 0n;
  return divRound(amount * DEC_SCALE, units * pow10(digits));
}

/** price × (100 − pct) / 100, both scaled. */
export function discounted(price: bigint, pct: bigint): bigint {
  return (price * (HUNDRED - pct)) / HUNDRED;
}

/** part / whole as a scaled percentage. */
export function pctOf(part: bigint, whole: bigint): bigint {
  if (whole === 0n) return 0n;
  return divRound(part * HUNDRED, whole);
}

/**
 * Splits `total` in proportion to `weights` so the parts sum to exactly `total`: floors first, then the
 * remainder one unit at a time to the largest fractions (earlier entries win ties).
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  const whole = sum(weights);
  if (total <= 0n || whole <= 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (total * w) / whole);
  let left = total - sum(parts);
  const order = weights
    .map((w, i) => ({ i, frac: (total * w) % whole }))
    .sort((a, b) => (a.frac === b.frac ? a.i - b.i : a.frac > b.frac ? -1 : 1));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i]! += 1n;
    left -= 1n;
  }
  return parts;
}

const parts = (date: string) => date.split('-').map(Number) as [number, number, number];

/** Whole calendar months from `from` to `to`; a month counts once its day of the month is reached. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export const minDate = (a: string, b: string) => (a < b ? a : b);
