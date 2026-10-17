import { DatabaseTooNewError, loadMigrations, MigrationFailedError, migrate, planMigrations, requiredVersion } from '@openinc/db';
import type { MigrationProgress, SystemProblem, SystemStatus } from '@openinc/shared';
import pg from 'pg';
import { appVersion, readEnv } from '../env.ts';
import { BackupUnavailableError, backupDatabase } from '../lib/backup.ts';
import { checkStorage, describeStorageError } from '../lib/storage.ts';

/**
 * The startup state machine. The HTTP server starts first and always answers, so a broken
 * environment shows a setup page with the cause instead of a crash loop.
 *
 *   starting → config-error                    (env vars missing; fixed by redeploying)
 *            → unreachable ↺                    (Postgres or S3 down; retried every few seconds)
 *            → too-new                          (database upgraded by a newer image)
 *            → needs-install → installing → ready   (empty database; the wizard starts the install)
 *            → migrating → ready | failed       (installed database with pending migrations)
 *            → ready
 */

const RETRY_MS = 5000;

const status: SystemStatus = {
  phase: 'starting',
  version: appVersion(),
  problems: [],
  progress: null,
  needsAdmin: true,
  requiredVersion: null,
};

const readyCallbacks: (() => Promise<void> | void)[] = [];
let retryTimer: NodeJS.Timeout | undefined;
let running: Promise<void> | undefined;

export function getSystemStatus(): SystemStatus {
  return structuredClone(status);
}

export function isReady(): boolean {
  return status.phase === 'ready';
}

/** Runs once the database is installed and up to date (immediately if it already is). */
export function onReady(callback: () => Promise<void> | void): void {
  readyCallbacks.push(callback);
  if (status.phase === 'ready') void Promise.resolve(callback()).catch((e) => console.error('[system] ready callback failed', e));
}

function setPhase(phase: SystemStatus['phase'], problems: SystemProblem[] = []) {
  status.phase = phase;
  status.problems = problems;
  if (phase !== 'installing' && phase !== 'migrating' && phase !== 'failed') status.progress = null;
}

function describeDatabaseError(error: unknown): SystemProblem {
  const e = error as { code?: string; message?: string };
  const message = e.message ?? String(error);
  if (e.code === '28P01' || e.code === '28000') {
    return { area: 'database', message: 'Postgres refused the user name or password', hint: 'Check the credentials in DATABASE_URL.' };
  }
  if (e.code === '3D000')
    return { area: 'database', message: 'The database in DATABASE_URL does not exist', hint: 'Create an empty database first.' };
  if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT' || /timeout|ECONNREFUSED|getaddrinfo/i.test(message)) {
    return {
      area: 'database',
      message: 'Could not reach Postgres',
      hint: 'Check the host and port in DATABASE_URL and that the database is running.',
    };
  }
  return { area: 'database', message: `Postgres: ${message}`, hint: 'Check DATABASE_URL.' };
}

async function withClient<T>(connectionString: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, application_name: 'openinc-check' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkDatabase(connectionString: string): Promise<SystemProblem | null> {
  try {
    return await withClient(connectionString, async (c) => {
      const { rows } = await c.query<{ create_schema: boolean; create_public: boolean; version: number }>(
        `select has_database_privilege(current_user, current_database(), 'CREATE') as create_schema,
                has_schema_privilege(current_user, 'public', 'CREATE') as create_public,
                current_setting('server_version_num')::int as version`,
      );
      const row = rows[0]!;
      if (row.version < 140000)
        return { area: 'database', message: 'OpenInc needs Postgres 14 or newer', hint: 'Upgrade the database server.' };
      if (!row.create_schema || !row.create_public) {
        return {
          area: 'database',
          message: 'The database user cannot create tables and schemas',
          hint: 'Make the user in DATABASE_URL the owner of the database, or grant it CREATE on the database and on schema public.',
        };
      }
      return null;
    });
  } catch (error) {
    return describeDatabaseError(error);
  }
}

async function countUsers(connectionString: string): Promise<number> {
  return withClient(connectionString, async (c) => {
    const { rows } = await c.query<{ n: number }>('select count(*)::int as n from users');
    return rows[0]?.n ?? 0;
  });
}

function progressFor(tags: string[]): MigrationProgress {
  return { total: tags.length, done: 0, current: null, steps: tags.map((name) => ({ name, status: 'pending' })), backupKey: null };
}

async function runMigrations(connectionString: string, phase: 'installing' | 'migrating'): Promise<void> {
  setPhase(phase);
  try {
    await migrate({
      connectionString,
      appVersion: appVersion(),
      backup: async () => {
        try {
          return await backupDatabase(`before-${appVersion()}`);
        } catch (error) {
          if (error instanceof BackupUnavailableError && process.env.NODE_ENV !== 'production') {
            console.warn(`[system] skipping the pre-migration backup: ${error.message}`);
            return null;
          }
          throw new Error(`Could not back up the database before upgrading, so nothing was changed: ${(error as Error).message}`);
        }
      },
      onProgress: (event) => {
        if (event.type === 'plan') status.progress = progressFor(event.pending);
        const p = status.progress;
        if (!p) return;
        if (event.type === 'backup') p.backupKey = event.key;
        if (event.type === 'start') {
          p.current = event.tag;
          const step = p.steps.find((s) => s.name === event.tag);
          if (step) step.status = 'running';
        }
        if (event.type === 'done') {
          p.done++;
          p.current = null;
          const step = p.steps.find((s) => s.name === event.tag);
          if (step) step.status = 'done';
        }
      },
    });
  } catch (error) {
    if (error instanceof DatabaseTooNewError) {
      status.requiredVersion = error.requiredVersion;
      setPhase('too-new', [
        {
          area: 'migration',
          message: error.message,
          hint: `Deploy OpenInc ${error.requiredVersion} or newer. Downgrading is not supported.`,
        },
      ]);
      return;
    }
    const step = status.progress?.steps.find((s) => s.status === 'running');
    if (step) step.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    setPhase('failed', [
      {
        area: 'migration',
        message,
        hint:
          error instanceof MigrationFailedError
            ? 'The failed migration was rolled back. The previous image version still starts against this database. A backup is in the bucket under backups/.'
            : 'Fix the cause and press Try again, or redeploy the previous image version.',
      },
    ]);
    console.error('[system] migration failed', error);
    return;
  }
  await becomeReady(connectionString);
}

async function becomeReady(connectionString: string): Promise<void> {
  status.needsAdmin = (await countUsers(connectionString)) === 0;
  setPhase('ready');
  for (const callback of readyCallbacks) {
    try {
      await callback();
    } catch (error) {
      console.error('[system] ready callback failed', error);
    }
  }
}

function scheduleRetry(options: BootOptions) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => void boot(options), RETRY_MS);
  retryTimer.unref();
}

export interface BootOptions {
  /** Whether this process applies migrations to an installed database (all roles do; the lock serialises them). */
  migrate: boolean;
}

async function bootOnce(options: BootOptions): Promise<void> {
  const { env, problems } = readEnv();
  if (!env) {
    setPhase('config-error', problems);
    return;
  }

  const database = await checkDatabase(env.DATABASE_URL);
  const storage = await checkStorage().then(
    () => null,
    (error) => ({ area: 'storage' as const, ...describeStorageError(error) }),
  );
  if (database || storage) {
    setPhase(
      'unreachable',
      [database, storage].filter((p): p is SystemProblem => !!p),
    );
    scheduleRetry(options);
    return;
  }

  const plan = await withClient(env.DATABASE_URL, (c) => planMigrations(c, loadMigrations()));
  if (plan.unknown.length) {
    const needed = requiredVersion(plan.unknown);
    status.requiredVersion = needed;
    setPhase('too-new', [
      {
        area: 'migration',
        message: `This database was upgraded by OpenInc ${needed}, and this image is ${appVersion()}.`,
        hint: `Deploy OpenInc ${needed} or newer. Downgrading is not supported.`,
      },
    ]);
    return;
  }
  if (plan.applied.length === 0) {
    setPhase('needs-install');
    // The wizard installs from the web process; any other process (a separate worker) notices by polling.
    scheduleRetry(options);
    return;
  }
  if (plan.pending.length > 0) {
    await runMigrations(env.DATABASE_URL, 'migrating');
    return;
  }
  await becomeReady(env.DATABASE_URL);
}

/** Starts (or restarts) the checks. Safe to call again, e.g. from a "Try again" button. */
export function boot(options: BootOptions): Promise<void> {
  if (status.phase === 'ready' || status.phase === 'installing' || status.phase === 'migrating') return running ?? Promise.resolve();
  running ??= bootOnce(options)
    .catch((error) => {
      console.error('[system] startup check failed', error);
      setPhase('unreachable', [describeDatabaseError(error)]);
      scheduleRetry(options);
    })
    .finally(() => {
      running = undefined;
    });
  return running;
}

/** Installs an empty database. Started by the setup wizard; returns once the install is done or has failed. */
export async function installDatabase(): Promise<SystemStatus> {
  if (status.phase !== 'needs-install' && status.phase !== 'failed') return getSystemStatus();
  const { env } = readEnv();
  if (!env) return getSystemStatus();
  await runMigrations(env.DATABASE_URL, 'installing');
  return getSystemStatus();
}

export function markAdminCreated(): void {
  status.needsAdmin = false;
}

/** For tests. */
export function resetSystemStatus(): void {
  clearTimeout(retryTimer);
  Object.assign(status, { phase: 'starting', problems: [], progress: null, needsAdmin: true, requiredVersion: null });
}
