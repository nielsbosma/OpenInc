import { formatMoney } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { BookUser, Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, Field, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTRPC } from '@/lib/trpc';
import { exportUrl, fmt, fmtRanges, HOLDER_KIND_LABELS, today } from './common';

function Stat({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? 'mt-1 font-mono text-base' : 'mt-1 text-base'}>{value}</div>
    </div>
  );
}

export function ExportMenu({ asOf }: { asOf: string }) {
  const item = (label: string, kind: string, params: Record<string, string | undefined>) => (
    <DropdownMenuItem asChild>
      <a href={exportUrl(kind, params)} target={params.format === 'pdf' ? '_blank' : undefined} rel="noreferrer">
        {label}
      </a>
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Register on {asOf}</DropdownMenuLabel>
        {item('PDF in English', 'register', { asOf, format: 'pdf', lang: 'en' })}
        {item('PDF in Swedish (Aktiebok)', 'register', { asOf, format: 'pdf', lang: 'sv' })}
        {item('Excel (XLSX)', 'register', { asOf, format: 'xlsx', lang: 'en' })}
        {item('CSV', 'register', { asOf, format: 'csv' })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Full History</DropdownMenuLabel>
        {item('History as PDF', 'history', { format: 'pdf', lang: 'en' })}
        {item('History as Excel (XLSX)', 'history', { format: 'xlsx', lang: 'en' })}
        {item('History as CSV', 'history', { format: 'csv' })}
        {item('Everything as JSON', 'full', {})}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RegisterTab() {
  const trpc = useTRPC();
  const [asOf, setAsOf] = useState(today());
  const register = useQuery(trpc.registry.getRegister.queryOptions({ asOf }, { placeholderData: (prev) => prev }));
  const data = register.data;
  if (register.isLoading) return <Spinner />;
  if (!data) return null;
  const money = (v: bigint) => formatMoney(v, data.currency);
  const pledgedTotal = data.pledges.reduce((s, p) => s + p.count, 0n);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="As of Date" htmlFor="register-as-of" className="w-44">
          <Input id="register-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </Field>
        <ExportMenu asOf={asOf} />
      </div>
      {!data.initialized ? (
        <EmptyState icon={<BookUser />} title="No Shares Yet">
          Start the register with an incorporation for a new company, or an opening balance to carry over an existing register.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Share Capital" value={money(data.shareCapital)} />
            <Stat label="Shares" value={fmt(data.totalShares)} />
            <Stat label="Votes" value={fmt(data.totalVotes)} />
            <Stat label="Quota Value per Share" value={`${fmt(data.quotaValue)} ${data.currency}`} />
          </div>
          {(data.interimIssues.length > 0 || pledgedTotal > 0n) && (
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {data.interimIssues.length > 0 && <Badge variant="secondary">Interim shares waiting for registration</Badge>}
              {pledgedTotal > 0n && <Badge variant="secondary">{fmt(pledgedTotal)} shares pledged</Badge>}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holder</TableHead>
                  <TableHead>ID Number</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead className="text-right">Shares</TableHead>
                  {data.numbering && <TableHead>Share Numbers</TableHead>}
                  <TableHead className="text-right">Votes</TableHead>
                  <TableHead className="text-right">Capital %</TableHead>
                  <TableHead className="text-right">Votes %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.holders.map((h) =>
                  h.positions.map((p, i) => (
                    <TableRow key={`${h.holderId}-${p.classCode}-${p.interim}`}>
                      {i === 0 && (
                        <>
                          <TableCell rowSpan={h.positions.length} className="align-top">
                            <Link to={`/registry/holders/${h.holderId}`} className="font-medium hover:underline">
                              {h.name}
                            </Link>
                            <div className="text-xs text-muted-foreground">{HOLDER_KIND_LABELS[h.kind]}</div>
                          </TableCell>
                          <TableCell rowSpan={h.positions.length} className="align-top font-mono text-xs">
                            {h.nationalId}
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        {p.classCode}
                        {p.interim && (
                          <Badge variant="secondary" className="ml-2">
                            Interim
                          </Badge>
                        )}
                        {p.pledged > 0n && (
                          <Badge variant="outline" className="ml-2">
                            {fmt(p.pledged)} Pledged
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">{fmt(p.count)}</TableCell>
                      {data.numbering && <TableCell className="max-w-64 font-mono text-xs">{fmtRanges(p.ranges)}</TableCell>}
                      {i === 0 && (
                        <>
                          <TableCell rowSpan={h.positions.length} className="text-right align-top font-mono">
                            {fmt(h.votes)}
                          </TableCell>
                          <TableCell rowSpan={h.positions.length} className="text-right align-top font-mono">
                            {h.capitalPct}
                          </TableCell>
                          <TableCell rowSpan={h.positions.length} className="text-right align-top font-mono">
                            {h.votesPct}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  )),
                )}
              </TableBody>
            </Table>
          </div>
          {data.warnings.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {data.warnings.map((w, i) => (
                <li key={i}>⚠ {w.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
