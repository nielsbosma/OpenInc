import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadCsv, formatDuration } from '@/lib/csv';
import { useFormat } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { percent, type Room } from './common';

export function ActivityTab({ room }: { room: Room }) {
  const trpc = useTRPC();
  const format = useFormat();
  const stats = useQuery(trpc.dataroom.stats.queryOptions({ roomId: room.id }));
  const [doc, setDoc] = useState<{ id: string; name: string } | null>(null);

  if (stats.isLoading) return <Spinner />;
  if (!stats.data) return null;
  const { overview, daily, documents } = stats.data;
  if (!overview.lastActivityAt)
    return (
      <EmptyState icon={<BarChart3 />} title="No Activity Yet">
        Once visitors open the room you see here which documents they read, for how long, and how far they got.
      </EmptyState>
    );

  const tiles = [
    { label: 'Visitors', value: String(overview.visitors) },
    { label: 'Visits', value: String(overview.visits) },
    { label: 'Document Views', value: String(overview.views) },
    { label: 'Downloads', value: String(overview.downloads) },
    { label: 'Time Spent', value: formatDuration(overview.totalTimeMs) },
  ];
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border px-4 py-3">
            <div className="text-xs text-muted-foreground">{t.label}</div>
            <div className="mt-1 font-mono text-xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Last activity {format.dateTime(overview.lastActivityAt)}
        {overview.failedPasswords > 0 &&
          ` · ${overview.failedPasswords} wrong ${overview.failedPasswords === 1 ? 'password' : 'passwords'}`}
      </p>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Visits per Day</CardTitle>
        </CardHeader>
        <CardContent>
          <Bars
            label="Visits per day"
            rows={daily.map((d) => ({
              key: d.date,
              value: d.visits,
              label: format.date(`${d.date}T12:00:00Z`),
              title: `${d.visits} visits, ${d.views} document views`,
            }))}
          />
        </CardContent>
      </Card>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Documents</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(
                `${room.name} documents.csv`,
                [
                  'Document',
                  'In the Room',
                  'Unique Visitors',
                  'Views',
                  'Downloads',
                  'Total Time (Minutes)',
                  'Average Time (Minutes)',
                  'Pages',
                  'Pages Reached',
                ],
                documents.map((d) => [
                  d.name,
                  d.inRoom ? 'yes' : 'no',
                  d.uniqueVisitors,
                  d.views,
                  d.downloads,
                  Math.round(d.totalTimeMs / 60000),
                  Math.round(d.avgTimeMs / 60000),
                  d.pageCount ?? '',
                  d.pagesReached === null ? '' : Math.round(d.pagesReached * 100),
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
                <TableHead>Document</TableHead>
                <TableHead className="w-28 text-right">Visitors</TableHead>
                <TableHead className="hidden w-24 text-right sm:table-cell">Views</TableHead>
                <TableHead className="hidden w-28 text-right md:table-cell">Downloads</TableHead>
                <TableHead className="w-28 text-right">Total Time</TableHead>
                <TableHead className="hidden w-32 text-right md:table-cell">Average Time</TableHead>
                <TableHead className="hidden w-32 text-right lg:table-cell">Pages Reached</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.documentId}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium hover:underline"
                      onClick={() => setDoc({ id: d.documentId, name: d.name })}
                    >
                      {d.name}
                    </button>
                    {!d.inRoom && <span className="ml-2 text-xs text-muted-foreground">no longer in the room</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{d.uniqueVisitors}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs sm:table-cell">{d.views}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs md:table-cell">{d.downloads}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatDuration(d.totalTimeMs)}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs md:table-cell">{formatDuration(d.avgTimeMs)}</TableCell>
                  <TableCell className="hidden text-right font-mono text-xs lg:table-cell">{percent(d.pagesReached)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <DocumentDialog roomId={room.id} doc={doc} onClose={() => setDoc(null)} />
    </div>
  );
}

/** A plain bar chart: one bar per row, its value on hover and in the accessible label. */
function Bars({ rows, label }: { rows: { key: string; value: number; label: string; title: string }[]; label: string }) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  const every = Math.max(1, Math.ceil(rows.length / 8));
  return (
    <figure aria-label={label} className="grid gap-1">
      <div className="flex h-32 items-end gap-0.5 border-b">
        {rows.map((r) => (
          <div key={r.key} className="flex h-full min-w-0 flex-1 items-end" title={`${r.label}: ${r.title}`}>
            <div
              role="img"
              aria-label={`${r.label}: ${r.title}`}
              className="w-full rounded-t-sm bg-primary/80 hover:bg-primary"
              style={{ height: `${(r.value / top) * 100}%`, minHeight: r.value ? 2 : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 text-[10px] text-muted-foreground">
        {rows.map((r, i) => (
          <div key={r.key} className="min-w-0 flex-1 truncate text-center">
            {i % every === 0 ? r.label : ''}
          </div>
        ))}
      </div>
    </figure>
  );
}

function DocumentDialog({ roomId, doc, onClose }: { roomId: string; doc: { id: string; name: string } | null; onClose: () => void }) {
  const trpc = useTRPC();
  const format = useFormat();
  const stats = useQuery({ ...trpc.dataroom.documentStats.queryOptions({ roomId, documentId: doc?.id ?? '' }), enabled: !!doc });
  const s = stats.data;
  return (
    <Dialog open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{doc?.name}</DialogTitle>
          <DialogDescription>Reading time per page, and who read it.</DialogDescription>
        </DialogHeader>
        {!s ? (
          <Spinner />
        ) : (
          <div className="grid gap-5">
            {s.pages.length ? (
              <Bars
                label="Time per page"
                rows={s.pages.map((p) => ({
                  key: String(p.page),
                  value: p.timeMs,
                  label: String(p.page),
                  title: `page ${p.page}, ${formatDuration(p.timeMs)}, ${p.viewers} ${p.viewers === 1 ? 'reader' : 'readers'}`,
                }))}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No page-by-page reading recorded. Files that can only be downloaded have none.
              </p>
            )}
            {s.visitors.length > 0 && (
              <ul className="divide-y rounded-md border">
                {s.visitors.map((v) => (
                  <li key={v.visitorId} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{v.email}</span>
                    {v.furthestPage && <span className="shrink-0 text-xs text-muted-foreground">to page {v.furthestPage}</span>}
                    {v.downloaded && <span className="shrink-0 text-xs text-muted-foreground">downloaded</span>}
                    <span className="shrink-0 font-mono text-xs">{formatDuration(v.timeSpentMs)}</span>
                    {v.lastViewedAt && (
                      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{format.dateTime(v.lastViewedAt)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
