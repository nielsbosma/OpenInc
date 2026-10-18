import { describe, expect, it } from 'vitest';
import { checkArticleLimits, registrySetupInputFor } from './index.ts';

const ab = { country: 'SE', legalForm: 'AB', currency: 'SEK' };
const publ = { country: 'SE', legalForm: 'AB_PUBL', currency: 'SEK' };
const limits = (minShareCapital: string | null, maxShareCapital: string | null, minShares: string | null, maxShares: string | null) => ({
  minShareCapital,
  maxShareCapital,
  minShares,
  maxShares,
});
const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('articles limits', () => {
  it('requires all four for a Swedish aktiebolag', () => {
    expect(fields(checkArticleLimits(ab, limits(null, null, null, null)))).toEqual([
      'minShareCapital',
      'maxShareCapital',
      'minShares',
      'maxShares',
    ]);
  });

  it('keeps them optional elsewhere', () => {
    expect(checkArticleLimits({ country: 'DE', legalForm: 'private', currency: 'EUR' }, limits(null, null, null, null))).toEqual([]);
    expect(checkArticleLimits({ country: 'SE', legalForm: 'private', currency: 'SEK' }, limits(null, null, null, null))).toEqual([]);
  });

  it('allows a fixed amount (min = max) and up to four times the minimum', () => {
    expect(checkArticleLimits(ab, limits('2500000', '2500000', '25000', '25000'))).toEqual([]);
    expect(checkArticleLimits(ab, limits('2500000', '10000000', '25000', '100000'))).toEqual([]);
  });

  it('refuses a maximum below the minimum, anywhere', () => {
    const issues = checkArticleLimits({ country: 'DE', legalForm: 'private', currency: 'EUR' }, limits('500', '400', '10', '5'));
    expect(fields(issues)).toEqual(['maxShareCapital', 'maxShares']);
    expect(issues[0]!.message).toBe("The maximum share capital can't be less than the minimum");
  });

  it('refuses a maximum over four times the minimum for a Swedish aktiebolag', () => {
    const issues = checkArticleLimits(ab, limits('2500000', '10000001', '25000', '100001'));
    expect(issues.map((i) => i.message)).toEqual([
      'The maximum share capital can be at most four times the minimum',
      'The maximum number of shares can be at most four times the minimum',
    ]);
    expect(checkArticleLimits({ country: 'DE', legalForm: 'private', currency: 'EUR' }, limits('1', '100', '1', '100'))).toEqual([]);
  });

  it('needs 25 000 SEK for a private and 500 000 SEK for a public aktiebolag', () => {
    expect(checkArticleLimits(ab, limits('2499900', '2500000', '1', '1'))[0]!.message).toBe(
      'A private aktiebolag needs a share capital of at least 25 000 SEK',
    );
    expect(checkArticleLimits(publ, limits('2500000', '10000000', '1', '1'))[0]!.message).toBe(
      'A public aktiebolag needs a share capital of at least 500 000 SEK',
    );
    expect(checkArticleLimits(publ, limits('50000000', '200000000', '1', '4'))).toEqual([]);
  });

  it('puts each issue on its field in the setup schema', () => {
    const result = registrySetupInputFor(ab).safeParse({ minShareCapital: '2500000', maxShareCapital: '2500000', minShares: '10' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.'))).toEqual(['maxShares']);
  });
});
