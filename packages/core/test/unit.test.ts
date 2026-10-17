import { ALL_PERMISSIONS, type Permission, permissionsFor } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { redact } from '../src/audit.ts';
import type { Actor, Ctx } from '../src/context.ts';
import { readEnv } from '../src/env.ts';
import { AppError } from '../src/errors.ts';
import { checkSetupCode, decrypt, encrypt, setupCode, sign, verifySigned } from '../src/lib/crypto.ts';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';
import { base32Encode, generateRecoveryCodes, totpAt, verifyTotp } from '../src/lib/totp.ts';
import { allServices, toolName } from '../src/registry.ts';
import { canAccess, defineService, invoke, isTool } from '../src/service.ts';

function actor(permissions: Iterable<Permission> = ALL_PERMISSIONS, extra: Partial<Actor> = {}): Actor {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    email: 'test@example.com',
    name: 'Test',
    role: 'admin',
    permissions: new Set(permissions),
    ...extra,
  };
}

const ctx = (a: Actor | null): Ctx => ({ db: {} as Ctx['db'], actor: a, surface: 'system' });

describe('totp', () => {
  // RFC 6238 appendix B, SHA-1, truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC test vectors', () => {
    expect(totpAt(secret, 59_000)).toBe('287082');
    expect(totpAt(secret, 1_111_111_109_000)).toBe('081804');
    expect(totpAt(secret, 2_000_000_000_000)).toBe('279037');
  });
  it('accepts one step of clock drift and no more', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now)).toBe(false);
  });
  it('makes distinct recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/);
  });
});

describe('crypto', () => {
  it('round-trips encrypted values and detects tampering', () => {
    const sealed = encrypt('smtp-password');
    expect(sealed).not.toContain('smtp-password');
    expect(decrypt(sealed)).toBe('smtp-password');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
  it('signs expiring tokens', () => {
    const token = sign({ a: 1 }, 60);
    expect(verifySigned<{ a: number }>(token)?.a).toBe(1);
    expect(verifySigned(`${token}x`)).toBeNull();
    expect(verifySigned(sign({ a: 1 }, -1))).toBeNull();
  });
  it('derives a stable setup code from APP_SECRET', () => {
    const code = setupCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(checkSetupCode(code.toLowerCase())).toBe(true);
    expect(checkSetupCode(code.replace('-', ' '))).toBe(true);
    expect(checkSetupCode('AAAA-AAAA')).toBe(code === 'AAAA-AAAA');
  });
});

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword('correct horse 1');
    const b = await hashPassword('correct horse 1');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse 1')).toBe(true);
    expect(await verifyPassword(a, 'wrong horse 1')).toBe(false);
    expect(await verifyPassword('garbage', 'x')).toBe(false);
  });
});

describe('env', () => {
  it('lists every missing variable with a hint instead of throwing', () => {
    const { env, problems } = readEnv({});
    expect(env).toBeNull();
    const names = problems.map((p) => p.message.split(' ')[0]);
    expect(names).toEqual(expect.arrayContaining(['DATABASE_URL', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'APP_SECRET']));
    expect(problems.every((p) => p.hint)).toBe(true);
  });
  it('accepts the minimal set', () => {
    const { env } = readEnv({
      DATABASE_URL: 'postgres://u:p@h/db',
      S3_BUCKET: 'b',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
      APP_SECRET: 'x'.repeat(32),
    });
    expect(env?.ROLE).toBe('all');
    expect(env?.S3_REGION).toBe('us-east-1');
  });
});

describe('audit redaction', () => {
  it('masks secrets but keeps that they were set', () => {
    expect(redact({ password: 'p', apiKey: '', nested: { token: 't', name: 'n' }, n: 5n })).toEqual({
      password: '••••',
      apiKey: '',
      nested: { token: '••••', name: 'n' },
      n: '5',
    });
  });
});

const echo = defineService({
  name: 'test.echo',
  description: 'Echo for tests',
  kind: 'query',
  access: 'users.read',
  input: z.object({ value: z.string().min(1) }),
  handler: async (_ctx, input) => input.value,
});

describe('service access', () => {
  it('runs for an actor with the permission', async () => {
    await expect(invoke(echo, ctx(actor(['users.read'])), { value: 'hi' })).resolves.toBe('hi');
  });
  it('refuses anonymous callers and missing permissions', async () => {
    await expect(invoke(echo, ctx(null), { value: 'hi' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(invoke(echo, ctx(actor(['files.read'])), { value: 'hi' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('validates input', async () => {
    const error = await invoke(echo, ctx(actor()), { value: '' }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('BAD_REQUEST');
  });
  it('blocks everything but the setup while two-factor is enforced and missing', async () => {
    const pending = ctx(actor(ALL_PERMISSIONS, { mustEnableTwoFactor: true }));
    await expect(invoke(echo, pending, { value: 'hi' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const setup = allServices.find((s) => s.name === 'account.beginTotpSetup')!;
    expect(setup.allowWithoutTwoFactor).toBe(true);
  });
});

describe('registry', () => {
  it('has unique service and tool names', () => {
    const names = allServices.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names.map((name) => toolName({ name }))).size).toBe(names.length);
  });
  it('never offers public services as tools', () => {
    expect(allServices.filter((s) => s.access === 'public' && isTool(s)).map((s) => s.name)).toEqual([]);
  });
  it('describes every service for MCP and the assistant', () => {
    for (const s of allServices) expect(s.description.length, s.name).toBeGreaterThan(15);
  });
  it('gives each role the tools its permissions allow', () => {
    const tools = (role: 'admin' | 'member' | 'readonly') =>
      allServices.filter((s) => isTool(s) && canAccess(s, ctx(actor(permissionsFor(role))))).map((s) => s.name);
    expect(tools('readonly')).toContain('users.list');
    expect(tools('readonly')).not.toContain('invites.create');
    expect(tools('member')).not.toContain('settings.update');
    expect(tools('admin')).toEqual(expect.arrayContaining(['invites.create', 'settings.update', 'audit.list']));
  });
});
