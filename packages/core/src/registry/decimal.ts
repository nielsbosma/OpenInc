/** Fixed-point decimals with 10 places, matching `numeric(24, 10)` columns. */
export const DEC_PLACES = 10;
export const DEC_SCALE = 10n ** BigInt(DEC_PLACES);

export function parseDec(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(DEC_PLACES) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`Not a decimal: ${value}`);
  const fraction = (m[3] ?? '').slice(0, DEC_PLACES).padEnd(DEC_PLACES, '0');
  const scaled = BigInt(m[2]!) * DEC_SCALE + BigInt(fraction);
  return m[1] ? -scaled : scaled;
}

export function formatDec(scaled: bigint, maxPlaces = DEC_PLACES): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / DEC_SCALE;
  const fraction = (abs % DEC_SCALE).toString().padStart(DEC_PLACES, '0').slice(0, maxPlaces).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** a / b rounded half up, for non-negative values. */
export function divRound(a: bigint, b: bigint): bigint {
  return (a * 2n + b) / (b * 2n);
}

/** A per-share price in major units times a count, in minor units, rounded half up. */
export function amountMinor(pricePerShare: bigint, count: bigint, currencyDigits: number): bigint {
  return divRound(pricePerShare * count * 10n ** BigInt(currencyDigits), DEC_SCALE);
}

/** Minor units divided by a count, as a scaled decimal in major units. */
export function perShare(minor: bigint, count: bigint, currencyDigits: number): bigint {
  if (count === 0n) return 0n;
  return divRound(minor * DEC_SCALE, count * 10n ** BigInt(currencyDigits));
}

/** part / whole as a percentage, rounded half up to six places. */
export function percent(part: bigint, whole: bigint): string {
  if (whole === 0n) return '0';
  const sixPlaces = divRound(part * 100n * 1_000_000n, whole);
  return formatDec(sixPlaces * (DEC_SCALE / 1_000_000n), 6);
}

export function toBig(value: string | number): bigint {
  return typeof value === 'number' ? BigInt(value) : BigInt(value.trim());
}
