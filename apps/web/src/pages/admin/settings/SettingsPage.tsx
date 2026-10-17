import { formatBytes, formatRelative, securitySettings, systemSettings } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, ExternalLink, RefreshCw, XCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, Field, PageHeader, Spinner, StatusDot, validate } from '@/components/common';
import { SETTINGS_SECTIONS } from '@/components/layout/nav';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCan, useFormat } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { AuditSection } from '../AuditPage';
import { UsersSection } from '../UsersPage';
import { AiForm, CompanyForm, EmailForm, ErrorTrackingForm } from './forms';

function Panel({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function StorageTab() {
  const trpc = useTRPC();
  const info = useQuery(trpc.settings.storage.queryOptions());
  const test = useMutation(trpc.settings.testStorage.mutationOptions());
  if (!info.data) return <Spinner />;
  const d = info.data;
  const rows: [string, ReactNode][] = [
    ['Endpoint', d.endpoint],
    ['Bucket', d.bucket],
    ['Region', d.region],
    ['Files', `${d.files} · ${formatBytes(d.fileBytes)}`],
    ['Database Backups', `${d.backups} · ${formatBytes(d.backupBytes)}`],
  ];
  return (
    <div className="grid max-w-xl gap-4">
      <dl className="divide-y rounded-lg border">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="truncate font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Change these with S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY and S3_SECRET_KEY, then redeploy.
      </p>
      {test.data && (
        <Alert variant={test.data.ok ? 'default' : 'destructive'}>
          {test.data.ok ? <CheckCircle2 className="text-success" /> : <XCircle />}
          <AlertDescription>
            {test.data.ok ? `The bucket works (write, read and delete in ${test.data.ms} ms).` : `${test.data.message}. ${test.data.hint}`}
          </AlertDescription>
        </Alert>
      )}
      <Button variant="outline" className="justify-self-start" onClick={() => test.mutate({})} disabled={test.isPending}>
        {test.isPending && <Spinner />} Test Storage
      </Button>
    </div>
  );
}

function SecurityTab() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const view = useQuery(trpc.settings.get.queryOptions({ group: 'security' }));
  const [values, setValues] = useState({ enforceTwoFactor: false, sessionDays: 14 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries();
        toast.success('Security settings saved');
      },
    }),
  );
  useEffect(() => {
    if (view.data) setValues((v) => ({ ...v, ...(view.data.values as typeof v) }));
  }, [view.data]);
  if (!view.data) return <Spinner />;
  const locked = (f: string) => view.data.locked.includes(f);
  return (
    <form
      className="grid max-w-xl gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        const { data, errors } = validate(securitySettings, values);
        setErrors(errors ?? {});
        if (data) update.mutate({ group: 'security', values: data });
      }}
    >
      <label className="flex items-start gap-3">
        <Switch
          checked={values.enforceTwoFactor}
          onCheckedChange={(c) => setValues((v) => ({ ...v, enforceTwoFactor: c }))}
          disabled={locked('enforceTwoFactor')}
        />
        <span>
          <span className="block font-medium">Require Two-Factor Authentication</span>
          <span className="block text-muted-foreground">
            People without it must set it up before they can do anything else. MCP clients stop working for them until they do.
          </span>
        </span>
      </label>
      <Field
        label="Session Length (Days)"
        htmlFor="session-days"
        error={errors.sessionDays}
        hint="People stay signed in this long after their last visit (1–90)."
      >
        <Input
          id="session-days"
          inputMode="numeric"
          className="w-28 font-mono"
          value={values.sessionDays}
          onChange={(e) => setValues((v) => ({ ...v, sessionDays: Number(e.target.value.replace(/\D/g, '')) }))}
          disabled={locked('sessionDays')}
        />
      </Field>
      <Button type="submit" className="justify-self-start" disabled={update.isPending}>
        Save
      </Button>
    </form>
  );
}

/** "backups/openinc-2026-10-17T11-02-46-646Z-before-0.2.0.dump" → a date and "Before v0.2.0". */
function describeBackup(key: string): { name: string; when: Date | null; reason: string } {
  const name = key.replace(/^backups\//, '');
  const match = /^openinc-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(.+)\.dump$/.exec(name);
  if (!match) return { name, when: null, reason: name };
  const [, day, h, m, s, ms, why] = match;
  const reason = why!.startsWith('before-') ? `Before v${why!.slice(7)}` : why!.replace(/[-_]/g, ' ');
  return { name, when: new Date(`${day}T${h}:${m}:${s}.${ms}Z`), reason };
}

function UpdateBadge({ info, onRetry, retrying }: { info: RouterOutputs['system']['info']; onRetry: () => void; retrying: boolean }) {
  if (info.development) return <Badge variant="secondary">Development Build</Badge>;
  if (!info.updateCheck) return <Badge variant="outline">Update Check Off</Badge>;
  if (info.updateError) {
    return (
      <span className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="cursor-help">
              Check Failed
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{info.updateError}</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="xs" onClick={onRetry} disabled={retrying}>
          <RefreshCw className={retrying ? 'animate-spin' : ''} /> Retry
        </Button>
      </span>
    );
  }
  if (info.updateAvailable && info.latest) {
    return (
      <a href={info.latest.url} target="_blank" rel="noreferrer">
        <Badge className="gap-1">
          Update Available v{info.latest.version} <ExternalLink className="size-3" />
        </Badge>
      </a>
    );
  }
  return <Badge className="bg-success/15 text-success">Up to Date</Badge>;
}

function SystemTab() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormat();
  const [recheck, setRecheck] = useState(false);
  const info = useQuery(trpc.system.info.queryOptions({ recheck }));
  const view = useQuery(trpc.settings.get.queryOptions({ group: 'system' }));
  const [values, setValues] = useState({ auditRetentionDays: 0, updateCheck: true });
  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.system.info.pathKey() });
        toast.success('Saved');
      },
    }),
  );
  const demo = useMutation(
    trpc.jobs.runDemo.mutationOptions({ onSuccess: () => toast.success('Test job queued. A notification arrives in a few seconds.') }),
  );
  useEffect(() => {
    if (view.data) setValues((v) => ({ ...v, ...(view.data.values as typeof v) }));
  }, [view.data]);
  if (!info.data) return <Spinner />;
  const d = info.data;

  return (
    <div className="grid gap-6">
      <Panel title="Version">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono text-2xl font-semibold tracking-tight">v{d.version}</span>
          <UpdateBadge info={d} retrying={info.isFetching} onRetry={() => setRecheck(true)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          To upgrade, redeploy with a newer image tag. Migrations run on start, after a backup to the bucket.
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">Node {d.node}</p>
      </Panel>

      <Panel title="Background Jobs">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {d.queues.map((q) => (
            <li key={q.name} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
              <StatusDot tone={q.active ? 'ok' : 'off'} />
              <span className="truncate font-mono">{q.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {q.queued} queued · {q.active} active
              </span>
            </li>
          ))}
        </ul>
        {d.dataMigrations.length > 0 && (
          <ul className="mt-3 grid gap-1">
            {d.dataMigrations.map((m) => (
              <li key={m.name} className="flex items-center gap-2 font-mono text-xs">
                <StatusDot tone={m.status === 'done' ? 'ok' : m.status === 'failed' ? 'error' : 'warn'} /> {m.name} · {m.status} · {m.done}
                {m.total ? `/${m.total}` : ''}
                {m.error && <span className="text-destructive">{m.error}</span>}
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="mt-4" onClick={() => demo.mutate({ seconds: 3 })} disabled={demo.isPending}>
          Run a Test Job
        </Button>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Database Migrations" description={`${d.migrations.length} applied`}>
          <ul className="divide-y rounded-md border">
            {d.migrations.map((m) => (
              <li key={m.tag} className="min-w-0 px-3 py-2">
                <div className="truncate font-mono text-xs" title={m.tag}>
                  {m.tag}
                </div>
                <div className="text-xs text-muted-foreground">
                  v{m.appVersion} · {format.dateTime(m.appliedAt)}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Backups" description="Taken before every upgrade that changes the database. The newest five are kept.">
          {d.backups.length === 0 ? (
            <EmptyState title="No Backups Yet">The first one is taken before the first upgrade.</EmptyState>
          ) : (
            <ul className="divide-y rounded-md border">
              {d.backups.map((b) => {
                const backup = describeBackup(b.key);
                return (
                  <li key={b.key} className="flex min-w-0 items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm" title={backup.name}>
                        {backup.when ? format.dateTime(backup.when) : backup.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {backup.reason} · {formatBytes(b.size)} · {formatRelative(b.createdAt)}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <a href={`/api/backups/${encodeURIComponent(backup.name)}`} download aria-label={`Download ${backup.name}`}>
                        <Download />
                      </a>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Options">
        <form
          className="grid max-w-xl gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const { data } = validate(systemSettings, values);
            if (data) update.mutate({ group: 'system', values: data });
          }}
        >
          <label className="flex items-start gap-3">
            <Switch checked={values.updateCheck} onCheckedChange={(c) => setValues((v) => ({ ...v, updateCheck: c }))} />
            <span>
              <span className="block font-medium">Check for New Releases</span>
              <span className="block text-muted-foreground">
                Asks GitHub for the latest release when this page opens. Nothing else is sent.
              </span>
            </span>
          </label>
          <Field label="Keep the Audit Log for (Days)" htmlFor="audit-retention" hint="0 keeps it forever.">
            <Input
              id="audit-retention"
              inputMode="numeric"
              className="w-28 font-mono"
              value={values.auditRetentionDays}
              onChange={(e) => setValues((v) => ({ ...v, auditRetentionDays: Number(e.target.value.replace(/\D/g, '')) }))}
            />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={update.isPending}>
            Save
          </Button>
        </form>
      </Panel>
    </div>
  );
}

export function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const can = useCan();
  const sections = SETTINGS_SECTIONS.filter((s) => !s.permission || can(s.permission));
  const overview = useQuery({ ...trpc.settings.overview.queryOptions(), enabled: can('settings.manage') });
  const current = sections.find((s) => s.key === tab) ?? sections[0];
  if (!current) return <EmptyState title="Nothing to Show">You do not have access to any settings.</EmptyState>;
  const configured: Record<string, boolean | undefined> = {
    email: overview.data?.email,
    ai: overview.data?.ai,
    errors: overview.data?.errorTracking,
  };

  return (
    <>
      <PageHeader title="Admin Settings" description="Changes apply at once, without a restart, and are recorded in the audit log." />
      <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Settings">
          {sections.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => navigate(s.path)}
              aria-current={current.key === s.key ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                current.key === s.key && 'bg-accent text-foreground',
              )}
            >
              {s.title}
              {s.key in configured && overview.data && <StatusDot tone={configured[s.key] ? 'ok' : 'off'} />}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-4">
            <h2 className="font-medium">{current.title}</h2>
            <p className="text-muted-foreground">{current.description}</p>
          </div>
          {current.key === 'company' && <CompanyForm />}
          {current.key === 'users' && <UsersSection />}
          {current.key === 'email' && <EmailForm />}
          {current.key === 'ai' && <AiForm />}
          {current.key === 'errors' && <ErrorTrackingForm />}
          {current.key === 'storage' && <StorageTab />}
          {current.key === 'security' && <SecurityTab />}
          {current.key === 'audit-log' && <AuditSection />}
          {current.key === 'system' && <SystemTab />}
        </div>
      </div>
    </>
  );
}
