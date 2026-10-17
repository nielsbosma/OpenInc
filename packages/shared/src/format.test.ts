import { describe, expect, it } from 'vitest';
import { formatMoney, parseMoney } from './format.ts';
import { companySettings, settingEnvName } from './schemas/settings.ts';

describe('money', () => {
  it('formats minor units without floats', () => {
    expect(formatMoney(123456789n, 'USD', 'en-US')).toBe('$1,234,567.89');
    expect(formatMoney(-5n, 'EUR', 'en-US')).toBe('-€0.05');
    expect(formatMoney(1500n, 'JPY', 'en-US')).toBe('¥1,500');
  });

  it('parses amounts to minor units', () => {
    expect(parseMoney('1 234,50', 'SEK')).toBe(123450n);
    expect(parseMoney('1,234.5', 'USD')).toBe(123450n);
    expect(parseMoney('-0.05', 'EUR')).toBe(-5n);
    expect(() => parseMoney('1.2345', 'USD')).toThrow();
    expect(() => parseMoney('abc', 'USD')).toThrow();
  });
});

describe('settings', () => {
  it('names env pins after group and field', () => {
    expect(settingEnvName('ai', 'apiKey')).toBe('OPENINC_AI_API_KEY');
    expect(settingEnvName('errorTracking', 'dsn')).toBe('OPENINC_ERROR_TRACKING_DSN');
  });

  it('validates company details', () => {
    expect(companySettings.safeParse({ name: 'Acme', country: 'se', currency: 'sek', timeZone: 'Europe/Stockholm' }).success).toBe(true);
    expect(companySettings.safeParse({ name: 'Acme', country: 'XX', currency: 'SEK', timeZone: 'Europe/Stockholm' }).success).toBe(false);
    expect(companySettings.safeParse({ name: 'Acme', country: 'SE', currency: 'SEK', timeZone: 'Mars/Base' }).success).toBe(false);
  });
});
