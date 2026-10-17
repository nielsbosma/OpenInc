import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '../env.ts';

const keys = new Map<string, Buffer>();

/** Separate keys per purpose, all derived from APP_SECRET, so one secret is enough to configure. */
function derivedKey(purpose: 'encryption' | 'signing' | 'setup'): Buffer {
  let key = keys.get(purpose);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', getEnv().APP_SECRET, 'openinc', `openinc:${purpose}:v1`, 32));
    keys.set(purpose, key);
  }
  return key;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey('encryption'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', derivedKey('encryption'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** A tamper-proof, expiring token with a small JSON payload. */
export function sign(payload: object, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })).toString('base64url');
  return `${body}.${createHmac('sha256', derivedKey('signing')).update(body).digest('base64url')}`;
}

export function verifySigned<T extends object>(token: string): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  if (!safeEqual(mac, createHmac('sha256', derivedKey('signing')).update(body).digest('base64url'))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T & { exp: number };
  return payload.exp > Date.now() ? payload : null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * The one-time code that unlocks the setup wizard, printed in the container log. Derived from
 * APP_SECRET, so every container of an install shows the same code and nothing is stored.
 */
export function setupCode(): string {
  const digest = createHmac('sha256', derivedKey('setup')).update('first-run').digest();
  let code = '';
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[digest[i]! % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function checkSetupCode(input: string): boolean {
  const normalized = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return safeEqual(normalized, setupCode().replace('-', ''));
}
