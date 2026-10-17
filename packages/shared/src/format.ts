/**
 * Display helpers. Amounts are integer minor units (bigint); time zone and currency come from Company
 * settings. The UI is English-only, so formatting uses en-GB rather than the browser's locale.
 */
export const UI_LOCALE = 'en-GB';

export function currencyDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(minor: bigint, currency: string, locale = UI_LOCALE): string {
  const digits = currencyDigits(currency);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const scale = 10n ** BigInt(digits);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(digits, '0');
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits });
  const parts = formatter.formatToParts(0).map((p) => {
    if (p.type === 'integer') return new Intl.NumberFormat(locale, { useGrouping: true }).format(whole);
    if (p.type === 'fraction') return fraction;
    return p.value;
  });
  const text = parts.join('');
  return negative ? `-${text}` : text;
}

export function parseMoney(input: string, currency: string): bigint {
  const digits = currencyDigits(currency);
  const cleaned = input.replace(/[\s ]/g, '').replace(/[^\d.,-]/g, '');
  const match = /^(-)?(\d+)(?:[.,](\d+))?$/.exec(cleaned.replace(/[.,](?=\d{3}(\D|$))/g, ''));
  if (!match) throw new Error(`Not an amount: ${input}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > digits) throw new Error(`${currency} has ${digits} decimals`);
  const minor = BigInt(whole!) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  return sign ? -minor : minor;
}

export function formatNumber(value: bigint | number, locale = UI_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatDateTime(value: Date | string, timeZone?: string, locale = UI_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** Calendar dates are `YYYY-MM-DD` strings with no time zone. */
export function formatDate(value: Date | string, timeZone?: string, locale = UI_LOCALE): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
  }
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium' }).format(new Date(value));
}

export function formatRelative(value: Date | string, now = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(value).getTime()) / 1000);
  if (seconds < -45) {
    const ahead = -seconds;
    if (ahead < 3600) return `in ${Math.round(ahead / 60)} min`;
    if (ahead < 86_400) return `in ${Math.round(ahead / 3600)} h`;
    return `in ${Math.round(ahead / 86_400)} d`;
  }
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
