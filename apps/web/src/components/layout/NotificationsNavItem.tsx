import { formatRelative } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/** Sidebar item with the unread count; opens the latest notifications beside it. */
export function NotificationsNavItem() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery(trpc.notifications.list.queryOptions({ limit: 20 }, { refetchInterval: 30_000 }));
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.notifications.pathKey() });
  const markRead = useMutation(trpc.notifications.markRead.mutationOptions({ onSuccess: invalidate }));
  const markAll = useMutation(trpc.notifications.markAllRead.mutationOptions({ onSuccess: invalidate }));
  const unread = data?.unread ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-4 shrink-0 opacity-80" />
          <span className="truncate">Notifications</span>
          {unread > 0 && (
            <span className="ml-auto flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-mono text-[10px] leading-5 text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={8} className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-medium">Notifications</span>
          <Button variant="ghost" size="xs" disabled={!unread} onClick={() => markAll.mutate({})}>
            Mark All Read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {!data?.items.length ? (
            <p className="px-3 py-8 text-center text-muted-foreground">Nothing Yet</p>
          ) : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="flex w-full gap-2.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent"
                    onClick={() => {
                      if (!n.readAt) markRead.mutate({ notificationId: n.id });
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} />
                    <span className="min-w-0">
                      <span className="block font-medium">{n.title}</span>
                      {n.body && <span className="line-clamp-2 block text-muted-foreground">{n.body}</span>}
                      <span className="mt-0.5 block text-xs text-muted-foreground">{formatRelative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
