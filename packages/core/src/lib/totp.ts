import { createHmac, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), the variant every authenticator app supports. */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpAt(secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / STEP)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/**
 * Accepts the previous, current and next code to allow for clock drift. Returns the matching
 * time step, or null. Pass the last accepted step to refuse a code that was already used.
 */
export function matchTotp(secret: string, code: string, lastStep: number | null = null, time = Date.now()): number | null {
  const current = Math.floor(time / 1000 / STEP);
  for (const drift of [-1, 0, 1]) {
    const step = current + drift;
    if (lastStep !== null && step <= lastStep) continue;
    if (totpAt(secret, step * STEP * 1000) === code.trim()) return step;
  }
  return null;
}

export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  return matchTotp(secret, code, null, time) !== null;
}

export async function totpProvisioning(secret: string, account: string, issuer: string): Promise<{ uri: string; qrDataUrl: string }> {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
  return { uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}
