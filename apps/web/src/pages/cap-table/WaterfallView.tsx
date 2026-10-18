import { currencyDigits } from '@openinc/shared';
import { LineChart } from '@/components/charts';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RouterOutputs } from '@/lib/trpc';
import { fmt, GROUP_FILL, money, pct } from './common';

type WaterfallData = RouterOutputs['captable']['waterfall'];

const PALETTE = Object.values(GROUP_FILL);
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export function WaterfallView({
  waterfall: w,
  chart,
  currency,
}: {
  waterfall: WaterfallData['waterfall'];
  chart?: WaterfallData['chart'];
  currency: string;
}) {
  const scale = 10 ** currencyDigits(currency);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 text-sm sm:grid-cols-4">
        {[
          ['Exit Value', money(w.exitValue, currency)],
          ['Transaction Costs', money(w.transactionCosts, currency)],
          ['Debt', money(w.debt, currency)],
          ['Distributable', money(w.distributable, currency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-mono">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Each common unit receives <span className="font-mono">{w.commonPrice}</span> {currency}. Options and virtual shares are paid net of
        strike
        {w.awards.cancelled !== '0' && <>; {fmt(w.awards.cancelled)} unvested units are cancelled</>}.
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              <TableHead className="text-right">Preference</TableHead>
              <TableHead className="text-right">Participation</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.classes.map((c) => (
              <TableRow key={c.code}>
                <TableCell className="font-mono">{c.code}</TableCell>
                <TableCell className="text-right font-mono">{money(c.preference, currency)}</TableCell>
                <TableCell className="text-right font-mono">{money(c.participation, currency)}</TableCell>
                <TableCell>{c.converts && <Badge variant="secondary">Converts to Common</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stakeholder</TableHead>
              <TableHead className="text-right">Preference</TableHead>
              <TableHead className="text-right">Participation</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Multiple</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.rows.map((r) => (
              <TableRow key={r.stakeholderId}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right font-mono">{money(r.preference, currency)}</TableCell>
                <TableCell className="text-right font-mono">{money(r.participation, currency)}</TableCell>
                <TableCell className="text-right font-mono font-medium">{money(r.total, currency)}</TableCell>
                <TableCell className="text-right font-mono">{pct(r.pct)}</TableCell>
                <TableCell className="text-right font-mono">
                  {r.invested !== '0' ? `${(Number(r.total) / Number(r.invested)).toFixed(2)}x` : '–'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {chart && chart.points.length > 1 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Payout Across Exit Values</h3>
          <LineChart
            series={chart.series.map((s, i) => ({ key: s.key, name: s.name, color: PALETTE[i % PALETTE.length]! }))}
            points={chart.points.map((p) => ({
              x: Number(p.exitValue) / scale,
              values: Object.fromEntries(Object.entries(p.values).map(([k, v]) => [k, Number(v) / scale])),
            }))}
            formatX={(v) => compact.format(v)}
            formatY={(v) => compact.format(v)}
          />
          <Breakpoints chart={chart} currency={currency} />
        </div>
      )}
    </div>
  );
}

function Breakpoints({ chart, currency }: { chart: NonNullable<WaterfallData['chart']>; currency: string }) {
  const changes = chart.points.flatMap((p, i) => {
    if (i === 0) return [];
    const before = new Set(chart.points[i - 1]!.converting);
    return p.converting.filter((c) => !before.has(c)).map((code) => ({ code, exitValue: p.exitValue }));
  });
  if (!changes.length) return null;
  return (
    <ul className="grid gap-1 text-xs text-muted-foreground">
      {changes.map((c) => (
        <li key={c.code}>
          Class <span className="font-mono">{c.code}</span> converts to common from about{' '}
          <span className="font-mono">{money(c.exitValue, currency)}</span>.
        </li>
      ))}
    </ul>
  );
}
