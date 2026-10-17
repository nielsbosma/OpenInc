import { formatBytes, formatRelative, securitySettings, systemSettings } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, XCircle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Field, PageHeader, Spinner, StatusDot, validate } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { AiForm, CompanyForm, EmailForm, ErrorTrackingForm } from './forms';

const TABS = [
  { key: 'company', label: 'Company', description: 'Name, registration number, address, currency, time zone and logo.' },
  { key: 'email', label: 'Email', description: 'The SMTP server for invitations, password resets and notifications.' },
  { key: 'ai', label: 'AI', description: 'The provider behind the assistant. The assistant is hidden while this is empty.' },
  { key: 'errors', label: 'Error tracking', description: 'Send server and browser errors to Bugsink or Sentry.' },
  { key: 'storage', label: 'Storage', description: 'The S3 bucket for files and database backups. Set with environment variables.' },
  { key: 'security', label: 'Security', description: 'Two-factor rules and how long sessions last.' },
  { key: 'system', label: 'System', description: 'Version, updates, database migrations, backups and background jobs.' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

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
    ['Database backups', `${d.backups} · ${formatBytes(d.backupBytes)}`],
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
        {test.isPending && <Spinner />} Test storage
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
          <span className="block font-medium">Require two-factor authentication</span>
          <span className="block text-muted-foreground">
            People without it must set it up before they can do anything else. MCP clients stop working for them until they do.
          </span>
        </span>
      </label>
      <Field
        label="Session length (days)"
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

function SystemTab() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const format = useFormat();
  const info = useQuery(trpc.system.info.queryOptions());
  const view = useQuery(trpc.settings.get.queryOptions({ group: 'system' }));
  const [values, setValues] = useState({ auditRetentionDays: 0, updateCheck: true });
  const update = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: trpc.system.info.queryKey() });
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
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-lg">v{d.version}</span>
          {d.updateAvailable && d.latest ? (
            <a href={d.latest.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
              v{d.latest.version} is available <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="text-muted-foreground">
              {d.updateCheck ? (d.latest ? 'Up to date' : 'Could not check for updates') : 'Update check is off'}
            </span>
          )}
          <span className="ml-auto font-mono text-xs text-muted-foreground">Node {d.node}</span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          To upgrade, redeploy with a newer image tag. Migrations run on start, after a backup to the bucket.
        </p>
      </Panel>

      <Panel title="Background jobs">
        <div className="mb-3 flex flex-wrap gap-2">
          {d.queues.map((q) => (
            <span key={q.name} className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs">
              <StatusDot tone={q.active ? 'ok' : 'off'} /> {q.name}
              <span className="text-muted-foreground">
                {q.queued} queued · {q.active} active
              </span>
            </span>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => demo.mutate({ seconds: 3 })} disabled={demo.isPending}>
          Run a test job
        </Button>
        {d.dataMigrations.length > 0 && (
          <ul className="mt-4 grid gap-1">
            {d.dataMigrations.map((m) => (
              <li key={m.name} className="flex items-center gap-2 font-mono text-xs">
                <StatusDot tone={m.status === 'done' ? 'ok' : m.status === 'failed' ? 'error' : 'warn'} /> {m.name} · {m.status} · {m.done}
                {m.total ? `/${m.total}` : ''}
                {m.error && <span className="text-destructive">{m.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Database migrations" description={`${d.migrations.length} applied`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Migration</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.migrations.map((m) => (
                <TableRow key={m.tag}>
                  <TableCell className="font-mono text-xs">{m.tag}</TableCell>
                  <TableCell className="font-mono text-xs">v{m.appVersion}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{format.dateTime(m.appliedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
        <Panel title="Backups" description="Taken before every upgrade that changes the database. The newest five are kept in the bucket.">
          {d.backups.length === 0 ? (
            <p className="text-muted-foreground">No backups yet. The first one is taken before the first upgrade.</p>
          ) : (
            <ul className="grid gap-1">
              {d.backups.map((b) => (
                <li key={b.key} className="flex justify-between gap-2 font-mono text-xs">
                  <span className="truncate">{b.key.replace('backups/', '')}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatBytes(b.size)} · {formatRelative(b.createdAt)}
                  </span>
                </li>
              ))}
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
              <span className="block font-medium">Check for new releases</span>
              <span className="block text-muted-foreground">
                Asks GitHub for the latest release when this page opens. Nothing else is sent.
              </span>
            </span>
          </label>
          <Field label="Keep the audit log for (days)" htmlFor="audit-retention" hint="0 keeps it forever.">
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
  const { tab = 'company' } = useParams();
  const navigate = useNavigate();
  const trpc = useTRPC();
  const overview = useQuery(trpc.settings.overview.queryOptions());
  const current = (TABS.some((t) => t.key === tab) ? tab : 'company') as TabKey;
  const meta = TABS.find((t) => t.key === current)!;
  const configured: Partial<Record<TabKey, boolean>> = {
    email: overview.data?.email,
    ai: overview.data?.ai,
    errors: overview.data?.errorTracking,
  };

  return (
    <>
      <PageHeader title="Admin settings" description="Changes apply at once, without a restart, and are recorded in the audit log." />
      <div className="grid gap-6 md:grid-cols-[180px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Settings">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => navigate(`/admin/settings/${t.key}`)}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                current === t.key && 'bg-accent text-foreground',
              )}
            >
              {t.label}
              {t.key in configured && <StatusDot tone={configured[t.key] ? 'ok' : 'off'} />}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-4">
            <h2 className="font-medium">{meta.label}</h2>
            <p className="text-muted-foreground">{meta.description}</p>
          </div>
          {current === 'company' && <CompanyForm />}
          {current === 'email' && <EmailForm />}
          {current === 'ai' && <AiForm />}
          {current === 'errors' && <ErrorTrackingForm />}
          {current === 'storage' && <StorageTab />}
          {current === 'security' && <SecurityTab />}
          {current === 'system' && <SystemTab />}
        </div>
      </div>
    </>
  );
}
