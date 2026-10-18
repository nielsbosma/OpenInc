import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, Download, FlaskConical } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ShareBar } from '@/components/charts';
import { EmptyState, Field, Spinner } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { type CapTableData, captableExportUrl, fmt, GROUP_FILL, money, pct, today } from './common';

type View = 'fully_diluted' | 'issued';
type RollUp = 'stakeholder' | 'group';

function groupRows(data: CapTableData) {
  const groups = new Map(data.groups.map((g) => [g.id, g]));
  const sums = new Map<string, { key: string; name: string; color: string; fd: number; issued: number; pct: number }>();
  for (const r of data.rows) {
    const g = r.groupId ? groups.get(r.groupId) : null;
    const key = r.planId ? 'pool' : (g?.id ?? 'ungrouped');
    const name = r.planId ? 'Unallocated Pool' : (g?.name ?? 'Ungrouped');
    const color = GROUP_FILL[r.planId ? 'teal' : (g?.color ?? 'slate')]!;
    const s = sums.get(key) ?? { key, name, color, fd: 0, issued: 0, pct: 0 };
    s.fd += Number(r.fullyDiluted);
    s.issued += Number(r.issued);
    s.pct += Number(r.fullyDilutedPct);
    sums.set(key, s);
  }
  return [...sums.values()].sort((a, b) => b.fd - a.fd);
}

export function OverviewTab() {
  const trpc = useTRPC();
  const can = useCan();
  const [asOf, setAsOf] = useState(today());
  const [view, setView] = useState<View>('fully_diluted');
  const [rollUp, setRollUp] = useState<RollUp>('stakeholder');
  const table = useQuery(trpc.captable.get.queryOptions({ asOf, view }, { placeholderData: (prev) => prev }));
  const groups = useMemo(() => (table.data ? groupRows(table.data) : []), [table.data]);

  if (table.isLoading) return <Spinner />;
  const t = table.data;
  if (!t) return null;
  if (!t.registerSetUp)
    return (
      <EmptyState icon={<BarChart3 />} title="Set Up the Share Register First">
        The cap table is built from the share register.{' '}
        <Link to="/registry" className="underline">
          Open Share Register
        </Link>{' '}
        to start it.
      </EmptyState>
    );

  const price = t.price;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="As of Date" htmlFor="cap-as-of" className="w-44">
            <Input id="cap-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </Field>
          <Field label="Count" htmlFor="cap-view" className="w-44">
            <Select value={view} onValueChange={(v) => setView(v as View)}>
              <SelectTrigger id="cap-view" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fully_diluted">Fully Diluted</SelectItem>
                <SelectItem value="issued">Issued Shares</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Rows" htmlFor="cap-rollup" className="w-44">
            <Select value={rollUp} onValueChange={(v) => setRollUp(v as RollUp)}>
              <SelectTrigger id="cap-rollup" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stakeholder">By Stakeholder</SelectItem>
                <SelectItem value="group">By Group</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex gap-2">
          {can('captable.model') && (
            <Button variant="outline" asChild>
              <Link to="/cap-table/scenarios/new">
                <FlaskConical /> Start a Scenario
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download /> Export <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(
                [
                  ['pdf', 'PDF'],
                  ['xlsx', 'Excel (XLSX)'],
                  ['csv', 'CSV'],
                  ['json', 'JSON'],
                ] as const
              ).map(([format, label]) => (
                <DropdownMenuItem key={format} asChild>
                  <a href={captableExportUrl('table', { asOf, view, format })} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>{view === 'issued' ? 'Issued Shares' : 'Fully Diluted Shares'}</CardDescription>
            <CardTitle className="font-mono text-2xl">{fmt(t.totals.fullyDiluted)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>Options and Warrants</CardDescription>
            <CardTitle className="font-mono text-2xl">{fmt(t.totals.awards)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>Price per Share</CardDescription>
            <CardTitle className="font-mono text-2xl">{price ? `${price.pricePerShare} ${t.currency}` : '–'}</CardTitle>
            {price && (
              <p className="text-xs text-muted-foreground">
                From {price.source === 'round' ? 'the last priced round' : 'a valuation'} on {price.date}
              </p>
            )}
          </CardHeader>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardDescription>Implied Valuation</CardDescription>
            <CardTitle className="font-mono text-2xl">{money(t.impliedValuation, t.currency)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {groups.length > 0 && <ShareBar parts={groups.map((g) => ({ key: g.key, name: g.name, value: g.fd, color: g.color }))} />}

      {rollUp === 'group' ? (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">{view === 'issued' ? 'Shares' : 'Fully Diluted'}</TableHead>
                <TableHead className="text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.key}>
                  <TableCell>
                    <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: g.color }} />
                    {g.name}
                  </TableCell>
                  <TableCell className="text-right font-mono">{fmt(g.issued)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(g.fd)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(g.pct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stakeholder</TableHead>
                {t.classes.map((c) => (
                  <TableHead key={c.code} className="text-right">
                    {c.code}
                  </TableHead>
                ))}
                {view === 'fully_diluted' && <TableHead className="text-right">Options and Warrants</TableHead>}
                {view === 'fully_diluted' && t.totals.virtual !== '0' && <TableHead className="text-right">Virtual</TableHead>}
                <TableHead className="text-right">{view === 'issued' ? 'Shares' : 'Fully Diluted'}</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Votes %</TableHead>
                {price && <TableHead className="text-right">Value</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {t.rows.map((r) => (
                <TableRow key={r.stakeholderId ?? r.planId}>
                  <TableCell>
                    {r.stakeholderId ? (
                      <Link to={`/cap-table/stakeholders/${r.stakeholderId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{r.name}</span>
                    )}
                    {r.stakeholderId && !r.inRegister && (
                      <Badge variant="outline" className="ml-2">
                        Not in Register
                      </Badge>
                    )}
                  </TableCell>
                  {t.classes.map((c) => (
                    <TableCell key={c.code} className="text-right font-mono">
                      {r.byClass[c.code] ? fmt(r.byClass[c.code]!) : ''}
                    </TableCell>
                  ))}
                  {view === 'fully_diluted' && (
                    <TableCell className="text-right font-mono">
                      {r.awards !== '0' && (
                        <>
                          {fmt(r.awards)}
                          <div className="text-xs text-muted-foreground">{fmt(r.vestedAwards)} vested</div>
                        </>
                      )}
                    </TableCell>
                  )}
                  {view === 'fully_diluted' && t.totals.virtual !== '0' && (
                    <TableCell className="text-right font-mono">{r.virtual !== '0' ? fmt(r.virtual) : ''}</TableCell>
                  )}
                  <TableCell className="text-right font-mono">{fmt(r.fullyDiluted)}</TableCell>
                  <TableCell className="text-right font-mono">{pct(r.fullyDilutedPct)}</TableCell>
                  <TableCell className="text-right font-mono">{r.planId ? '' : pct(r.votesPct)}</TableCell>
                  {price && <TableCell className="text-right font-mono">{r.value ? money(r.value, t.currency) : ''}</TableCell>}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {t.classes.map((c) => (
                  <TableCell key={c.code} className="text-right font-mono">
                    {fmt(c.issued)}
                  </TableCell>
                ))}
                {view === 'fully_diluted' && <TableCell className="text-right font-mono">{fmt(t.totals.awards)}</TableCell>}
                {view === 'fully_diluted' && t.totals.virtual !== '0' && (
                  <TableCell className="text-right font-mono">{fmt(t.totals.virtual)}</TableCell>
                )}
                <TableCell className="text-right font-mono">{fmt(t.totals.fullyDiluted)}</TableCell>
                <TableCell className="text-right font-mono">100%</TableCell>
                <TableCell className="text-right font-mono">100%</TableCell>
                {price && <TableCell />}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}

      {t.unpriced.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Unpriced Instruments</CardTitle>
            <CardDescription>
              SAFEs and convertible loans that have not converted yet. They are not in the count above;{' '}
              <Link to="/cap-table/convertibles" className="underline">
                Convertibles
              </Link>{' '}
              shows what each converts into.
            </CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <Table>
              <TableBody>
                {t.unpriced.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.name}</TableCell>
                    <TableCell className="text-right font-mono">{money(u.amount, t.currency)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {u.valuationCap ? `Cap ${money(u.valuationCap, t.currency)}` : 'No cap'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="grid gap-1 text-xs text-muted-foreground">
        <p>{t.definition}</p>
        <p>
          Check against the register:{' '}
          {t.reconciliation.map((r) => (
            <span key={r.classCode} className={r.ok ? 'mr-3 font-mono' : 'mr-3 font-mono text-destructive'}>
              {r.classCode} {fmt(r.capTable)} {r.ok ? '✓' : `≠ ${fmt(r.register)} in the register`}
            </span>
          ))}
        </p>
      </div>

      {t.warnings.length > 0 && (
        <Alert>
          <AlertTitle>Check These</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1">
              {t.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
