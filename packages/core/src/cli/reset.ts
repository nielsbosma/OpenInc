import { loadMigrations, migrate } from '@openinc/db';
import pg from 'pg';
import { appVersion, getEnv, loadDevEnv } from '../env.ts';

/**
 * Local development only: wipes the database, installs it again and seeds it.
 * Refuses anything but a local database unless ALLOW_RESET=yes.
 */
loadDevEnv(new URL('../../../../', import.meta.url));
const url = getEnv().DATABASE_URL;
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', 'postgres', '::1'].includes(host) && process.env.ALLOW_RESET !== 'yes') {
  throw new Error(`Refusing to reset a non-local database (${host}). Set ALLOW_RESET=yes to override.`);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(
  'drop schema if exists registry cascade; drop schema if exists public cascade; drop schema if exists pgboss cascade; create schema public;',
);
await client.end();
console.log('database wiped');

const { applied } = await migrate({ connectionString: url, appVersion: appVersion(), migrations: loadMigrations() });
console.log(`${applied.length} migration(s) applied`);

if (!process.argv.includes('--empty')) await import('./seed.ts');
else console.log('left empty: open the app to run the setup wizard');
