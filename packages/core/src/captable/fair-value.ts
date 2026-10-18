/**
 * Black-Scholes value of a call: the usual starting point for the market value of an option or warrant
 * (Swedish warrants, BSPCE, EMI). Floating point is fine here; the result is an estimate rounded for display.
 */

function normCdf(x: number): number {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export interface FairValue {
  value: number;
  intrinsic: number;
  d1: number;
  d2: number;
}

export function blackScholes(p: {
  share: number;
  strike: number;
  years: number;
  volatility: number;
  riskFree: number;
  dividend: number;
}): FairValue {
  const { share: S, strike: K, years: T, volatility: v, riskFree: r, dividend: q } = p;
  const intrinsic = Math.max(0, S - K);
  if (S <= 0) return { value: 0, intrinsic: 0, d1: 0, d2: 0 };
  if (K <= 0) return { value: S * Math.exp(-q * T), intrinsic, d1: Infinity, d2: Infinity };
  if (v <= 0 || T <= 0) return { value: Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T)), intrinsic, d1: 0, d2: 0 };
  const d1 = (Math.log(S / K) + (r - q + (v * v) / 2) * T) / (v * Math.sqrt(T));
  const d2 = d1 - v * Math.sqrt(T);
  const value = S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
  return { value: Math.max(0, value), intrinsic, d1, d2 };
}
