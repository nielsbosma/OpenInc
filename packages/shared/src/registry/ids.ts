function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Swedish personnummer or samordningsnummer: YYYYMMDD-NNNN, YYMMDD-NNNN or YYMMDD+NNNN. */
export function isSwedishPersonalNumber(value: string): boolean {
  const m = /^(\d{2})?(\d{2})(\d{2})(\d{2})[-+]?(\d{4})$/.exec(value.trim());
  if (!m) return false;
  const [, century, yy, mm, dd, rest] = m;
  const day = Number(dd) > 60 ? Number(dd) - 60 : Number(dd);
  const year = century ? Number(`${century}${yy}`) : 2000 + Number(yy);
  const okDate = validDate(year, Number(mm), day) || (!century && validDate(1900 + Number(yy), Number(mm), day));
  return okDate && luhnValid(`${yy}${mm}${dd}${rest}`);
}

/** Swedish organisationsnummer: NNNNNN-NNNN (optionally prefixed 16). The third digit is 2 or more. */
export function isSwedishOrgNumber(value: string): boolean {
  const m = /^(16)?(\d{6})-?(\d{4})$/.exec(value.trim());
  if (!m) return false;
  const digits = `${m[2]}${m[3]}`;
  return Number(digits[2]) >= 2 && luhnValid(digits);
}

/** ISO 17442 check digits (mod 97). */
export function isLei(value: string): boolean {
  if (!/^[A-Z0-9]{18}\d{2}$/.test(value)) return false;
  const numeric = value.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
