import { BOSS_SCHEMA, enqueue, getEnv, type JobName, QUEUES, reportError } from '@openinc/core';
import { PgBoss } from 'pg-boss';
import { handlers, schedules } from './jobs.ts';

let boss: PgBoss | undefined;

/** pg-boss keeps its own tables in the `pgboss` schema of the same database. No Redis. */
export async function startWorker(): Promise<void> {
  boss = new PgBoss({ connectionString: getEnv().DATABASE_URL, schema: BOSS_SCHEMA, application_name: 'openinc-worker' });
  boss.on('error', (error) => reportError(error, { source: 'pg-boss' }));
  await boss.start();
  for (const name of QUEUES) await boss.createQueue(name);

  for (const [name, handler] of Object.entries(handlers) as [JobName, (data: never) => Promise<unknown>][]) {
    await boss.work(name, { batchSize: 1 }, async ([job]) => {
      if (!job) return;
      try {
        return await handler(job.data as never);
      } catch (error) {
        reportError(error, { job: name, jobId: job.id });
        throw error;
      }
    });
  }
  for (const s of schedules) await boss.schedule(s.name, s.cron, {}, { tz: 'UTC' });
  await enqueue('system.dataMigration', { name: '' }, { singletonKey: 'data-migrations' });
  console.log(`[worker] running: ${QUEUES.join(', ')}`);
}

export async function stopWorker(): Promise<void> {
  await boss?.stop({ graceful: true, timeout: 20_000 });
  boss = undefined;
}
