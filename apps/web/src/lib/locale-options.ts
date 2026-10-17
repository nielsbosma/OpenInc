import { COUNTRY_CODES, countryName } from '@openinc/shared';
import type { ComboboxOption } from '@/components/Combobox';

let countries: ComboboxOption[] | undefined;
let currencies: ComboboxOption[] | undefined;
let timeZones: ComboboxOption[] | undefined;

export function countryOptions(): ComboboxOption[] {
  countries ??= COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code), hint: code })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  return countries;
}

export function currencyOptions(): ComboboxOption[] {
  if (!currencies) {
    const names = new Intl.DisplayNames(['en'], { type: 'currency' });
    currencies = Intl.supportedValuesOf('currency').map((code) => ({ value: code, label: `${code} · ${names.of(code) ?? code}` }));
  }
  return currencies;
}

function offset(timeZone: string): string {
  const part = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? '';
}

export function timeZoneOptions(): ComboboxOption[] {
  timeZones ??= [...Intl.supportedValuesOf('timeZone'), 'UTC'].map((tz) => ({ value: tz, label: tz.replace(/_/g, ' '), hint: offset(tz) }));
  return timeZones;
}

/** Guesses sensible defaults from the browser for a new install. */
export function browserDefaults(): { country: string; currency: string; timeZone: string } {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const region = new Intl.Locale(navigator.language).maximize().region ?? 'US';
  const currencyByRegion: Record<string, string> = {
    SE: 'SEK',
    NO: 'NOK',
    DK: 'DKK',
    FI: 'EUR',
    DE: 'EUR',
    FR: 'EUR',
    NL: 'EUR',
    ES: 'EUR',
    IT: 'EUR',
    IE: 'EUR',
    AT: 'EUR',
    BE: 'EUR',
    PT: 'EUR',
    GB: 'GBP',
    US: 'USD',
    CA: 'CAD',
    AU: 'AUD',
    NZ: 'NZD',
    CH: 'CHF',
    JP: 'JPY',
    IN: 'INR',
    SG: 'SGD',
    BR: 'BRL',
  };
  return { country: COUNTRY_CODES.includes(region) ? region : 'US', currency: currencyByRegion[region] ?? 'USD', timeZone };
}
