import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { useClientConfig } from './session.tsx';

let started: string | null = null;

/** Reports browser errors to the DSN set in Admin settings → Error tracking. Off while it is empty. */
export function useErrorTracking() {
  const config = useClientConfig();
  useEffect(() => {
    const dsn = config?.errorTracking?.dsn;
    if (!dsn || started === dsn) return;
    started = dsn;
    Sentry.init({ dsn, environment: config.errorTracking?.environment, release: config.version, tracesSampleRate: 0 });
  }, [config]);
}
