import { formatMoney } from '@openinc/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RouterOutputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { fmt, fmtRanges } from '../common';

type Validation = RouterOutputs['registry']['validate'];
type View = NonNullable<Validation['before']>;

function holdingText(h: View['holders'][number] | undefined) {
  if (!h) return '';
  return h.positions.map((p) => `${fmt(p.count)} ${p.classCode}${p.interim ? ' (interim)' : ''}`).join(', ');
}

function numbersText(h: View['holders'][number] | undefined) {
  return h
    ? h.positions
        .map((p) => fmtRanges(p.ranges))
        .filter(Boolean)
        .join('; ')
    : '';
}

/** Before and after the transaction on its effective date, with the rows it changes highlighted. */
export function Preview({ result }: { result: Validation }) {
  const changed = new Set(result.changedHolderIds);
  const before = result.before;
  const after = result.after;
  const ids = [...new Set([...(before?.holders ?? []).map((h) => h.holderId), ...(after?.holders ?? []).map((h) => h.holderId)])];
  const name = (id: string) =>
    after?.holders.find((h) => h.holderId === id)?.name ?? before?.holders.find((h) => h.holderId === id)?.name ?? id;
  ids.sort((a, b) => Number(changed.has(b)) - Number(changed.has(a)) || name(a).localeCompare(name(b)));
  const money = (v: bigint) => formatMoney(v, result.currency);

  return (
    <div className="grid gap-4">
      {result.ok ? (
        <Alert>
          <AlertTitle>Ready to Enter</AlertTitle>
          <AlertDescription>Every rule passes, including for every later transaction.</AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <AlertTitle>
            {result.conflict
              ? `Conflicts With Transaction #${result.conflict.seq} on ${result.conflict.effectiveDate}`
              : 'Cannot Be Entered'}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.message} <span className="font-mono text-xs opacity-70">{e.rule}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {result.warnings.length > 0 && (
        <ul className="grid gap-1 text-sm text-muted-foreground">
          {result.warnings.map((w, i) => (
            <li key={i}>
              ⚠ {w.message} <span className="font-mono text-xs">{w.rule}</span>
            </li>
          ))}
        </ul>
      )}
      {after && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs text-muted-foreground">Share Capital</div>
            <div className="font-mono">
              {before ? `${money(before.shareCapital)} → ` : ''}
              {money(after.shareCapital)}
            </div>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs text-muted-foreground">Shares</div>
            <div className="font-mono">
              {before ? `${fmt(before.totalShares)} → ` : ''}
              {fmt(after.totalShares)}
            </div>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="text-xs text-muted-foreground">Quota Value</div>
            <div className="font-mono">
              {before ? `${fmt(before.quotaValue)} → ` : ''}
              {fmt(after.quotaValue)}
            </div>
          </div>
        </div>
      )}
      {(before || after) && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Before</TableHead>
                <TableHead>After</TableHead>
                <TableHead className="text-right">Capital % After</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ids.map((id) => {
                const b = before?.holders.find((h) => h.holderId === id);
                const a = after?.holders.find((h) => h.holderId === id);
                return (
                  <TableRow
                    key={id}
                    data-changed={changed.has(id) || undefined}
                    className={cn(changed.has(id) && 'bg-primary/5 font-medium')}
                  >
                    <TableCell>{name(id)}</TableCell>
                    <TableCell>
                      <div className="font-mono">{holdingText(b)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{numbersText(b)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono">{holdingText(a)}</div>
                      <div className="font-mono text-xs text-muted-foreground">{numbersText(a)}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{a?.capitalPct ?? '0'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
