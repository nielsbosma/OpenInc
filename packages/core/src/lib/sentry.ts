import * as Sentry from '@sentry/node';
import { appVersion } from '../env.ts';
import { AppError } from '../errors.ts';
import { getSettings, onSettingsChange } from '../settings.ts';

let activeDsn: string | null = null;
let serverName = 'openinc';

async function apply(): Promise<void> {
  const settings = await getSettings('errorTracking').catch(() => null);
  const dsn = settings?.dsn || null;
  if (dsn === activeDsn) return;
  if (activeDsn) await Sentry.close(2000);
  activeDsn = dsn;
  if (!dsn) return;
  // Bugsink speaks the Sentry protocol but drops session envelopes, so session tracking stays off.
  Sentry.init({
    dsn,
    environment: settings?.environment || 'production',
    release: appVersion(),
    serverName,
    tracesSampleRate: 0,
    autoSessionTracking: false,
    sendDefaultPii: false,
  } as Sentry.NodeOptions);
}

/** Starts reporting to the DSN in Admin settings, and follows it when an Admin changes it. */
export async function initErrorTracking(name: string): Promise<void> {
  serverName = name;
  await apply();
  onSettingsChange((group) => {
    if (group === 'errorTracking' || (group as string) === '*') void apply();
  });
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (error instanceof AppError) return;
  console.error(error);
  if (activeDsn) Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function browserErrorTracking(): Promise<{ dsn: string; environment: string } | null> {
  return getSettings('errorTracking').then((s) => (s?.dsn ? { dsn: s.dsn, environment: s.environment } : null));
}
