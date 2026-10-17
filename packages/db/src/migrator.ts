import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Applies the SQL files drizzle-kit generated, in journal order. Unlike drizzle's own migrator it
 * records which app version applied each migration (so an older image can refuse to start), runs each
 * migration in its own transaction, reports progress, and takes a backup first.
 */

export const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const LOCK_ID = 73_500_042;
const TABLE = 'public.openinc_migrations';

export interface Migration {
  idx: number;
  tag: string;
  hash: string;
  statements: string[];
}

export interface AppliedMigration {
  tag: string;
  hash: string;
  appVersion: string;
  appliedAt: Date;
}

export interface MigrationPlan {
  applied: AppliedMigration[];
  pending: Migration[];
  /** Applied by a newer image: this image does not know them. */
  unknown: AppliedMigration[];
}

export class DatabaseTooNewError extends Error {
  constructor(public readonly requiredVersion: string) {
    super(`The database was upgraded by OpenInc ${requiredVersion}. Run that version or newer.`);
    this.name = 'DatabaseTooNewError';
  }
}

export class MigrationFailedError extends Error {
  constructor(
    public readonly migration: string,
    cause: unknown,
  ) {
    super(`Migration ${migration} failed and was rolled back: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'MigrationFailedError';
  }
}

export function loadMigrations(folder = migrationsFolder): Migration[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map(({ idx, tag }) => {
      const sql = readFileSync(join(folder, `${tag}.sql`), 'utf8');
      return {
        idx,
        tag,
        hash: createHash('sha256').update(sql).digest('hex'),
        statements: sql
          .split('--> statement-breakpoint')
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });
}

async function ensureTable(client: pg.ClientBase) {
  await client.query(`create table if not exists ${TABLE} (
    tag text primary key,
    idx integer not null,
    hash text not null,
    app_version text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function readApplied(client: pg.ClientBase): Promise<AppliedMigration[]> {
  const exists = await client.query<{ t: string | null }>(`select to_regclass('${TABLE}') as t`);
  if (!exists.rows[0]?.t) return [];
  const { rows } = await client.query<{ tag: string; hash: string; app_version: string; applied_at: Date }>(
    `select tag, hash, app_version, applied_at from ${TABLE} order by idx`,
  );
  return rows.map((r) => ({ tag: r.tag, hash: r.hash, appVersion: r.app_version, appliedAt: r.applied_at }));
}

export async function planMigrations(client: pg.ClientBase, migrations = loadMigrations()): Promise<MigrationPlan> {
  const applied = await readApplied(client);
  const appliedTags = new Set(applied.map((a) => a.tag));
  const known = new Set(migrations.map((m) => m.tag));
  return {
    applied,
    pending: migrations.filter((m) => !appliedTags.has(m.tag)),
    unknown: applied.filter((a) => !known.has(a.tag)),
  };
}

export function requiredVersion(unknown: AppliedMigration[]): string {
  return (
    unknown
      .map((u) => u.appVersion)
      .sort(compareVersions)
      .at(-1) ?? 'a newer version'
  );
}

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return 0;
}

export interface MigrateOptions {
  connectionString: string;
  appVersion: string;
  migrations?: Migration[];
  /** Runs before the first pending migration when the database already has migrations. Return the backup's name. */
  backup?: () => Promise<string | null>;
  onProgress?: (
    event: { type: 'plan'; pending: string[] } | { type: 'backup'; key: string | null } | { type: 'start' | 'done'; tag: string },
  ) => void;
}

/**
 * Only one process migrates: the advisory lock makes a second container (or the worker) wait, then
 * find nothing left to do.
 */
export async function migrate(options: MigrateOptions): Promise<{ applied: string[]; backupKey: string | null }> {
  const migrations = options.migrations ?? loadMigrations();
  const client = new pg.Client({ connectionString: options.connectionString, application_name: 'openinc-migrator' });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);
    const plan = await planMigrations(client, migrations);
    if (plan.unknown.length) throw new DatabaseTooNewError(requiredVersion(plan.unknown));
    options.onProgress?.({ type: 'plan', pending: plan.pending.map((m) => m.tag) });
    if (plan.pending.length === 0) return { applied: [], backupKey: null };

    let backupKey: string | null = null;
    if (plan.applied.length > 0 && options.backup) {
      backupKey = await options.backup();
      options.onProgress?.({ type: 'backup', key: backupKey });
    }

    const applied: string[] = [];
    for (const m of plan.pending) {
      options.onProgress?.({ type: 'start', tag: m.tag });
      try {
        await client.query('begin');
        for (const statement of m.statements) await client.query(statement);
        await client.query(`insert into ${TABLE} (tag, idx, hash, app_version) values ($1, $2, $3, $4)`, [
          m.tag,
          m.idx,
          m.hash,
          options.appVersion,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw new MigrationFailedError(m.tag, error);
      }
      applied.push(m.tag);
      options.onProgress?.({ type: 'done', tag: m.tag });
    }
    return { applied, backupKey };
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    await client.end().catch(() => {});
  }
}

/** Waits until no other process holds the migration lock. Used by processes that do not migrate themselves. */
export async function waitForMigrationLock(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString, application_name: 'openinc-wait' });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID]);
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]);
  } finally {
    await client.end().catch(() => {});
  }
}
