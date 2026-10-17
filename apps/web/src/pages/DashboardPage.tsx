import { formatRelative, type SetupChecklistItem } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/common';
import { MODULES } from '@/components/layout/nav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useClientConfig, useSession } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const CHECKLIST: Record<SetupChecklistItem, { title: string; description: string; to: string }> = {
  email: { title: 'Set up real email', description: 'So invitations and password resets reach people.', to: '/admin/settings/email' },
  invite: { title: 'Invite your team', description: 'Admins, members or read-only accounts.', to: '/admin/users?invite=1' },
  twoFactor: { title: 'Turn on two-factor', description: 'Protect your account with an authenticator app.', to: '/account/security' },
  ai: { title: 'Add an AI provider', description: 'Turns on the assistant in the right-hand panel.', to: '/admin/settings/ai' },
};

function SetupChecklist() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data } = useQuery(trpc.setup.checklist.queryOptions());
  const dismiss = useMutation(
    trpc.setup.dismissChecklist.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.setup.checklist.queryKey() }),
    }),
  );
  if (!data?.visible) return null;
  const items = Object.entries(data.items) as [SetupChecklistItem, boolean][];
  const done = items.filter(([, d]) => d).length;
  return (
    <Card className="mb-6 shadow-none">
      <CardHeader>
        <CardTitle>Finish setting up</CardTitle>
        <CardDescription>
          {done} of {items.length} done
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => dismiss.mutate({})}>
            Dismiss
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map(([key, isDone]) => (
          <Link
            key={key}
            to={CHECKLIST[key].to}
            className={cn(
              'group flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent',
              isDone && 'opacity-60',
            )}
          >
            {isDone ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className={cn('block font-medium', isDone && 'line-through')}>{CHECKLIST[key].title}</span>
              <span className="block text-muted-foreground">{CHECKLIST[key].description}</span>
            </span>
            {!isDone && (
              <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            )}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const trpc = useTRPC();
  const { user } = useSession();
  const config = useClientConfig();
  const summary = useQuery(trpc.dashboard.summary.queryOptions());
  return (
    <>
      <PageHeader title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`} description={config?.companyName ?? undefined} />
      <SetupChecklist />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>People with access</CardDescription>
            <CardTitle className="font-mono text-2xl">{summary.data?.activeUsers ?? '–'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>Currency</CardDescription>
            <CardTitle className="font-mono text-2xl">{config?.currency ?? '–'}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>Time zone</CardDescription>
            <CardTitle className="truncate text-lg">{config?.timeZone?.replace(/_/g, ' ') ?? '–'}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section>
          <h2 className="mb-3 font-medium">Modules</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODULES.map((m) => (
              <Link key={m.path} to={m.path} className="rounded-lg border p-4 transition-colors hover:bg-accent">
                <div className="flex items-center gap-2">
                  <m.icon className="size-4 text-primary" />
                  <span className="font-medium">{m.title}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] font-normal text-muted-foreground">
                    Coming soon
                  </Badge>
                </div>
                <p className="mt-1.5 text-muted-foreground">{m.description}</p>
              </Link>
            ))}
          </div>
        </section>
        {!!summary.data?.recentActivity.length && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium">Recent activity</h2>
              <Link to="/admin/audit" className="text-xs text-muted-foreground hover:text-foreground">
                Audit log →
              </Link>
            </div>
            <ul className="divide-y rounded-lg border">
              {summary.data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 px-3 py-2">
                  <span className="font-mono text-xs">{a.action}</span>
                  <span className="truncate text-muted-foreground">{a.actorLabel}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatRelative(a.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
