import { INTEREST, unpricedInput } from '@openinc/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Combobox } from '@/components/Combobox';
import { ConfirmButton, EmptyState, Field, Spinner, validate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/session';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';
import { fmt, fromMinor, money, StakeholderPicker, today, toMinor } from './common';
import { useCaptableInvalidate } from './PlansTab';

type UnpricedData = RouterOutputs['captable']['listUnpriced'];
type Instrument = UnpricedData['instruments'][number];

const STATUS_LABEL: Record<string, string> = { outstanding: 'Outstanding', converted: 'Converted', cancelled: 'Cancelled' };
const INTEREST_LABELS: Record<(typeof INTEREST)[number], string> = { simple: 'Simple', compound: 'Compound' };

export function ConvertiblesTab() {
  const trpc = useTRPC();
  const can = useCan();
  const manage = can('captable.manage');
  const invalidate = useCaptableInvalidate();
  const [asOf, setAsOf] = useState(today());
  const list = useQuery(trpc.captable.listUnpriced.queryOptions({ asOf }, { placeholderData: (prev) => prev }));
  const [editing, setEditing] = useState<Instrument | 'new' | null>(null);
  const cancel = useMutation(
    trpc.captable.cancelUnpriced.mutationOptions({
      onSuccess: () => {
        toast.success('Instrument cancelled');
        void invalidate();
      },
    }),
  );
  const data = list.data;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="As of Date" htmlFor="unpriced-as-of" className="w-44">
          <Input id="unpriced-as-of" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </Field>
        {manage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Add Instrument
          </Button>
        )}
      </div>
      <p className="text-muted-foreground">
        SAFEs and convertible loans stay here until they convert. They convert in a priced round: model it under{' '}
        <Link to="/cap-table/scenarios" className="text-primary hover:underline">
          Scenarios
        </Link>{' '}
        and promote it to draft the new issue by set-off.
        {data?.price && (
          <>
            {' '}
            The discount applies to the current price of {Number(data.price.pricePerShare)} {data.currency} ({data.price.date}).
          </>
        )}
      </p>
      {list.isLoading || !data ? (
        <Spinner />
      ) : !data.instruments.length ? (
        <EmptyState icon={<ScrollText />} title="No Convertibles">
          Add a SAFE, a convertible loan or a local profile such as a Wandeldarlehen or BSA AIR.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Holder</TableHead>
                <TableHead>Profile</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Interest</TableHead>
                <TableHead>Signed On</TableHead>
                <TableHead>Maturity</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead className="text-right">At Cap</TableHead>
                <TableHead className="text-right">At Discount</TableHead>
                <TableHead>Status</TableHead>
                {manage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.instruments.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Link to={`/cap-table/stakeholders/${u.stakeholderId}`} className="hover:underline">
                      {u.stakeholderName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {u.profileLabel}
                    {u.mfn && (
                      <Badge
                        variant="outline"
                        className="ml-2"
                        title={u.mfnFrom ? 'Took the terms of a later instrument' : 'Most favoured nation'}
                      >
                        MFN{u.mfnFrom ? ' Applied' : ''}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{money(u.amount, data.currency)}</TableCell>
                  <TableCell className="text-right font-mono">{money(u.valuationCap, data.currency)}</TableCell>
                  <TableCell className="text-right font-mono">{Number(u.discountPct)}%</TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(u.interestRatePct) ? `${Number(u.interestRatePct)}% ${u.interest}` : '–'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{u.signedOn}</TableCell>
                  <TableCell className="font-mono text-xs">{u.maturityDate ?? '–'}</TableCell>
                  <TableCell className="text-right font-mono">{money(u.accrued, data.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {u.atCap ? (
                      <>
                        {fmt(u.atCap.units)} at {Number(u.atCap.pricePerShare)}
                      </>
                    ) : (
                      '–'
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {u.atDiscount ? (
                      <>
                        {fmt(u.atDiscount.units)} at {Number(u.atDiscount.pricePerShare)}
                      </>
                    ) : (
                      '–'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.status === 'outstanding' ? 'default' : 'secondary'}>{STATUS_LABEL[u.status]}</Badge>
                  </TableCell>
                  {manage && (
                    <TableCell className="text-right whitespace-nowrap">
                      {u.status === 'outstanding' && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                            Edit
                          </Button>
                          <ConfirmButton
                            label="Cancel"
                            title="Cancel This Instrument?"
                            description="It no longer counts or converts from today. Use this when it was repaid or annulled."
                            confirmLabel="Cancel Instrument"
                            onConfirm={() => cancel.mutate({ id: u.id, date: today() })}
                          />
                        </>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data && editing && (
        <InstrumentDialog
          instrument={editing === 'new' ? null : editing}
          profiles={data.profiles}
          currency={data.currency}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function InstrumentDialog({
  instrument,
  profiles,
  currency,
  onClose,
}: {
  instrument: Instrument | null;
  profiles: UnpricedData['profiles'];
  currency: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const invalidate = useCaptableInvalidate();
  const [form, setForm] = useState({
    stakeholderId: instrument?.stakeholderId ?? '',
    profile: instrument?.profile ?? 'safe_post',
    amount: fromMinor(instrument?.amount, currency),
    originalAmount: instrument?.originalAmount ? fromMinor(instrument.originalAmount, instrument.originalCurrency ?? currency) : '',
    originalCurrency: instrument?.originalCurrency ?? '',
    valuationCap: fromMinor(instrument?.valuationCap, currency),
    discountPct: instrument ? String(Number(instrument.discountPct)) : '0',
    interestRatePct: instrument ? String(Number(instrument.interestRatePct)) : '0',
    interest: instrument?.interest ?? 'simple',
    mfn: instrument?.mfn ?? false,
    signedOn: instrument?.signedOn ?? today(),
    maturityDate: instrument?.maturityDate ?? '',
    notes: instrument?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const profile = profiles.find((p) => p.id === form.profile);
  const save = useMutation(
    trpc.captable.saveUnpriced.mutationOptions({
      onSuccess: () => {
        toast.success('Instrument saved');
        void invalidate();
        onClose();
      },
    }),
  );
  const submit = () => {
    const amount = toMinor(form.amount, currency);
    if (!amount) return setErrors({ amount: 'Enter an amount' });
    const cap = form.valuationCap.trim() ? toMinor(form.valuationCap, currency) : null;
    if (form.valuationCap.trim() && !cap) return setErrors({ valuationCap: 'Enter an amount' });
    const original = form.originalAmount.trim() ? toMinor(form.originalAmount, form.originalCurrency || currency) : null;
    const isNote = profile?.kind === 'note';
    const result = validate(unpricedInput, {
      id: instrument?.id,
      stakeholderId: form.stakeholderId,
      profile: form.profile,
      amount,
      originalAmount: original,
      originalCurrency: original ? form.originalCurrency || null : null,
      valuationCap: cap,
      discountPct: form.discountPct || '0',
      interestRatePct: isNote ? form.interestRatePct || '0' : '0',
      interest: form.interest,
      mfn: form.mfn,
      signedOn: form.signedOn,
      maturityDate: isNote && form.maturityDate ? form.maturityDate : null,
      notes: form.notes,
    });
    if (result.errors) return setErrors(result.errors);
    save.mutate(result.data);
  };
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{instrument ? 'Edit Instrument' : 'Add Instrument'}</DialogTitle>
          <DialogDescription>
            Amounts are in {currency}. Profiles are a starting point; check the terms with local counsel.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Holder" htmlFor="unpriced-holder" error={errors.stakeholderId}>
            <StakeholderPicker id="unpriced-holder" value={form.stakeholderId} onChange={(v) => set({ stakeholderId: v })} />
          </Field>
          <Field label="Profile" htmlFor="unpriced-profile" hint={profile?.description}>
            <Combobox
              id="unpriced-profile"
              value={form.profile}
              onChange={(v) => set({ profile: v as typeof form.profile })}
              options={profiles.map((p) => ({ value: p.id, label: p.label, hint: p.country ?? 'Any country' }))}
            />
          </Field>
          <Field label={`Amount (${currency})`} htmlFor="unpriced-amount" error={errors.amount}>
            <Input id="unpriced-amount" className="font-mono" value={form.amount} onChange={(e) => set({ amount: e.target.value })} />
          </Field>
          <Field label="Valuation Cap" htmlFor="unpriced-cap" error={errors.valuationCap} hint="Leave empty for no cap">
            <Input
              id="unpriced-cap"
              className="font-mono"
              value={form.valuationCap}
              onChange={(e) => set({ valuationCap: e.target.value })}
            />
          </Field>
          <Field label="Original Amount" htmlFor="unpriced-original" hint="When the money came in another currency">
            <Input
              id="unpriced-original"
              className="font-mono"
              value={form.originalAmount}
              onChange={(e) => set({ originalAmount: e.target.value })}
            />
          </Field>
          <Field label="Original Currency" htmlFor="unpriced-currency" error={errors.originalCurrency}>
            <Input
              id="unpriced-currency"
              className="font-mono uppercase"
              maxLength={3}
              placeholder="USD"
              value={form.originalCurrency}
              onChange={(e) => set({ originalCurrency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Discount (%)" htmlFor="unpriced-discount" error={errors.discountPct}>
            <Input
              id="unpriced-discount"
              className="font-mono"
              value={form.discountPct}
              onChange={(e) => set({ discountPct: e.target.value })}
            />
          </Field>
          <Field label="Signed On" htmlFor="unpriced-signed" error={errors.signedOn}>
            <Input id="unpriced-signed" type="date" value={form.signedOn} onChange={(e) => set({ signedOn: e.target.value })} />
          </Field>
          {profile?.kind === 'note' && (
            <>
              <Field label="Interest Rate (%)" htmlFor="unpriced-interest" error={errors.interestRatePct}>
                <Input
                  id="unpriced-interest"
                  className="font-mono"
                  value={form.interestRatePct}
                  onChange={(e) => set({ interestRatePct: e.target.value })}
                />
              </Field>
              <Field label="Interest" htmlFor="unpriced-interest-kind">
                <Select value={form.interest} onValueChange={(v) => set({ interest: v as typeof form.interest })}>
                  <SelectTrigger id="unpriced-interest-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTEREST.map((i) => (
                      <SelectItem key={i} value={i}>
                        {INTEREST_LABELS[i]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Maturity Date" htmlFor="unpriced-maturity" error={errors.maturityDate}>
                <Input
                  id="unpriced-maturity"
                  type="date"
                  value={form.maturityDate}
                  onChange={(e) => set({ maturityDate: e.target.value })}
                />
              </Field>
            </>
          )}
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch id="unpriced-mfn" checked={form.mfn} onCheckedChange={(v) => set({ mfn: v })} />
            <Label htmlFor="unpriced-mfn">Most Favoured Nation</Label>
            <span className="text-xs text-muted-foreground">Takes the best cap and discount of any instrument signed later.</span>
          </div>
          <Field label="Notes" htmlFor="unpriced-notes" className="sm:col-span-2">
            <Textarea id="unpriced-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Save Instrument
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
