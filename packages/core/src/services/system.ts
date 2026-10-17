import { auditLog, compareVersions, count, dataMigrations, desc, eq, sql, users } from '@openinc/db';
import { empty, runDemoJobInput } from '@openinc/shared';
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

let latestRelease: { checkedAt: number; value: { version: string; url: string } | null } | undefined;

async function fetchLatestRelease(): Promise<{ version: string; url: string } | null> {
  if (latestRelease && Date.now() - latestRelease.checkedAt < 6 * 60 * 60 * 1000) return latestRelease.value;
  let value: { version: string; url: string } | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'openinc-update-check' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = (await res.json()) as { tag_name: string; html_url: string };
      value = { version: body.tag_name.replace(/^v/, ''), url: body.html_url };
    }
  } catch {}
  latestRelease = { checkedAt: Date.now(), value };
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
      aiEnabled: signedIn ? (await isAiConfigured()) && can(ctx, 'ai.chat') : false,
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
  input: empty,
  async handler(ctx) {
    const systemSettings = await getSettingsOrDefaults('system');
    const [latest, migrations, backups, queues, data] = await Promise.all([
      systemSettings.updateCheck ? fetchLatestRelease() : Promise.resolve(null),
      ctx.db.execute<{ tag: string; app_version: string; applied_at: Date }>(
        sql`select tag, app_version, applied_at from openinc_migrations order by idx desc`,
      ),
      listBackups().catch(() => []),
      queueStats().catch(() => []),
      ctx.db.select().from(dataMigrations).orderBy(desc(dataMigrations.createdAt)),
    ]);
    const version = appVersion();
    return {
      version,
      node: process.version,
      latest,
      updateAvailable: !!latest && compareVersions(latest.version, version) > 0,
      updateCheck: systemSettings.updateCheck,
      migrations: migrations.rows.map((r) => ({ tag: r.tag, appVersion: r.app_version, appliedAt: new Date(r.applied_at) })),
      backups: backups.map((b) => ({ key: b.key, size: b.size, createdAt: b.lastModified })),
      queues,
      dataMigrations: data,
    };
  },
});

export const dashboardSummary = defineService({
  name: 'dashboard.summary',
  description: 'Numbers for the dashboard: active people, and recent activity when the user may read the audit log.',
  kind: 'query',
  access: 'company.read',
  input: empty,
  async handler(ctx) {
    const [[active], recent] = await Promise.all([
      ctx.db.select({ value: count() }).from(users).where(eq(users.active, true)),
      can(ctx, 'audit.read')
        ? ctx.db
            .select({
              id: auditLog.id,
              occurredAt: auditLog.occurredAt,
              actorLabel: auditLog.actorLabel,
              action: auditLog.action,
              surface: auditLog.surface,
            })
            .from(auditLog)
            .orderBy(desc(auditLog.id))
            .limit(8)
        : Promise.resolve([]),
    ]);
    return { activeUsers: active?.value ?? 0, recentActivity: recent.map((r) => ({ ...r, id: r.id.toString() })) };
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
