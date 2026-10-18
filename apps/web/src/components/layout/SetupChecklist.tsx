import type { SetupChecklistItem } from '@openinc/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Circle, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTRPC } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { RailTip, useRail } from './rail';

export const CHECKLIST: Record<SetupChecklistItem, { title: string; to: string }> = {
  email: { title: 'Set Up Real Email', to: '/settings/email' },
  invite: { title: 'Invite the Team', to: '/settings/users?invite=1' },
  twoFactor: { title: 'Turn On Two-Factor', to: '/settings/account#security' },
  ai: { title: 'Add an AI Provider', to: '/settings/ai' },
};

export function useChecklist() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const query = useQuery(trpc.setup.checklist.queryOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.setup.checklist.queryKey() });
  const dismiss = useMutation(trpc.setup.dismissChecklist.mutationOptions({ onSuccess: refresh }));
  const show = useMutation(trpc.setup.showChecklist.mutationOptions({ onSuccess: refresh }));
  return { data: query.data, dismiss: () => dismiss.mutate({}), show: () => show.mutate({}) };
}

function ProgressRing({ value }: { value: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 18 18" className="size-[18px] -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={`${c * value} ${c}`}
      />
    </svg>
  );
}

/** What is left after the setup wizard, in the sidebar until it is done or dismissed (per person). */
export function SetupChecklist({ onNavigate }: { onNavigate?: () => void }) {
  const { data, dismiss } = useChecklist();
  const [open, setOpen] = useState(false);
  const { collapsed, expand } = useRail();
  if (!data?.visible) return null;
  const items = Object.entries(data.items) as [SetupChecklistItem, boolean][];
  const done = items.filter(([, d]) => d).length;
  if (collapsed)
    return (
      <div className="mb-2 px-2">
        <RailTip label={`Finish Setting Up (${done} of ${items.length} Done)`}>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              expand();
            }}
            aria-label="Finish Setting Up"
            className="flex size-9 items-center justify-center rounded-md border bg-background hover:bg-sidebar-accent"
            data-testid="setup-checklist"
          >
            <ProgressRing value={done / items.length} />
          </button>
        </RailTip>
      </div>
    );
  return (
    <div className="mx-2 mb-2 rounded-lg border bg-background p-2.5" data-testid="setup-checklist">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] font-medium"
          aria-expanded={open}
        >
          <span className="truncate">Finish Setting Up</span>
          <ChevronDown className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Dismiss Setup Checklist"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        {done} of {items.length} Done
      </div>
      {open && (
        <ul className="mt-2 grid gap-0.5">
          {items.map(([key, isDone]) => (
            <li key={key}>
              <Link
                to={CHECKLIST[key].to}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-1.5 rounded px-1 py-1 text-xs hover:bg-accent',
                  isDone && 'text-muted-foreground line-through',
                )}
              >
                {isDone ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                ) : (
                  <Circle className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{CHECKLIST[key].title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
