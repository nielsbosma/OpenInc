import { compareVersions, dataMigrations, desc, sql } from '@openinc/db';
import { empty, runDemoJobInput, systemInfoInput } from '@openinc/shared';
import { isAiConfigured } from '../ai/model.ts';
import { audit } from '../audit.ts';
import { can } from '../context.ts';
import { appVersion } from '../env.ts';
import { enqueue, queueStats } from '../jobs.ts';
import { listBackups } from '../lib/backup.ts';
import { browserErrorTracking } from '../lib/sentry.ts';
import { defineService } from '../service.ts';
import { getSettings, getSettingsOrDefaults } from '../settings.ts';

export const RELEASES_REPO = 'nielsbosma/OpenInc';

type ReleaseCheck = { latest: { version: string; url: string } | null; error: string | null };
let lastCheck: { checkedAt: number; value: ReleaseCheck } | undefined;

/** Asks GitHub for the newest release, at most every six hours unless forced. A repo without releases is not an error. */
async function checkLatestRelease(force: boolean): Promise<ReleaseCheck> {
  if (!force && lastCheck && Date.now() - lastCheck.checkedAt < 6 * 60 * 60 * 1000) return lastCheck.value;
  let value: ReleaseCheck;
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'openinc-update-check' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) value = { latest: null, error: null };
    else if (!res.ok) value = { latest: null, error: `GitHub answered HTTP ${res.status}` };
    else {
      const body = (await res.json()) as { tag_name: string; html_url: string };
      value = { latest: { version: body.tag_name.replace(/^v/, ''), url: body.html_url }, error: null };
    }
  } catch (error) {
    value = { latest: null, error: error instanceof Error ? error.message : 'Could not reach GitHub' };
  }
  lastCheck = { checkedAt: Date.now(), value };
  return value;
}

export const clientConfig = defineService({
  name: 'system.clientConfig',
  description: 'What the browser needs before rendering: company name and logo, version, whether the AI assistant is available.',
  kind: 'query',
  access: 'public',
  input: empty,
  async handler(ctx) {
    const company = await getSettings('company').catch(() => null);
    const signedIn = !!ctx.actor;
    return {
      version: appVersion(),
      companyName: company?.name ?? null,
      logoUrl: company?.logoFileId ? '/api/public/logo' : null,
      timeZone: company?.timeZone ?? null,
      currency: company?.currency ?? null,
      aiConfigured: signedIn ? await isAiConfigured().catch(() => false) : false,
      aiAllowed: signedIn && can(ctx, 'ai.chat'),
      errorTracking: await browserErrorTracking().catch(() => null),
    };
  },
});

export const info = defineService({
  name: 'system.info',
  description:
    'Running version and whether a newer release exists, applied database migrations, database backups, background queues and data migrations.',
  kind: 'query',
  access: 'system.read',
  input: systemInfoInput,
  async handler(ctx, input) {
    const systemSettings = await getSettingsOrDefaults('system');
    const version = appVersion();
    const development = version.endsWith('-dev');
    const [release, migrations, backups, queues, data] = await Promise.all([
      systemSettings.updateCheck && !development ? checkLatestRelease(input.recheck) : Promise.resolve(null),
      ctx.db.execute<{ tag: string; app_version: string; applied_at: Date }>(
        sql`select tag, app_version, applied_at from openinc_migrations order by idx desc`,
      ),
      listBackups().catch(() => []),
      queueStats().catch(() => []),
      ctx.db.select().from(dataMigrations).orderBy(desc(dataMigrations.createdAt)),
    ]);
    const latest = release?.latest ?? null;
    return {
      version,
      node: process.version,
      development,
      latest,
      updateError: release?.error ?? null,
      updateAvailable: !!latest && compareVersions(latest.version, version) > 0,
      updateCheck: systemSettings.updateCheck,
      migrations: migrations.rows.map((r) => ({ tag: r.tag, appVersion: r.app_version, appliedAt: new Date(r.applied_at) })),
      backups: backups.map((b) => ({ key: b.key, size: b.size, createdAt: b.lastModified })),
      queues,
      dataMigrations: data,
    };
  },
});

export const runDemoJob = defineService({
  name: 'jobs.runDemo',
  description: 'Start a test background job. It waits a few seconds, then puts a notification in your bell. Shows that the worker runs.',
  kind: 'mutation',
  access: 'system.read',
  input: runDemoJobInput,
  async handler(ctx, input) {
    const jobId = await enqueue('system.demo', { userId: ctx.actor!.userId, seconds: input.seconds });
    await audit(ctx, { action: 'jobs.run_demo', entityType: 'job', entityId: jobId, metadata: { seconds: input.seconds } });
    return { jobId };
  },
});
