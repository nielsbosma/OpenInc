import type { DataRoomStatus } from '@openinc/shared';
import { StatusDot } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import type { RouterOutputs } from '@/lib/trpc';

export type Room = RouterOutputs['dataroom']['get'];
export type RoomLink = RouterOutputs['dataroom']['links'][number];

export function StatusBadge({ status, live }: { status: DataRoomStatus; live: boolean }) {
  const label = status === 'open' ? (live ? 'Open' : 'Past Closing') : status === 'draft' ? 'Draft' : 'Closed';
  return (
    <Badge variant="outline" className="gap-1.5">
      <StatusDot tone={status === 'open' && live ? 'ok' : status === 'draft' ? 'warn' : 'off'} />
      {label}
    </Badge>
  );
}

export function LinkStatusBadge({ status }: { status: RoomLink['status'] }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <StatusDot tone={status === 'active' ? 'ok' : 'off'} />
      {status === 'active' ? 'Active' : status === 'expired' ? 'Expired' : 'Revoked'}
    </Badge>
  );
}

/** Room folders as indented options, parents before their children, for pickers. */
export function folderOptions(folders: Room['folders'], top = 'Top Level') {
  const out: { value: string; label: string }[] = [{ value: '', label: top }];
  const walk = (parentId: string | null, prefix: string) => {
    for (const f of folders.filter((x) => x.parentId === parentId)) {
      out.push({ value: f.id, label: `${prefix}${f.name}` });
      walk(f.id, `${prefix}${f.name} / `);
    }
  };
  walk(null, '');
  return out;
}

export const percent = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`);
