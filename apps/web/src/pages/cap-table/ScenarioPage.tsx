import { runScenarioInput, SCENARIO_STEP_LABELS, type ScenarioStepInput } from '@openinc/shared';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, Download, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton, Field, Spinner, validate } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan, useSession } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { captableExportUrl, fmt, money, pct, today, useCurrency } from './common';
import { fromInput, newStep, type StepContext, type StepDraft, StepEditor, toInput } from './ScenarioSteps';
import { SCENARIO_STATUS_LABELS } from './ScenariosTab';
import { WaterfallView } from './WaterfallView';

type Run = RouterOutputs['captable']['runScenario'];
type StepRun = Run['steps'][number];
type CapTable = Run['base'];

const ADDABLE: ScenarioStepInput['kind'][] = ['priced_round', 'pool_change', 'grant_batch', 'secondary', 'exercise', 'exit'];

function useDebounced<T>(value: T, ms = 500) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ScenarioPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const trpc = useTRPC();
  const can = useCan();
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const saved = useQuery(trpc.captable.getScenario.queryOptions(isNew ? skipToken : { id }));
  const plans = useQuery(trpc.captable.listPlans.queryOptions({}));
  const table = useQuery(trpc.captable.get.queryOptions({ view: 'fully_diluted' }));
  const unpriced = useQuery(trpc.captable.listUnpriced.queryOptions({}));
  const users = useQuery(trpc.users.list.queryOptions(can('users.read') ? {} : skipToken));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseDate, setBaseDate] = useState(today());
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<RouterOutputs['captable']['promoteScenario']['drafts'] | null>(null);

  useEffect(() => {
    const s = saved.data?.scenario;
    if (!s || loadedId === s.id) return;
    setName(s.name);
    setDescription(s.description);
    setBaseDate(s.baseDate);
    setSharedWith(s.sharedWith);
    setSteps((s.steps as StepDraft[]).map((step) => fromInput(step, saved.data!.currency)));
    setLoadedId(s.id);
  }, [saved.data, loadedId]);

  const scenario = saved.data?.scenario;
  const isAuthor = isNew || scenario?.createdBy === user?.id;
  const readOnly = !can('captable.model') || !isAuthor || (scenario?.status ?? 'draft') !== 'draft';

  const inputs = useMemo(() => steps.map((s) => toInput(s, currency)), [steps, currency]);
  const checked = validate(runScenarioInput, { baseDate, steps: inputs });
  const runInput = useDebounced(checked.data ? JSON.stringify(checked.data) : null);
  const preview = useQuery(
    trpc.captable.runScenario.queryOptions(runInput ? JSON.parse(runInput) : skipToken, { placeholderData: (prev) => prev, retry: false }),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.captable.pathKey() });
  const save = useMutation(
    trpc.captable.saveScenario.mutationOptions({
      onSuccess: async (s) => {
        toast.success('Scenario saved');
        await refresh();
        if (isNew) navigate(`/cap-table/scenarios/${s.id}`, { replace: true });
      },
    }),
  );
  const archive = useMutation(
    trpc.captable.archiveScenario.mutationOptions({
      onSuccess: async () => {
        toast.success('Scenario archived');
        await refresh();
        navigate('/cap-table/scenarios');
      },
    }),
  );
  const rebase = useMutation(
    trpc.captable.rebaseScenario.mutationOptions({
      onSuccess: async (s) => {
        setBaseDate(s.baseDate);
        toast.success('Scenario moved onto the current register');
        await refresh();
      },
    }),
  );
  const promote = useMutation(
    trpc.captable.promoteScenario.mutationOptions({
      onSuccess: async (r) => {
        setDrafts(r.drafts);
        toast.success('Register drafts created');
        await refresh();
      },
    }),
  );

  const [errors, setErrors] = useState<Record<string, string>>({});
  const onSave = () => {
    if (!name.trim()) return setErrors({ name: 'Enter a name' });
    if (checked.errors) return setErrors({ steps: Object.values(checked.errors)[0] ?? 'Check the steps' });
    setErrors({});
    save.mutate({ id: isNew ? undefined : id, name, description, baseDate, steps: inputs as ScenarioStepInput[], sharedWith });
  };

  if (!isNew && saved.isLoading) return <Spinner />;

  const hasExit = steps.some((s) => s.kind === 'exit');
  const ctx: StepContext = {
    currency,
    baseDate,
    readOnly,
    plans: (plans.data?.plans ?? []).map((p) => ({ id: p.id, name: p.name })),
    classes: (table.data?.classes ?? []).map((c) => ({ code: c.code, name: c.name })),
    unpriced: (unpriced.data?.instruments ?? [])
      .filter((u) => u.status === 'outstanding')
      .map((u) => ({ id: u.id, label: `${u.stakeholderName}: ${u.profileLabel}, ${money(u.amount, currency)}` })),
  };
  const addStep = (kind: ScenarioStepInput['kind']) =>
    setSteps((list) => {
      const step = newStep(kind, baseDate);
      const exitAt = list.findIndex((s) => s.kind === 'exit');
      return exitAt === -1 || kind === 'exit' ? [...list, step] : [...list.slice(0, exitAt), step, ...list.slice(exitAt)];
    });
  const move = (i: number, delta: -1 | 1) =>
    setSteps((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length || list[j]!.kind === 'exit') return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const result = preview.data;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/cap-table/scenarios"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Scenarios
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {isNew ? 'New Scenario' : name || 'Scenario'}
            {scenario && (
              <Badge variant={scenario.status === 'promoted' ? 'default' : 'outline'}>{SCENARIO_STATUS_LABELS[scenario.status]}</Badge>
            )}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isNew && (
            <Button variant="outline" asChild>
              <a href={captableExportUrl('scenario', { scenarioId: id, format: 'xlsx' })}>
                <Download /> Export to Excel
              </a>
            </Button>
          )}
          {!isNew && isAuthor && scenario?.status === 'draft' && (
            <ConfirmButton
              label="Archive"
              title="Archive This Scenario?"
              description="It disappears from the list. Nothing on the cap table or in the register changes."
              onConfirm={() => archive.mutate({ id })}
            />
          )}
          {!readOnly && (
            <Button onClick={onSave} disabled={save.isPending}>
              Save
            </Button>
          )}
          {!isNew && can('captable.manage') && scenario?.status === 'draft' && (
            <PromoteButton disabled={scenario.stale || promote.isPending} onConfirm={() => promote.mutate({ scenarioId: id })} />
          )}
        </div>
      </div>

      {scenario?.stale && scenario.status === 'draft' && (
        <Alert>
          <AlertTitle>The Register Changed</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            The share register changed since this scenario was based on it. Move it onto today's register and check the numbers before
            promoting it.
            {isAuthor && (
              <Button size="sm" variant="outline" onClick={() => rebase.mutate({ scenarioId: id })} disabled={rebase.isPending}>
                Rebase on Today
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {drafts && (
        <Alert>
          <AlertTitle>Drafts in the Share Register</AlertTitle>
          <AlertDescription>
            <p>Nothing is entered yet. Open each draft and commit it in the register wizard, in this order.</p>
            <ul className="mt-2 grid gap-1">
              {drafts.map((d) => (
                <li key={d.id}>
                  <Link to={d.url} className="hover:underline">
                    {d.summary}
                  </Link>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card className="shadow-none">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
          <Field label="Name" htmlFor="sc-name" error={errors.name}>
            <Input id="sc-name" value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Base Date" htmlFor="sc-base" hint="The real cap table the scenario starts from">
            <Input
              id="sc-base"
              type="date"
              value={baseDate}
              disabled={readOnly}
              onChange={(e) => e.target.value && setBaseDate(e.target.value)}
            />
          </Field>
          <Field label="Description" htmlFor="sc-desc" className="sm:col-span-2">
            <Textarea id="sc-desc" value={description} disabled={readOnly} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          {users.data && (
            <div className="grid gap-2 sm:col-span-2">
              <Label>Shared With</Label>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {users.data.items
                  .filter((u) => u.id !== (scenario?.createdBy ?? user?.id))
                  .map((u) => (
                    <Label key={u.id} className="flex items-center gap-2 font-normal">
                      <Checkbox
                        checked={sharedWith.includes(u.id)}
                        disabled={readOnly}
                        onCheckedChange={(on) => setSharedWith((list) => (on ? [...list, u.id] : list.filter((x) => x !== u.id)))}
                      />
                      {u.name || u.email}
                    </Label>
                  ))}
              </div>
              <p className="text-xs text-muted-foreground">They can view the scenario. Only you can change it.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {result && <TableCard title="Starting Cap Table" table={result.base} base={result.base} />}

      {steps.map((step, i) => {
        const run = result?.steps[i];
        return (
          <StepEditor
            key={i}
            step={step}
            index={i}
            count={steps.length}
            ctx={ctx}
            onChange={(s) => setSteps((list) => list.map((x, j) => (j === i ? s : x)))}
            onMove={(d) => move(i, d)}
            onRemove={() => setSteps((list) => list.filter((_, j) => j !== i))}
          >
            {run && run.kind === step.kind && <StepResult run={run} base={result!.base} currency={currency} />}
          </StepEditor>
        );
      })}

      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="justify-self-start">
              <Plus /> Add Step <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {ADDABLE.map((kind) => (
              <DropdownMenuItem key={kind} disabled={kind === 'exit' && hasExit} onSelect={() => addStep(kind)}>
                {SCENARIO_STEP_LABELS[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {errors.steps && <p className="text-sm text-destructive">{errors.steps}</p>}
      {preview.error && <p className="text-sm text-destructive">{preview.error.message}</p>}
      {preview.isFetching && <Spinner />}
      {result && result.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {result.warnings.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromoteButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Promote to Register
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to the Share Register?</DialogTitle>
            <DialogDescription>
              Each round becomes share register drafts (a new class, a new issue for cash and one by set-off for converting instruments),
              and pool changes and grants are recorded on the cap table. Nothing is entered in the register until a person commits each
              draft.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Create Drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

const BASIS_LABELS = { cap: 'At the Cap', discount: 'At the Discount', round: 'At the Round Price' } as const;

function StepResult({ run, base, currency }: { run: StepRun; base: CapTable; currency: string }) {
  const r = run.result;
  return (
    <div className="grid gap-4 border-t pt-4">
      {r.kind === 'priced_round' && (
        <>
          <div className="grid gap-3 text-sm sm:grid-cols-4">
            <Fact label="Price per Share" value={`${r.round.pricePerShare} ${currency}`} />
            <Fact label="Pre-Money" value={money(r.round.preMoney, currency)} />
            <Fact label="Raised" value={money(r.round.raised, currency)} />
            <Fact label="Post-Money" value={money(r.round.postMoney, currency)} />
          </div>
          <SmallTable
            headers={['Investor', 'Amount', 'New Units']}
            rows={r.round.investments.map((i) => [i.name, money(i.amount, currency), fmt(i.units)])}
          />
          {r.round.conversions.length > 0 && (
            <SmallTable
              headers={['Converting Instrument', 'Amount', 'Price', 'Basis', 'Units']}
              rows={r.round.conversions.map((c) => [
                base.rows.find((x) => x.stakeholderId === c.stakeholderId)?.name ??
                  run.table.rows.find((x) => x.stakeholderId === c.stakeholderId)?.name ??
                  '',
                money(c.amount, currency),
                c.pricePerShare,
                `${BASIS_LABELS[c.basis]}${c.mfnFrom ? ' (MFN)' : ''}`,
                fmt(c.units),
              ])}
            />
          )}
          {r.round.pool && (
            <p className="text-sm text-muted-foreground">
              The pool grows by <span className="font-mono">{fmt(r.round.pool.topUp)}</span> units to{' '}
              <span className="font-mono">{fmt(r.round.pool.unallocatedAfter)}</span> unallocated,{' '}
              <span className="font-mono">{pct(r.round.pool.pctAfter)}</span> of the fully diluted total. Existing holders carry the top-up.
            </p>
          )}
          {r.round.proRata.length > 0 && (
            <SmallTable
              headers={['Pro Rata Holder', 'Before', 'After', 'Units to Keep', 'Amount to Keep']}
              rows={r.round.proRata.map((p) => [
                p.name,
                pct(p.pctBefore),
                pct(p.pctAfter),
                fmt(p.unitsToKeep),
                money(p.amountToKeep, currency),
              ])}
            />
          )}
        </>
      )}
      {r.kind === 'pool_change' && (
        <p className="text-sm text-muted-foreground">
          The pool is now <span className="font-mono">{fmt(r.size)}</span> units, <span className="font-mono">{fmt(r.unallocated)}</span>{' '}
          unallocated.
        </p>
      )}
      {r.kind === 'grant_batch' && (
        <p className="text-sm text-muted-foreground">
          Granted <span className="font-mono">{fmt(r.granted)}</span> units; <span className="font-mono">{fmt(r.unallocated)}</span> remain
          unallocated.
        </p>
      )}
      {r.kind === 'secondary' && (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{fmt(r.units)}</span> units change hands for{' '}
          <span className="font-mono">{money(r.amount, currency)}</span>.
        </p>
      )}
      {r.kind === 'exercise' && (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono">{fmt(r.units)}</span> units exercised across {r.grants} grants.
        </p>
      )}
      {r.kind === 'exit' ? <WaterfallView waterfall={r.waterfall} currency={currency} /> : <CapTableAfter table={run.table} base={base} />}
    </div>
  );
}

function SmallTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h, i) => (
              <TableHead key={h} className={i ? 'text-right' : undefined}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {row.map((cell, j) => (
                <TableCell key={j} className={j ? 'text-right font-mono' : undefined}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const rowKey = (r: CapTable['rows'][number]) => r.stakeholderId ?? r.planId ?? r.name;

function CapTableAfter({ table, base }: { table: CapTable; base: CapTable }) {
  const before = new Map(base.rows.map((r) => [rowKey(r), Number(r.fullyDilutedPct)]));
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stakeholder</TableHead>
            <TableHead className="text-right">Issued</TableHead>
            <TableHead className="text-right">Fully Diluted</TableHead>
            <TableHead className="text-right">Fully Diluted %</TableHead>
            <TableHead className="text-right">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((r) => {
            const change = Number(r.fullyDilutedPct) - (before.get(rowKey(r)) ?? 0);
            return (
              <TableRow key={rowKey(r)}>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-right font-mono">{fmt(r.issued)}</TableCell>
                <TableCell className="text-right font-mono">{fmt(r.fullyDiluted)}</TableCell>
                <TableCell className="text-right font-mono">{pct(r.fullyDilutedPct)}</TableCell>
                <TableCell
                  className={`text-right font-mono ${change < 0 ? 'text-destructive' : change > 0 ? 'text-success' : 'text-muted-foreground'}`}
                >
                  {Math.abs(change) < 0.005 ? '–' : `${change > 0 ? '+' : ''}${change.toFixed(2)} pp`}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow>
            <TableCell className="font-medium">Total</TableCell>
            <TableCell className="text-right font-mono">{fmt(table.totals.issued)}</TableCell>
            <TableCell className="text-right font-mono">{fmt(table.totals.fullyDiluted)}</TableCell>
            <TableCell className="text-right font-mono">100.00%</TableCell>
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function TableCard({ title, table, base }: { title: string; table: CapTable; base: CapTable }) {
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CapTableAfter table={table} base={base} />
      </CardContent>
    </Card>
  );
}
