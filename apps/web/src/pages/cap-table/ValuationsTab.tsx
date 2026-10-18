import { VALUATION_SOURCE_LABELS, VALUATION_SOURCES, valuationInput } from '@openinc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LineChart as LineChartIcon, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton, EmptyState, Field, Spinner, validate } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { today } from './common';
import { useCaptableInvalidate } from './PlansTab';

export function ValuationsTab() {
  const trpc = useTRPC();
  const can = useCan();
  const manage = can('captable.manage');
  const invalidate = useCaptableInvalidate();
  const list = useQuery(trpc.captable.listValuations.queryOptions());
  const [open, setOpen] = useState(false);
  const remove = useMutation(
    trpc.captable.deleteValuation.mutationOptions({
      onSuccess: () => {
        toast.success('Valuation deleted');
        void invalidate();
      },
    }),
  );
  const data = list.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-muted-foreground">
          The price per share over time. The later of the last priced round and the last valuation values holdings.
        </p>
        {manage && (
          <Button onClick={() => setOpen(true)}>
            <Plus /> Record Valuation
          </Button>
        )}
      </div>
      {list.isLoading || !data ? (
        <Spinner />
      ) : !data.items.length ? (
        <EmptyState icon={<LineChartIcon />} title="No Valuations">
          Priced rounds in the share register show up here, together with valuations you record.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Price per Share</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Notes</TableHead>
                {manage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((v) => (
                <TableRow key={`${v.source}-${v.id}`}>
                  <TableCell className="font-mono text-xs">{v.date}</TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(v.pricePerShare)} {data.currency}
                  </TableCell>
                  <TableCell>
                    {v.registryTxId ? (
                      <Link to={`/registry/transactions/${v.registryTxId}`} className="hover:underline">
                        {VALUATION_SOURCE_LABELS[v.source]}
                      </Link>
                    ) : (
                      VALUATION_SOURCE_LABELS[v.source]
                    )}
                  </TableCell>
                  <TableCell>{v.method}</TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">{v.notes}</TableCell>
                  {manage && (
                    <TableCell className="text-right">
                      {v.source !== 'round' && (
                        <ConfirmButton
                          label="Delete"
                          title="Delete This Valuation?"
                          description="It is removed from the valuation log. The audit log keeps a record."
                          onConfirm={() => remove.mutate({ id: v.id })}
                        />
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {can('captable.model') && <FairValueHelper manage={manage} currency={data?.currency ?? ''} />}
      {open && <ValuationDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function ValuationDialog({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({ date: today(), pricePerShare: '', source: 'internal', method: '', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation(
    trpc.captable.saveValuation.mutationOptions({
      onSuccess: () => {
        toast.success('Valuation recorded');
        void invalidate();
        onClose();
      },
    }),
  );
  const submit = () => {
    const result = validate(valuationInput, form);
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Valuation</DialogTitle>
          <DialogDescription>The log records valuations; it does not produce formal ones.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date" htmlFor="valuation-date" error={errors.date}>
            <Input id="valuation-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="Price per Share" htmlFor="valuation-price" error={errors.pricePerShare}>
            <Input
              id="valuation-price"
              className="font-mono"
              value={form.pricePerShare}
              onChange={(e) => setForm({ ...form, pricePerShare: e.target.value })}
            />
          </Field>
          <Field label="Source" htmlFor="valuation-source">
            <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
              <SelectTrigger id="valuation-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VALUATION_SOURCES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {VALUATION_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Method" htmlFor="valuation-method" error={errors.method}>
            <Input id="valuation-method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} />
          </Field>
          <Field label="Notes" htmlFor="valuation-notes" className="sm:col-span-2">
            <Textarea id="valuation-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Record Valuation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FairValueHelper({ manage, currency }: { manage: boolean; currency: string }) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({
    sharePrice: '',
    strikePrice: '',
    years: '3',
    volatilityPct: '40',
    riskFreePct: '2',
    dividendPct: '0',
  });
  const [result, setResult] = useState<{ value: string; intrinsic: string } | null>(null);
  const calc = useMutation(trpc.captable.fairValue.mutationOptions({ onSuccess: (r) => setResult(r) }));
  const saveIt = useMutation(
    trpc.captable.fairValue.mutationOptions({
      onSuccess: () => {
        toast.success('Saved to the valuation log');
        void invalidate();
      },
    }),
  );
  const valid = /^\d+(\.\d+)?$/.test(form.sharePrice) && /^\d+(\.\d+)?$/.test(form.strikePrice) && Number(form.years) > 0;
  const field = (key: keyof typeof form, label: string) => (
    <Field label={label} htmlFor={`fv-${key}`}>
      <Input
        id={`fv-${key}`}
        className="font-mono"
        value={form[key]}
        onChange={(e) => {
          setForm({ ...form, [key]: e.target.value });
          setResult(null);
        }}
      />
    </Field>
  );
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>Fair Value Helper</CardTitle>
        <CardDescription>
          A Black-Scholes estimate of one option or warrant, for instruments that must be sold at market value (Swedish and Danish warrants,
          French BSA, EMI). It is an estimate, not a formal valuation.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {field('sharePrice', 'Share Price')}
          {field('strikePrice', 'Strike Price')}
          {field('years', 'Years to Expiry')}
          {field('volatilityPct', 'Volatility (%)')}
          {field('riskFreePct', 'Risk-Free Rate (%)')}
          {field('dividendPct', 'Dividend Yield (%)')}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={!valid || calc.isPending} onClick={() => calc.mutate(form)}>
            Calculate
          </Button>
          {result && (
            <>
              <span>
                Value per unit <span className="font-mono font-medium">{Number(result.value).toFixed(4)}</span> {currency} · intrinsic{' '}
                <span className="font-mono">{Number(result.intrinsic).toFixed(4)}</span>
              </span>
              {manage && (
                <Button variant="ghost" disabled={saveIt.isPending} onClick={() => saveIt.mutate({ ...form, saveOn: today() })}>
                  Save to Valuation Log
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
