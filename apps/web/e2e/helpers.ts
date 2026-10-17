import { createHmac, hkdfSync } from 'node:crypto';

export const MAILPIT = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';
/** The SMTP host as the app sees it: localhost for `pnpm dev`, `mailpit` inside Compose. */
export const SMTP_HOST = process.env.E2E_SMTP_HOST ?? 'localhost';

/** Same derivation as packages/core/src/lib/crypto.ts `setupCode()`; the code is otherwise only in the container log. */
export function setupCode(appSecret = process.env.APP_SECRET ?? 'dev-only-secret-do-not-use-in-production-0123456789'): string {
  const key = Buffer.from(hkdfSync('sha256', appSecret, 'openinc', 'openinc:setup:v1', 32));
  const digest = createHmac('sha256', key).update('first-run').digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[digest[i]! % alphabet.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of text.replace(/\s|=/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

let lastStep = 0;

/** A code the server has not seen yet: it refuses a code from a time step that was already used. */
export async function freshTotp(secret: string): Promise<string> {
  for (;;) {
    const current = Math.floor(Date.now() / 30_000);
    const step = Math.max(current - 1, lastStep + 1);
    if (step <= current + 1) {
      lastStep = step;
      return totp(secret, step * 30_000);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Waits for an email to arrive in Mailpit and returns its first link. */
export async function linkFromLatestEmail(to: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const body = (await res.json()) as { messages: { ID: string }[] };
    if (body.messages.length) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${body.messages[0]!.ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email to ${to} arrived in Mailpit`);
}
