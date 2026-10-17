import { and, count, eq, files, isNull, sum } from '@openinc/db';
import {
  clearSettingsInput,
  empty,
  getSettingsInput,
  type SettingsValues,
  testAiInput,
  testEmailInput,
  updateSettingsInput,
} from '@openinc/shared';
import { testModel } from '../ai/model.ts';
import { audit } from '../audit.ts';
import { getDb } from '../context.ts';
import { getEnv } from '../env.ts';
import { badRequest } from '../errors.ts';
import { listBackups } from '../lib/backup.ts';
import { deliverEmail, renderEmail } from '../lib/email.ts';
import { checkStorage, describeStorageError } from '../lib/storage.ts';
import { defineService } from '../service.ts';
import { clearSettings, getSettings, getSettingsView, saveSettings } from '../settings.ts';
import { productName } from './auth.ts';

export const getSettingsGroup = defineService({
  name: 'settings.get',
  description:
    'Read one Admin settings group (company, email, ai, errorTracking, security, system). Secret values are never returned; secretsSet says which are set. locked lists fields pinned by an environment variable.',
  kind: 'query',
  access: 'settings.manage',
  input: getSettingsInput,
  handler: (_ctx, input) => getSettingsView(input.group),
});

export const updateSettingsGroup = defineService({
  name: 'settings.update',
  description:
    'Save one Admin settings group. Takes effect immediately, without a restart, and is audited. For secret fields (email password, AI apiKey) leave them out to keep the stored value.',
  kind: 'mutation',
  transaction: false,
  access: 'settings.manage',
  input: updateSettingsInput,
  async handler(ctx, input) {
    await saveSettings(ctx, input.group, input.values as Record<string, unknown>);
    return getSettingsView(input.group);
  },
});

export const clearSettingsGroup = defineService({
  name: 'settings.clear',
  description: 'Remove the email, AI or error tracking settings entirely, which turns that feature off.',
  kind: 'mutation',
  transaction: false,
  access: 'settings.manage',
  input: clearSettingsInput,
  async handler(ctx, input) {
    await clearSettings(ctx, input.group);
    return { ok: true };
  },
});

export const overview = defineService({
  name: 'settings.overview',
  description: 'Which optional features are set up: email, AI assistant and error tracking.',
  kind: 'query',
  access: 'authenticated',
  input: empty,
  async handler() {
    const [email, ai, errorTracking] = await Promise.all([getSettings('email'), getSettings('ai'), getSettings('errorTracking')]);
    return { email: !!email, ai: !!ai, errorTracking: !!errorTracking?.dsn };
  },
});

async function mergeSecret<T extends Record<string, unknown>>(group: 'email' | 'ai', draft: T, field: string): Promise<T> {
  if (draft[field] !== undefined) return draft;
  const saved = (await getSettings(group)) as Record<string, unknown> | null;
  return { ...draft, [field]: saved?.[field] ?? '' };
}

export const testEmail = defineService({
  name: 'settings.testEmail',
  description:
    'Send a test email right away, with the saved SMTP settings or with unsaved ones from the form. Reports the SMTP error if it fails.',
  kind: 'mutation',
  access: 'settings.manage',
  transaction: false,
  input: testEmailInput,
  async handler(ctx, input) {
    const settings = input.settings
      ? ((await mergeSecret('email', input.settings, 'password')) as SettingsValues<'email'>)
      : await getSettings('email');
    if (!settings) throw badRequest('Enter the SMTP details first');
    const to = input.to ?? ctx.actor!.email;
    const product = await productName();
    try {
      await deliverEmail(
        renderEmail({
          to,
          subject: `${product}: test email`,
          paragraphs: [`Email from ${product} works.`, `Sent through ${settings.host}:${settings.port}.`],
        }),
        settings,
      );
    } catch (error) {
      await audit(ctx, { action: 'settings.test_email', entityType: 'settings', entityId: 'email', metadata: { to, ok: false } });
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
    await audit(ctx, { action: 'settings.test_email', entityType: 'settings', entityId: 'email', metadata: { to, ok: true } });
    return { ok: true as const, to };
  },
});

export const testAi = defineService({
  name: 'settings.testAi',
  description: 'Check that the AI provider, model and API key work by sending a tiny request.',
  kind: 'mutation',
  access: 'settings.manage',
  transaction: false,
  input: testAiInput,
  async handler(_ctx, input) {
    const settings = input.settings
      ? ((await mergeSecret('ai', input.settings, 'apiKey')) as SettingsValues<'ai'>)
      : await getSettings('ai');
    if (!settings) throw badRequest('Choose a provider and model first');
    return testModel(settings);
  },
});

export const storage = defineService({
  name: 'settings.storage',
  description:
    'The S3 bucket in use (endpoint, bucket, region; set by environment variables) and how much it holds: files and database backups.',
  kind: 'query',
  access: 'settings.manage',
  input: empty,
  async handler(ctx) {
    const env = getEnv();
    const [[usage], backups] = await Promise.all([
      ctx.db
        .select({ files: count(), bytes: sum(files.sizeBytes) })
        .from(files)
        .where(isNull(files.deletedAt)),
      listBackups().catch(() => []),
    ]);
    return {
      endpoint: env.S3_ENDPOINT ?? 'AWS S3',
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      files: usage?.files ?? 0,
      fileBytes: Number(usage?.bytes ?? 0),
      backups: backups.length,
      backupBytes: backups.reduce((total, b) => total + b.size, 0),
    };
  },
});

export const testStorage = defineService({
  name: 'settings.testStorage',
  description: 'Write, read back and delete a test object in the bucket.',
  kind: 'mutation',
  access: 'settings.manage',
  transaction: false,
  input: empty,
  async handler() {
    const started = Date.now();
    try {
      await checkStorage();
      return { ok: true as const, ms: Date.now() - started };
    } catch (error) {
      return { ok: false as const, ...describeStorageError(error) };
    }
  },
});

/** The company logo, served without sign-in so the login page can show it. */
export async function companyLogo() {
  const company = await getSettings('company');
  if (!company?.logoFileId) return null;
  const [row] = await getDb()
    .select()
    .from(files)
    .where(and(eq(files.id, company.logoFileId), eq(files.kind, 'logo'), isNull(files.deletedAt)));
  return row ?? null;
}
