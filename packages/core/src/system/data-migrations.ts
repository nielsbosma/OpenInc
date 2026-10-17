import { dataMigrations, eq } from '@openinc/db';
import type { Ctx } from '../context.ts';

/**
 * Backfills too slow to run at startup. Add one here with a unique name; after the schema migration
 * that needs it ships, the worker runs it once in the background and Admin settings → System shows
 * its progress. `run` must be safe to restart: it may be interrupted by a deploy.
 */
export interface DataMigration {
  name: string;
  description: string;
  run(ctx: Ctx, progress: (done: number, total?: number) => Promise<void>): Promise<void>;
}

export const DATA_MIGRATIONS: DataMigration[] = [];

/** Runs every data migration that has not finished, one after another. Called by the worker. */
export async function runDataMigrations(ctx: Ctx, only?: string): Promise<void> {
  for (const migration of DATA_MIGRATIONS) {
    if (only && migration.name !== only) continue;
    const [row] = await ctx.db.select().from(dataMigrations).where(eq(dataMigrations.name, migration.name));
    if (row?.status === 'done') continue;
    if (!row) await ctx.db.insert(dataMigrations).values({ name: migration.name });
    await ctx.db
      .update(dataMigrations)
      .set({ status: 'running', startedAt: new Date(), error: null })
      .where(eq(dataMigrations.name, migration.name));
    try {
      await migration.run(ctx, async (done, total) => {
        await ctx.db
          .update(dataMigrations)
          .set({ done, ...(total !== undefined && { total }) })
          .where(eq(dataMigrations.name, migration.name));
      });
      await ctx.db.update(dataMigrations).set({ status: 'done', finishedAt: new Date() }).where(eq(dataMigrations.name, migration.name));
    } catch (error) {
      await ctx.db
        .update(dataMigrations)
        .set({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
        .where(eq(dataMigrations.name, migration.name));
      throw error;
    }
  }
}
