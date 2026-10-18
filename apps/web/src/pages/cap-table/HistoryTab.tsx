import { useQuery } from '@tanstack/react-query';
import { ChartLine } from 'lucide-react';
import { useNavigate } from 'react-router';
import { StackedAreaChart } from '@/components/charts';
import { EmptyState, Spinner } from '@/components/common';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTRPC } from '@/lib/trpc';
import { fmt, GROUP_FILL, pct } from './common';

export function HistoryTab() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const history = useQuery(trpc.captable.history.queryOptions({}));
  if (history.isLoading) return <Spinner />;
  const h = history.data;
  if (!h?.points.length)
    return (
      <EmptyState icon={<ChartLine />} title="No History Yet">
        Ownership over time appears once the share register has transactions.
      </EmptyState>
    );
  const series = h.series.map((s) => ({ key: s.key, name: s.name, color: GROUP_FILL[s.color] ?? GROUP_FILL.slate! }));
  const markers = h.points.flatMap((p, i) => (p.roundTxId ? [i] : []));
  return (
    <div className="grid gap-5">
      <p className="text-muted-foreground">
        Fully diluted ownership per stakeholder group after every transaction, grant, exercise and pool change. Dashed lines are priced
        rounds; click one to open its transaction.
      </p>
      <StackedAreaChart
        series={series}
        markers={markers}
        onMarker={(i) => h.points[i]?.roundTxId && navigate(`/registry/transactions/${h.points[i]!.roundTxId}`)}
        points={h.points.map((p) => ({
          label: p.date,
          values: Object.fromEntries(series.map((s) => [s.key, Number(p.byGroup[s.key] ?? 0)])),
        }))}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Fully Diluted</TableHead>
              {series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...h.points].reverse().map((p) => (
              <TableRow key={p.date}>
                <TableCell className="font-mono text-xs">{p.date}</TableCell>
                <TableCell className="text-right font-mono">{fmt(p.fullyDiluted)}</TableCell>
                {series.map((s) => (
                  <TableCell key={s.key} className="text-right font-mono">
                    {p.byGroup[s.key] ? pct(p.byGroup[s.key]!) : ''}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
