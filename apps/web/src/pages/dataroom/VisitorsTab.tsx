import { useQuery } from '@tanstack/react-query';
import { Download, Users } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadCsv, formatDuration } from '@/lib/csv';
import { useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import type { Room } from './common';

export function VisitorsTab({ room }: { room: Room }) {
  const trpc = useTRPC();
  const format = useFormat();
  const visitors = useQuery(trpc.dataroom.visitors.queryOptions({ roomId: room.id }));
  const [open, setOpen] = useState<string | null>(null);

  if (visitors.isLoading) return <Spinner />;
  const rows = visitors.data ?? [];
  if (!rows.length)
    return (
      <EmptyState icon={<Users />} title="No Visitors Yet">
        Everyone who opens a link shows up here with the time they spent and what they opened.
      </EmptyState>
    );
  return (
    <div className="grid gap-4">
      <div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCsv(
              `${room.name} visitors.csv`,
              [
                'Email',
                'Name',
                'Company',
                'Links',
                'First Visit',
                'Last Visit',
                'Visits',
                'Time Spent (Minutes)',
                'Documents Opened',
                'Downloads',
                'NDA Accepted',
              ],
              rows.map((v) => [
                v.email ?? 'anonymous',
                v.name,
                v.company,
                v.links.join('; '),
                format.dateTime(v.firstVisitAt),
                format.dateTime(v.lastVisitAt),
                v.visits,
                Math.round(v.timeSpentMs / 60000),
                v.documentsOpened,
                v.downloads,
                v.ndaAcceptedAt ? format.dateTime(v.ndaAcceptedAt) : '',
              ]),
            )
          }
        >
          <Download /> Export CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Visitor</TableHead>
              <TableHead className="hidden w-40 md:table-cell">Link</TableHead>
              <TableHead className="hidden w-44 lg:table-cell">First Visit</TableHead>
              <TableHead className="w-44">Last Visit</TableHead>
              <TableHead className="hidden w-28 text-right sm:table-cell">Time Spent</TableHead>
              <TableHead className="hidden w-36 text-right sm:table-cell">Documents Opened</TableHead>
              <TableHead className="hidden w-28 text-right md:table-cell">Downloads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v, i) => (
              <TableRow key={v.id ?? `anon-${i}`}>
                <TableCell>
                  {v.id ? (
                    <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(v.id)}>
                      {v.email}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">Anonymous</span>
                  )}
                  {(v.name || v.company) && (
                    <div className="text-xs text-muted-foreground">{[v.name, v.company].filter(Boolean).join(', ')}</div>
                  )}
                </TableCell>
                <TableCell className="hidden truncate text-muted-foreground md:table-cell">{v.links.join(', ') || '—'}</TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">{format.dateTime(v.firstVisitAt)}</TableCell>
                <TableCell className="text-muted-foreground">{format.dateTime(v.lastVisitAt)}</TableCell>
                <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{formatDuration(v.timeSpentMs)}</TableCell>
                <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{v.documentsOpened}</TableCell>
                <TableCell className="hidden text-right font-mono text-xs md:table-cell">{v.downloads}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <VisitorSheet roomId={room.id} visitorId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function VisitorSheet({ roomId, visitorId, onClose }: { roomId: string; visitorId: string | null; onClose: () => void }) {
  const trpc = useTRPC();
  const format = useFormat();
  const visitor = useQuery({ ...trpc.dataroom.visitor.queryOptions({ roomId, visitorId: visitorId ?? '' }), enabled: !!visitorId });
  const v = visitor.data;
  return (
    <Sheet open={!!visitorId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{v?.email ?? 'Visitor'}</SheetTitle>
          <SheetDescription>
            {v
              ? [
                  [v.name, v.company].filter(Boolean).join(', '),
                  v.verifiedAt ? 'email verified' : '',
                  v.ndaAcceptedAt ? `NDA accepted ${format.dateTime(v.ndaAcceptedAt)}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No name or company given.'
              : ' '}
          </SheetDescription>
        </SheetHeader>
        {!v ? (
          <div className="px-4">
            <Spinner />
          </div>
        ) : (
          <div className="grid gap-6 px-4 pb-6">
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Time on Each Document</h3>
              {!v.documents.length ? (
                <p className="text-sm text-muted-foreground">Has not opened a document yet.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {v.documents.map((d) => (
                    <li key={d.documentId} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      {d.downloads > 0 && <span className="shrink-0 text-xs text-muted-foreground">downloaded</span>}
                      <span className="shrink-0 font-mono text-xs">{formatDuration(d.timeSpentMs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Timeline</h3>
              <ol className="grid gap-2 border-l pl-4">
                {v.timeline.map((t, i) => (
                  <li key={i} className="text-sm">
                    <span className="block text-xs text-muted-foreground">{format.dateTime(t.at)}</span>
                    {t.label}
                    {t.document && <span className="font-medium"> {t.document}</span>}
                    {t.type === 'page_viewed' && t.page && (
                      <span className="text-muted-foreground">
                        , page {t.page} for {formatDuration(t.durationMs ?? 0)}
                      </span>
                    )}
                    {t.type === 'room_opened' && t.link && <span className="text-muted-foreground"> through {t.link}</span>}
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
