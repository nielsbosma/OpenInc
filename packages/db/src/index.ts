import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export * from './schema/index.ts';
export * from './migrator.ts';
export { schema };

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Transaction;

// Calendar dates stay `YYYY-MM-DD` strings; a JS Date would shift them by the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export function createDb(connectionString: string, options: { max?: number; applicationName?: string } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10, application_name: options.applicationName ?? 'openinc' });
  pool.on('error', (error) => console.error('[db] idle client error', error.message));
  return drizzle({ client: pool, schema, casing: 'snake_case' }) as Database;
}
