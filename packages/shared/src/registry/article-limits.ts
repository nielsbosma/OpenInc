import { SE_MIN_CAPITAL_SEK, SE_MIN_CAPITAL_SEK_PUBL } from './rule-packs.ts';

/** The company the share register is for: which rules apply to the articles' limits. */
export interface ArticleLimitsContext {
  country: string;
  legalForm: string;
  currency: string;
}

/** Share capital in minor units, share counts as integers; null when left empty. */
export interface ArticleLimits {
  minShareCapital: string | number | bigint | null;
  maxShareCapital: string | number | bigint | null;
  minShares: string | number | bigint | null;
  maxShares: string | number | bigint | null;
}

export type LimitField = keyof ArticleLimits;

const isSwedishAb = (c: ArticleLimitsContext) => c.country === 'SE' && (c.legalForm === 'AB' || c.legalForm === 'AB_PUBL');

/** Whether the articles' four limits must be filled in: a Swedish aktiebolag's articles always state them (ABL 3:1). */
export const articleLimitsRequired = (c: ArticleLimitsContext) => isSwedishAb(c);

function toBig(v: ArticleLimits[LimitField]): bigint | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

/**
 * The articles' limits on share capital and number of shares, checked for the company's country and legal form.
 * Used by the share register form and by registry.setup, so both say the same thing.
 */
export function checkArticleLimits(c: ArticleLimitsContext, limits: ArticleLimits): { field: LimitField; message: string }[] {
  const out: { field: LimitField; message: string }[] = [];
  const v = {
    minShareCapital: toBig(limits.minShareCapital),
    maxShareCapital: toBig(limits.maxShareCapital),
    minShares: toBig(limits.minShares),
    maxShares: toBig(limits.maxShares),
  };
  const swedish = isSwedishAb(c);
  if (swedish) {
    const missing: Record<LimitField, string> = {
      minShareCapital: 'Enter the minimum share capital',
      maxShareCapital: 'Enter the maximum share capital',
      minShares: 'Enter the minimum number of shares',
      maxShares: 'Enter the maximum number of shares',
    };
    for (const field of Object.keys(missing) as LimitField[]) if (v[field] === null) out.push({ field, message: missing[field] });
  }
  for (const [min, max, what] of [
    ['minShareCapital', 'maxShareCapital', 'share capital'],
    ['minShares', 'maxShares', 'number of shares'],
  ] as const) {
    const lo = v[min];
    const hi = v[max];
    if (lo !== null && lo <= 0n) out.push({ field: min, message: `The minimum ${what} must be more than zero` });
    if (lo === null || hi === null) continue;
    if (hi < lo) out.push({ field: max, message: `The maximum ${what} can't be less than the minimum` });
    else if (swedish && hi > lo * 4n) out.push({ field: max, message: `The maximum ${what} can be at most four times the minimum` });
  }
  if (swedish && c.currency === 'SEK' && v.minShareCapital !== null && v.minShareCapital > 0n) {
    const publ = c.legalForm === 'AB_PUBL';
    if (v.minShareCapital < (publ ? SE_MIN_CAPITAL_SEK_PUBL : SE_MIN_CAPITAL_SEK))
      out.push({
        field: 'minShareCapital',
        message: publ
          ? 'A public aktiebolag needs a share capital of at least 500 000 SEK'
          : 'A private aktiebolag needs a share capital of at least 25 000 SEK',
      });
  }
  return out;
}
