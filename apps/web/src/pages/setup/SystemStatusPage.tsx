import type { SystemStatus } from '@openinc/shared';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { Logo } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const COPY: Record<string, { title: string; description: string }> = {
  'config-error': {
    title: 'OpenInc Needs a Few Settings',
    description: 'Some environment variables are missing or invalid. Set them on the service and redeploy.',
  },
  unreachable: {
    title: 'Cannot Reach the Database or Bucket',
    description: 'OpenInc keeps retrying every few seconds. This page updates by itself.',
  },
  migrating: { title: 'Upgrading', description: 'OpenInc is applying database migrations. This usually takes a few seconds.' },
  starting: { title: 'Starting', description: 'Checking the database and storage…' },
  failed: { title: 'The Upgrade Failed', description: 'Nothing was half-applied: the failing migration was rolled back.' },
  'too-new': {
    title: 'This Version Is Too Old for the Database',
    description: 'The database was upgraded by a newer OpenInc. Downgrades are not supported.',
  },
};

/** A friendly page instead of a crash loop: what is wrong and what to check. */
export function SystemStatusPage({ status }: { status: SystemStatus | null }) {
  const retry = useMutation({ mutationFn: () => fetch('/api/system/retry', { method: 'POST' }) });
  const phase = status?.phase ?? 'unreachable';
  const copy = COPY[phase] ?? COPY.unreachable!;
  const busy = phase === 'migrating' || phase === 'starting';
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <Logo className="size-8" />
        <span className="text-base font-semibold">OpenInc</span>
      </div>
      <Card className="w-full max-w-xl shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {busy ? <Loader2 className="size-5 animate-spin text-primary" /> : <AlertTriangle className="size-5 text-warning" />}
            {copy.title}
          </CardTitle>
          <CardDescription>{status ? copy.description : 'The server did not answer. Check that the container is running.'}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {status?.problems.length ? (
            <ul className="grid gap-2">
              {status.problems.map((p) => (
                <li key={p.message} className="rounded-md border px-3 py-2.5">
                  <div className="font-medium">{p.message}</div>
                  {p.hint && <div className="mt-0.5 text-muted-foreground">{p.hint}</div>}
                </li>
              ))}
            </ul>
          ) : null}
          {status?.progress && (
            <div className="font-mono text-xs text-muted-foreground">
              {status.progress.done}/{status.progress.total} migrations
              {status.progress.current && ` · ${status.progress.current}`}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-mono">v{status?.version ?? '?'}</span>
            {(phase === 'unreachable' || phase === 'failed') && (
              <Button variant="outline" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
                <RefreshCw /> Try Again
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
