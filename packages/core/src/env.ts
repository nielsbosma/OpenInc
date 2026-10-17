import { readFileSync } from 'node:fs';
import type { SystemProblem } from '@openinc/shared';
import { z } from 'zod';

/**
 * The only configuration that comes from the environment: the two required connections and the
 * encryption key. Everything else is in Admin settings.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must start with postgres://'),
  S3_ENDPOINT: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .pipe(z.url().optional()),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z
    .string()
    .optional()
    .transform((v) => v?.trim() || 'us-east-1'),
  APP_SECRET: z.string().min(32, 'must be at least 32 characters (use `openssl rand -base64 48`)'),
  APP_URL: z
    .string()
    .optional()
    .transform((v) => v?.trim().replace(/\/+$/, '') || undefined)
    .pipe(z.url().optional()),
  PORT: z.coerce.number().int().default(3000),
  ROLE: z.enum(['all', 'web', 'worker']).default('all'),
});

export type Env = z.infer<typeof schema>;

const HINTS: Record<string, string> = {
  DATABASE_URL: 'The connection string of an empty Postgres database, e.g. postgres://user:password@host:5432/openinc',
  S3_BUCKET: 'The name of the S3-compatible bucket OpenInc stores files and backups in',
  S3_ACCESS_KEY: 'An access key with read and write access to the bucket',
  S3_SECRET_KEY: 'The secret that belongs to S3_ACCESS_KEY',
  S3_ENDPOINT: 'Leave empty for AWS S3; set it for R2, MinIO and others, e.g. https://<account>.r2.cloudflarestorage.com',
  APP_SECRET: 'A long random string that encrypts stored credentials. Generate one with `openssl rand -base64 48` and never change it.',
  APP_URL: 'The public address, e.g. https://openinc.example.com. Optional: worked out from requests when empty.',
};

let cached: Env | undefined;

export function readEnv(source: NodeJS.ProcessEnv = process.env): { env: Env | null; problems: SystemProblem[] } {
  const parsed = schema.safeParse(source);
  if (parsed.success) return { env: parsed.data, problems: [] };
  return {
    env: null,
    problems: parsed.error.issues.map((issue) => {
      const name = String(issue.path[0] ?? 'environment');
      const missing = source[name] === undefined || source[name] === '';
      return {
        area: 'config' as const,
        message: missing ? `${name} is not set` : `${name} ${issue.message}`,
        hint: HINTS[name],
      };
    }),
  };
}

export function getEnv(): Env {
  if (!cached) {
    const { env, problems } = readEnv();
    if (!env) throw new Error(`Invalid environment:\n${problems.map((p) => `  ${p.message}`).join('\n')}`);
    cached = env;
  }
  return cached;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';

/** Loads `.env` and `.env.local` from the repository root in development. Production reads real env vars only. */
export function loadDevEnv(root: URL): void {
  if (process.env.NODE_ENV === 'production') return;
  for (const name of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(new URL(name, root));
    } catch {}
  }
  process.env.NODE_ENV ??= 'development';
}

let version: string | undefined;

/** Set by the image build (OPENINC_VERSION); in development it is the root package.json version. */
export function appVersion(): string {
  if (!version) {
    version = process.env.OPENINC_VERSION?.trim();
    if (!version) {
      try {
        version = (JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }).version;
      } catch {
        version = '0.0.0';
      }
    }
  }
  return version;
}

let fallbackUrl: string | undefined;

/** The public base URL. APP_URL wins; otherwise the first request's origin is remembered. */
export function appUrl(): string {
  return getEnv().APP_URL ?? fallbackUrl ?? `http://localhost:${getEnv().PORT}`;
}

export function rememberRequestOrigin(origin: string): void {
  fallbackUrl ??= origin.replace(/\/+$/, '');
}
