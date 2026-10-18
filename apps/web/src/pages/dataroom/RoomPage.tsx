import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Lock, LockOpen } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, PageHeader, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { ActivityTab } from './ActivityTab';
import { ContentTab } from './ContentTab';
import { StatusBadge } from './common';
import { LinksTab } from './LinksTab';
import { RoomSettingsTab } from './RoomSettingsTab';
import { VisitorsTab } from './VisitorsTab';

const TABS = [
  { key: 'content', label: 'Content' },
  { key: 'links', label: 'Links' },
  { key: 'visitors', label: 'Visitors' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings', manage: true },
] as const;

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const can = useCan();
  const room = useQuery(trpc.dataroom.get.queryOptions({ roomId }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.dataroom.pathKey() });
  const open = useMutation(
    trpc.dataroom.open.mutationOptions({
      onSuccess: () => {
        void refresh();
        toast.success('The room is open. Its active links work now.');
      },
    }),
  );
  const close = useMutation(
    trpc.dataroom.close.mutationOptions({
      onSuccess: () => {
        void refresh();
        toast.success('The room is closed. No link works until you open it again.');
      },
    }),
  );

  if (room.isLoading) return <Spinner />;
  if (!room.data)
    return (
      <EmptyState title="Dataroom Not Found">
        <Link to="/documents/dataroom" className="text-primary">
          Back to Datarooms
        </Link>
      </EmptyState>
    );
  const r = room.data;
  const tabs = TABS.filter((t) => !('manage' in t) || can('dataroom.manage'));
  const tab = tabs.find((t) => t.key === params.get('tab'))?.key ?? 'content';

  return (
    <>
      <nav aria-label="Dataroom" className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/documents/dataroom" className="hover:text-foreground">
          Datarooms
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="truncate font-medium text-foreground">{r.name}</span>
      </nav>
      <PageHeader
        title={r.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} live={r.live} />
            {r.status === 'draft' && 'Only your team can see it until you open it.'}
            {r.status === 'closed' && 'No link works. Statistics are kept.'}
            {r.status === 'open' && !r.live && 'Its closing time has passed, so no link works.'}
          </span>
        }
        actions={
          can('dataroom.manage') &&
          (r.status === 'open' ? (
            <Button variant="outline" onClick={() => close.mutate({ roomId })} disabled={close.isPending}>
              <Lock /> Close Room
            </Button>
          ) : (
            <Button onClick={() => open.mutate({ roomId })} disabled={open.isPending}>
              <LockOpen /> Open Room
            </Button>
          ))
        }
      />
      <nav className="mb-5 flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setParams(t.key === 'content' ? {} : { tab: t.key }, { replace: true })}
            className={cn(
              '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground',
              tab === t.key && 'border-primary text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'content' && <ContentTab room={r} />}
      {tab === 'links' && <LinksTab room={r} />}
      {tab === 'visitors' && <VisitorsTab room={r} />}
      {tab === 'activity' && <ActivityTab room={r} />}
      {tab === 'settings' && <RoomSettingsTab room={r} />}
    </>
  );
}
