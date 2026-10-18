import { PgBoss } from 'pg-boss';
import { getEnv } from './env.ts';
import type { Email } from './lib/email.ts';

export const BOSS_SCHEMA = 'pgboss';

/** Every queue and its payload. Add a queue here, then its handler in apps/server/src/worker/jobs.ts. */
export interface JobPayloads {
  'email.send': Email;
  'notifications.fanout': { userIds: string[]; type: string; title: string; body?: string; link?: string; email?: boolean };
  'system.demo': { userId: string; seconds: number };
  'system.dataMigration': { name: string };
  'maintenance.cleanup': Record<string, never>;
  'registry.verifyChain': Record<string, never>;
  'registry.import': { importId: string };
  'documents.zip': { userId: string; folderId: string | null };
}

export type JobName = keyof JobPayloads;

export const QUEUES: JobName[] = [
  'email.send',
  'notifications.fanout',
  'system.demo',
  'system.dataMigration',
  'maintenance.cleanup',
  'registry.verifyChain',
  'registry.import',
  'documents.zip',
];

let sender: Promise<PgBoss> | undefined;

/** A send-only instance for the web process. The worker starts its own with supervision and schedules on. */
function getSender(): Promise<PgBoss> {
  sender ??= (async () => {
    const boss = new PgBoss({
      connectionString: getEnv().DATABASE_URL,
      schema: BOSS_SCHEMA,
      application_name: 'openinc-jobs',
      supervise: false,
      schedule: false,
      max: 2,
    });
    boss.on('error', (error) => console.error('[jobs]', error));
    await boss.start();
    for (const name of QUEUES) await boss.createQueue(name);
    return boss;
  })();
  sender.catch(() => {
    sender = undefined;
  });
  return sender;
}

export async function enqueue<N extends JobName>(
  name: N,
  data: JobPayloads[N],
  options: { startAfterSeconds?: number; singletonKey?: string } = {},
) {
  const boss = await getSender();
  return boss.send(name, data as object, {
    retryLimit: 5,
    retryBackoff: true,
    ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
    ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
  });
}

export function queueEmail(email: Email) {
  return enqueue('email.send', email);
}

export async function queueStats() {
  const boss = await getSender();
  const queues = await boss.getQueues(QUEUES);
  return queues.map((q) => ({
    name: q.name,
    queued: (q as { queuedCount?: number }).queuedCount ?? 0,
    active: (q as { activeCount?: number }).activeCount ?? 0,
    total: (q as { totalCount?: number }).totalCount ?? 0,
  }));
}

export async function stopJobs(): Promise<void> {
  if (sender) {
    const boss = await sender.catch(() => undefined);
    sender = undefined;
    await boss?.stop({ graceful: true, timeout: 5000 });
  }
}
