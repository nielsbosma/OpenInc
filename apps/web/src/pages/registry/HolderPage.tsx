import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Field, Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTRPC } from '@/lib/trpc';
import { exportUrl, fmt, fmtRanges, HOLDER_KIND_LABELS, StatusBadge, today } from './common';

export function HolderPage() {
  const { id = '' } = useParams();
  const trpc = useTRPC();
  const [asOf, setAsOf] = useState(today());
  const holder = useQuery(trpc.registry.getHolder.queryOptions({ holderId: id, asOf }, { placeholderData: (prev) => prev }));
  if (holder.isLoading) return <Spinner />;
  if (!holder.data) return null;
  const h = holder.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/registry" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3" /> Register
          </Link>
          <h2 className="text-lg font-semibold">{h.current.name}</h2>
          <p className="text-muted-foreground">
            {HOLDER_KIND_LABELS[h.current.kind]} · <span className="font-mono">{h.current.nationalId || 'no ID number'}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="As of Date" htmlFor="holder-as-of" className="w-44">
            <Input id="holder-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </Field>
          <Button variant="outline" asChild>
            <a href={exportUrl('holder', { holderId: id, asOf, lang: 'en' })} target="_blank" rel="noreferrer">
              <Download /> Extract
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={exportUrl('holder', { holderId: id, asOf, lang: 'sv' })} target="_blank" rel="noreferrer">
              <Download /> Extract in Swedish
            </a>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Holdings on {h.asOf}</CardTitle>
          </CardHeader>
          <CardContent>
            {!h.position ? (
              <p className="text-muted-foreground">No shares on this date.</p>
            ) : (
              <div className="grid gap-2">
                {h.position.positions.map((p) => (
                  <div key={`${p.classCode}-${p.interim}`} className="flex justify-between gap-3 border-b pb-2 last:border-0">
                    <div>
                      <div className="font-medium">
                        {p.classCode} {p.interim && <span className="text-xs text-muted-foreground">(interim)</span>}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{fmtRanges(p.ranges)}</div>
                      {p.pledged > 0n && <div className="text-xs text-muted-foreground">{fmt(p.pledged)} pledged</div>}
                    </div>
                    <div className="font-mono">{fmt(p.count)}</div>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground">
                  {h.position.capitalPct}% of capital · {h.position.votesPct}% of votes
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details Over Time</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {[...h.versions].reverse().map((v) => (
              <div key={v.id} className="border-b pb-2 last:border-0">
                <div className="text-xs text-muted-foreground">
                  From <span className="font-mono">{v.validFrom}</span>
                  {v.validTo && <span className="font-mono"> to {v.validTo}</span>}
                </div>
                <div>{v.name}</div>
                <div className="text-xs text-muted-foreground">{[v.address, v.email].filter(Boolean).join(' · ')}</div>
                {v.members.length > 0 && <div className="text-xs text-muted-foreground">{v.members.map((m) => m.name).join(', ')}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">#</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Transaction</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {h.transactions.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-mono text-xs">{t.seq}</TableCell>
                <TableCell className="font-mono text-xs">{t.effectiveDate}</TableCell>
                <TableCell>
                  <Link to={`/registry/transactions/${t.id}`} className="hover:underline">
                    {t.summary}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={t.status} label={t.statusLabel} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
