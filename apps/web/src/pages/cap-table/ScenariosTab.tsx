import { SCENARIO_STEP_LABELS, type ScenarioStep } from '@openinc/shared';
import { skipToken, useQuery } from '@tanstack/react-query';
import { GitCompare, Plus, Shuffle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EmptyState, Field, Spinner } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTRPC } from '@/lib/trpc';
import { pct, toMinor, useCurrency } from './common';
import { WaterfallView } from './WaterfallView';

export const SCENARIO_STATUS_LABELS = { draft: 'Draft', promoted: 'Promoted', archived: 'Archived' } as const;

export function ScenariosTab() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const list = useQuery(trpc.captable.listScenarios.queryOptions({}));
  const [comparing, setComparing] = useState(false);
  const items = list.data?.items ?? [];
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => setComparing(true)} disabled={items.length < 2}>
          <GitCompare /> Compare
        </Button>
        <Button onClick={() => navigate('/cap-table/scenarios/new')}>
          <Plus /> New Scenario
        </Button>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : !items.length ? (
        <EmptyState icon={<Shuffle />} title="No Scenarios">
          Model a round, a pool top-up or an exit on a copy of the cap table. Nothing changes until you promote it.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Base Date</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link to={`/cap-table/scenarios/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.baseDate}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {(s.steps as ScenarioStep[]).map((step) => SCENARIO_STEP_LABELS[step.kind]).join(' → ') || 'No steps'}
                  </TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    <Badge variant={s.status === 'promoted' ? 'default' : 'outline'}>{SCENARIO_STATUS_LABELS[s.status]}</Badge>
                    {s.stale && s.status === 'draft' && <Badge variant="secondary">Register Changed</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <QuickWaterfall />
      <CompareDialog open={comparing} onOpenChange={setComparing} scenarios={items} />
    </div>
  );
}

function CompareDialog({
  open,
  onOpenChange,
  scenarios,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scenarios: { id: string; name: string }[];
}) {
  const trpc = useTRPC();
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const compare = useQuery(
    trpc.captable.compareScenarios.queryOptions({ leftId, rightId }, { enabled: !!leftId && !!rightId && leftId !== rightId }),
  );
  const picker = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue placeholder="Pick a scenario" />
        </SelectTrigger>
        <SelectContent>
          {scenarios.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compare Scenarios</DialogTitle>
          <DialogDescription>Fully diluted ownership at the end of each scenario.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {picker(leftId, setLeftId, 'Left')}
          {picker(rightId, setRightId, 'Right')}
        </div>
        {compare.isFetching && <Spinner />}
        {compare.data && (
          <div className="max-h-96 overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stakeholder</TableHead>
                  <TableHead className="text-right">{compare.data.left.name}</TableHead>
                  <TableHead className="text-right">{compare.data.right.name}</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {compare.data.rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right font-mono">{pct(r.left)}</TableCell>
                    <TableCell className="text-right font-mono">{pct(r.right)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(r.difference) > 0 ? '+' : ''}
                      {Number(r.difference).toFixed(2)} pp
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function QuickWaterfall() {
  const trpc = useTRPC();
  const currency = useCurrency();
  const [form, setForm] = useState({ exitValue: '', transactionCosts: '0', debt: '0', unvested: 'cancel' as 'cancel' | 'accelerate' });
  const [input, setInput] = useState<{
    exitValue: string;
    transactionCosts: string;
    debt: string;
    unvested: 'cancel' | 'accelerate';
    chartMax: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const result = useQuery(trpc.captable.waterfall.queryOptions(input ?? skipToken));
  const run = () => {
    const exitValue = toMinor(form.exitValue, currency);
    const transactionCosts = toMinor(form.transactionCosts || '0', currency);
    const debt = toMinor(form.debt || '0', currency);
    if (!exitValue || !transactionCosts || !debt) return setError('Enter amounts as numbers');
    setError(null);
    setInput({ exitValue, transactionCosts, debt, unvested: form.unvested, chartMax: (BigInt(exitValue) * 3n).toString() });
  };
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Quick Exit Waterfall</CardTitle>
        <CardDescription>What everyone receives if the company is sold today, on the real cap table.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid items-end gap-3 sm:grid-cols-5">
          <Field label={`Exit Value (${currency})`} htmlFor="qw-exit" error={error ?? undefined}>
            <Input
              id="qw-exit"
              className="font-mono"
              value={form.exitValue}
              onChange={(e) => setForm({ ...form, exitValue: e.target.value })}
            />
          </Field>
          <Field label="Transaction Costs" htmlFor="qw-costs">
            <Input
              id="qw-costs"
              className="font-mono"
              value={form.transactionCosts}
              onChange={(e) => setForm({ ...form, transactionCosts: e.target.value })}
            />
          </Field>
          <Field label="Debt" htmlFor="qw-debt">
            <Input id="qw-debt" className="font-mono" value={form.debt} onChange={(e) => setForm({ ...form, debt: e.target.value })} />
          </Field>
          <Field label="Unvested Awards" htmlFor="qw-unvested">
            <Select value={form.unvested} onValueChange={(v) => setForm({ ...form, unvested: v as 'cancel' | 'accelerate' })}>
              <SelectTrigger id="qw-unvested" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cancel">Cancel</SelectItem>
                <SelectItem value="accelerate">Accelerate</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Button onClick={run} disabled={!form.exitValue}>
            Run Waterfall
          </Button>
        </div>
        {result.isFetching && <Spinner />}
        {result.data && <WaterfallView waterfall={result.data.waterfall} chart={result.data.chart} currency={result.data.currency} />}
      </CardContent>
    </Card>
  );
}
