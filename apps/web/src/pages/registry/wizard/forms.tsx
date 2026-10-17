import {
  ANTI_DILUTION,
  ANTI_DILUTION_LABELS,
  type AntiDilution,
  FRACTION_HANDLING,
  type HolderDetails,
  ISSUE_FORMS,
  PARTICIPATION,
  PARTICIPATION_LABELS,
  type Participation,
  ROUNDING,
  RULE_PACKS,
  STEP_OUTCOMES,
  TRANSFER_KINDS,
  type TransactionType,
  type WizardStepKey,
} from '@openinc/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fmt, fmtRanges, HolderDialog } from '../common';
import { ChoiceField, DateField, type FormContext, HolderField, LinesEditor, MoneyField, TextField } from './fields';

const TRANSFER_LABELS: Record<(typeof TRANSFER_KINDS)[number], string> = {
  sale: 'Sale',
  gift: 'Gift',
  inheritance: 'Inheritance (to the Estate)',
  division_of_property: 'Division of Property',
  will: 'Will',
  other: 'Other',
};
const OUTCOME_LABELS: Record<(typeof STEP_OUTCOMES)[number], string> = {
  not_exercised: 'Offered, Not Used',
  waived: 'Waived',
  exercised: 'Used by Another Holder',
};
const ROUNDING_LABELS: Record<(typeof ROUNDING)[number], string> = { down: 'Round Down', nearest: 'Round to Nearest', up: 'Round Up' };
const FRACTION_LABELS: Record<(typeof FRACTION_HANDLING)[number], string> = {
  round: 'Round Each Holding',
  buy_out: 'Company Buys Out Fractions',
  pool: 'Pool Fractions With One Holder',
};
const FORM_LABELS: Record<(typeof ISSUE_FORMS)[number], string> = { cash: 'Cash', set_off: 'Set-off', in_kind: 'In Kind' };

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function EffectiveDate({ ctx, label = 'Effective Date', hint }: { ctx: FormContext; label?: string; hint?: string }) {
  return (
    <DateField
      id="tx-effective"
      label={label}
      value={ctx.tx.effectiveDate}
      onChange={(v) => ctx.set({ effectiveDate: v })}
      hint={hint}
      error={ctx.errors.effectiveDate}
    />
  );
}

function Note({ ctx }: { ctx: FormContext }) {
  return (
    <Field label="Note" htmlFor="tx-note" className="sm:col-span-2">
      <Textarea id="tx-note" value={ctx.tx.note ?? ''} onChange={(e) => ctx.set({ note: e.target.value })} />
    </Field>
  );
}

function RegistrationStep({ ctx, type }: { ctx: FormContext; type: TransactionType }) {
  const pack = RULE_PACKS[ctx.rulePack];
  const interim = pack.interimUntilRegistered.includes(type);
  const required = pack.registrationRequired.includes(type);
  return (
    <Grid>
      <DateField
        id="tx-registration"
        label="Registration Date"
        value={ctx.tx.registrationDate}
        onChange={(v) => ctx.set({ registrationDate: v })}
      />
      <p className="text-sm text-muted-foreground sm:col-span-2">
        {interim
          ? `Leave it empty if ${pack.terms.registrationAuthority} has not registered the issue yet: the new shares are entered as interim shares, and a Registration transaction converts them later.`
          : required
            ? `It can only be entered once ${pack.terms.registrationAuthority} has registered it. Without a date, park it as Awaiting Registration.`
            : 'The date the business register recorded it, if it needs registration.'}
      </p>
    </Grid>
  );
}

function DecisionStep({ ctx }: { ctx: FormContext }) {
  return (
    <Grid>
      <DateField
        id="tx-decision"
        label="Decision Date"
        value={ctx.tx.decisionDate}
        onChange={(v) => ctx.set({ decisionDate: v })}
        hint="When the board or the general meeting decided"
      />
      <EffectiveDate ctx={ctx} />
    </Grid>
  );
}

export const NEW_CLASS = {
  code: '',
  name: '',
  votesPerShare: '1',
  nominalPerShare: null,
  restrictions: { consent: false, preEmption: false, firstRefusal: false },
  seniorityRank: 0,
  liqPrefMultiple: '1',
  liqPrefCapMultiple: null,
  participation: 'none',
  antiDilution: 'none',
};

interface ClassDraft {
  code: string;
  name: string;
  votesPerShare: string;
  nominalPerShare: string | null;
  restrictions: Record<string, boolean>;
  seniorityRank: number;
  liqPrefMultiple: string;
  liqPrefCapMultiple: string | null;
  participation: Participation;
  antiDilution: AntiDilution;
}

/** Share classes with their voting, transfer and liquidation terms. Codes of classes that already exist cannot change. */
function ClassesEditor({ ctx, lockedCodes = [] }: { ctx: FormContext; lockedCodes?: string[] }) {
  const classes = ctx.tx.classes as ClassDraft[];
  const update = (i: number, patch: Partial<ClassDraft>) => ctx.set({ classes: classes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const terms = RULE_PACKS[ctx.rulePack].terms;
  return (
    <div className="grid gap-3">
      {classes.map((c, i) => {
        const locked = lockedCodes.includes(c.code);
        return (
          <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-4">
            {locked ? (
              <Field label="Class" htmlFor={`class-code-${i}`}>
                <Input id={`class-code-${i}`} value={c.code} disabled />
              </Field>
            ) : (
              <TextField id={`class-code-${i}`} label="Class" value={c.code} onChange={(v) => update(i, { code: v })} />
            )}
            <TextField id={`class-name-${i}`} label="Name" value={c.name} onChange={(v) => update(i, { name: v })} />
            <TextField
              id={`class-votes-${i}`}
              label="Votes per Share"
              inputMode="decimal"
              value={c.votesPerShare}
              onChange={(v) => update(i, { votesPerShare: v })}
            />
            {ctx.nominalMode && !locked ? (
              <TextField
                id={`class-nominal-${i}`}
                label={`Nominal Value (${ctx.currency})`}
                inputMode="decimal"
                value={c.nominalPerShare ?? ''}
                onChange={(v) => update(i, { nominalPerShare: v || null })}
              />
            ) : (
              <div />
            )}
            <TextField
              id={`class-seniority-${i}`}
              label="Seniority"
              inputMode="numeric"
              hint="Higher is paid first; equal is pari passu"
              value={String(c.seniorityRank ?? 0)}
              onChange={(v) => update(i, { seniorityRank: Number(v.replace(/\D/g, '') || 0) })}
            />
            <TextField
              id={`class-pref-${i}`}
              label="Liquidation Preference (x)"
              inputMode="decimal"
              hint="Multiple of the issue price; 0 for common shares"
              value={c.liqPrefMultiple ?? '1'}
              onChange={(v) => update(i, { liqPrefMultiple: v })}
            />
            <ChoiceField
              id={`class-participation-${i}`}
              label="Participation"
              value={c.participation ?? 'none'}
              onChange={(v) => update(i, { participation: v, ...(v !== 'capped' ? { liqPrefCapMultiple: null } : {}) })}
              options={PARTICIPATION.map((p) => ({ value: p, label: PARTICIPATION_LABELS[p] }))}
            />
            {c.participation === 'capped' ? (
              <TextField
                id={`class-cap-${i}`}
                label="Cap (x)"
                inputMode="decimal"
                value={c.liqPrefCapMultiple ?? ''}
                onChange={(v) => update(i, { liqPrefCapMultiple: v || null })}
              />
            ) : (
              <div />
            )}
            <ChoiceField
              id={`class-anti-dilution-${i}`}
              label="Anti-dilution"
              value={c.antiDilution ?? 'none'}
              onChange={(v) => update(i, { antiDilution: v })}
              options={ANTI_DILUTION.map((a) => ({ value: a, label: ANTI_DILUTION_LABELS[a] }))}
            />
            <div className="flex flex-wrap items-end gap-4 sm:col-span-2">
              {(
                [
                  ['consent', terms.consent],
                  ['preEmption', terms.preEmption],
                  ['firstRefusal', terms.firstRefusal],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!c.restrictions?.[key]}
                    onCheckedChange={(v) => update(i, { restrictions: { ...c.restrictions, [key]: v === true } })}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="flex items-end justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove Class"
                disabled={classes.length === 1}
                onClick={() => ctx.set({ classes: classes.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => ctx.set({ classes: [...classes, { ...NEW_CLASS }] })}>
          <Plus /> Add Share Class
        </Button>
      </div>
    </div>
  );
}

function ClassChangeStep({ ctx }: { ctx: FormContext }) {
  const classes = ctx.tx.classes as ClassDraft[];
  const existing = ctx.register?.classes ?? [];
  const available = existing.filter((c) => !classes.some((x) => x.code === c.code));
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Change the terms of a class that has shares, or create a new class. The change becomes part of the history from the effective date
        on.
      </p>
      {available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map((c) => (
            <Button
              key={c.code}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                ctx.set({
                  classes: [
                    ...classes,
                    {
                      code: c.code,
                      name: c.name,
                      votesPerShare: c.votesPerShare,
                      nominalPerShare: c.nominalPerShare,
                      dividendTerms: c.dividendTerms,
                      liquidationTerms: c.liquidationTerms,
                      conversionClause: c.conversionClause,
                      redemptionClause: c.redemptionClause,
                      restrictions: c.restrictions,
                      seniorityRank: c.seniorityRank,
                      liqPrefMultiple: c.liqPrefMultiple,
                      liqPrefCapMultiple: c.liqPrefCapMultiple,
                      participation: c.participation,
                      antiDilution: c.antiDilution,
                    },
                  ],
                })
              }
            >
              Change Class {c.code}
            </Button>
          ))}
        </div>
      )}
      {classes.length > 0 ? (
        <ClassesEditor ctx={ctx} lockedCodes={existing.map((c) => c.code)} />
      ) : (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => ctx.set({ classes: [{ ...NEW_CLASS }] })}>
          <Plus /> Add Share Class
        </Button>
      )}
    </div>
  );
}

function AllocationsEditor({ ctx, field }: { ctx: FormContext; field: 'allocations' | 'lots' }) {
  const rows = ctx.tx[field] as { holderId: string; classCode: string; count: string; pricePerShare?: string; rangesText?: string }[];
  const codes = (ctx.tx.classes as { code: string }[]).map((c) => c.code).filter(Boolean);
  const update = (i: number, patch: object) => ctx.set({ [field]: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_9rem_1fr_auto]">
          <HolderField id={`alloc-holder-${i}`} label="Holder" ctx={ctx} value={r.holderId} onChange={(v) => update(i, { holderId: v })} />
          <ChoiceField
            id={`alloc-class-${i}`}
            label="Class"
            value={r.classCode}
            onChange={(v) => update(i, { classCode: v })}
            options={codes.map((c) => ({ value: c, label: c }))}
          />
          <TextField
            id={`alloc-count-${i}`}
            label="Shares"
            mono
            inputMode="numeric"
            value={r.count}
            onChange={(v) => update(i, { count: v.replace(/\D/g, '') })}
          />
          {field === 'allocations' ? (
            <TextField
              id={`alloc-price-${i}`}
              label={`Price per Share (${ctx.currency})`}
              inputMode="decimal"
              value={r.pricePerShare ?? ''}
              onChange={(v) => update(i, { pricePerShare: v || undefined })}
            />
          ) : ctx.numbering ? (
            <TextField
              id={`alloc-ranges-${i}`}
              label="Share Numbers"
              mono
              value={r.rangesText ?? ''}
              hint="e.g. 1-500, 801-900"
              onChange={(v) => update(i, { rangesText: v })}
            />
          ) : (
            <div />
          )}
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove"
              disabled={rows.length === 1}
              onClick={() => ctx.set({ [field]: rows.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => ctx.set({ [field]: [...rows, { holderId: '', classCode: codes[0] ?? '', count: '' }] })}
        >
          <Plus /> Add Holder
        </Button>
      </div>
    </div>
  );
}

function SubscriptionsEditor({ ctx }: { ctx: FormContext }) {
  const rows = ctx.tx.subscriptions as { holderId: string; count: string; paidOn: string | null }[];
  const update = (i: number, patch: object) => ctx.set({ subscriptions: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const total = rows.reduce((s, r) => s + (r.count ? BigInt(r.count) : 0n), 0n);
  return (
    <div className="grid gap-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto]">
          <HolderField
            id={`sub-holder-${i}`}
            label="Subscriber"
            ctx={ctx}
            value={r.holderId}
            onChange={(v) => update(i, { holderId: v })}
          />
          <TextField
            id={`sub-count-${i}`}
            label="Shares"
            mono
            inputMode="numeric"
            value={r.count}
            onChange={(v) => update(i, { count: v.replace(/\D/g, '') })}
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove"
              disabled={rows.length === 1}
              onClick={() => ctx.set({ subscriptions: rows.filter((_, j) => j !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => ctx.set({ subscriptions: [...rows, { holderId: '', count: '', paidOn: null }] })}
        >
          <Plus /> Add Subscriber
        </Button>
        <span className="text-sm text-muted-foreground">
          Total <span className="font-mono">{fmt(total)}</span> new shares
        </span>
      </div>
    </div>
  );
}

function RestrictionsStep({ ctx }: { ctx: FormContext }) {
  const pack = RULE_PACKS[ctx.rulePack];
  const codes = new Set((ctx.tx.lines as { classCode: string }[]).map((l) => l.classCode));
  const classes = ctx.register?.classes.filter((c) => codes.has(c.code)) ?? [];
  const need = {
    consent: classes.some((c) => c.restrictions.consent),
    preEmption: classes.some((c) => c.restrictions.preEmption),
    firstRefusal: classes.some((c) => c.restrictions.firstRefusal),
  };
  const steps = ctx.tx.restrictionSteps ?? {};
  const setStep = (key: string, value: object | undefined) => ctx.set({ restrictionSteps: { ...steps, [key]: value } });
  if (!need.consent && !need.preEmption && !need.firstRefusal)
    return <p className="text-muted-foreground">The classes in this transfer have no transfer restrictions.</p>;
  return (
    <div className="grid gap-4">
      {need.consent && (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 font-medium sm:col-span-2">
            <Checkbox
              checked={!!steps.consent?.obtained}
              onCheckedChange={(v) =>
                setStep('consent', v === true ? { obtained: true, date: steps.consent?.date ?? null, note: '' } : undefined)
              }
            />
            The company consented ({pack.terms.consent})
          </label>
          <DateField
            id="consent-date"
            label="Consent Date"
            value={steps.consent?.date ?? null}
            onChange={(v) => setStep('consent', { ...(steps.consent ?? { obtained: true, note: '' }), date: v })}
          />
        </div>
      )}
      {(['preEmption', 'firstRefusal'] as const)
        .filter((k) => need[k])
        .map((k) => (
          <div key={k} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <ChoiceField
              id={`${k}-outcome`}
              label={pack.terms[k]}
              value={steps[k]?.outcome ?? ''}
              onChange={(v) => setStep(k, { outcome: v, date: steps[k]?.date ?? null, note: '' })}
              options={STEP_OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABELS[o] }))}
            />
            <DateField
              id={`${k}-date`}
              label="Date"
              value={steps[k]?.date ?? null}
              onChange={(v) => steps[k] && setStep(k, { ...steps[k], date: v })}
            />
          </div>
        ))}
    </div>
  );
}

function HolderChangeStep({ ctx }: { ctx: FormContext }) {
  const [editing, setEditing] = useState(false);
  const current = (ctx.tx.holders as HolderDetails[])[0];
  const [pick, setPick] = useState(current?.holderId ?? '');
  const existing = ctx.register?.holders.find((h) => h.holderId === pick);
  return (
    <Grid>
      <HolderField id="change-holder" label="Holder" ctx={ctx} allowNew={false} value={pick} onChange={setPick} />
      <EffectiveDate ctx={ctx} hint="From when the new details apply" />
      {pick && (
        <div className="rounded-lg border p-3 sm:col-span-2">
          {current ? (
            <div className="text-sm">
              <div className="font-medium">{current.name}</div>
              <div className="text-muted-foreground">
                {[current.nationalId, current.address, current.email].filter(Boolean).join(' · ')}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No changes yet.</p>
          )}
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setEditing(true)}>
            Edit Details
          </Button>
          <HolderDialog
            key={pick}
            open={editing}
            onOpenChange={setEditing}
            rulePack={ctx.rulePack}
            initial={
              current?.holderId === pick
                ? current
                : {
                    holderId: pick,
                    kind: existing?.kind ?? 'person',
                    name: existing?.name ?? '',
                    nationalId: existing?.nationalId ?? '',
                    country: existing?.country ?? '',
                    address: existing?.address ?? '',
                    email: '',
                    members: [],
                  }
            }
            onSave={(h) => ctx.set({ holders: [h] })}
          />
        </div>
      )}
    </Grid>
  );
}

/** The fields of one wizard step for one transaction type. */
export function StepFields({ type, step, ctx }: { type: TransactionType; step: WizardStepKey; ctx: FormContext }) {
  const tx = ctx.tx;
  switch (type) {
    case 'incorporation':
    case 'opening_balance':
      if (step === 'details')
        return (
          <div className="grid gap-4">
            <Grid>
              <EffectiveDate
                ctx={ctx}
                label={type === 'incorporation' ? 'Registration Date of the Company' : 'Date of the Opening Balance'}
              />
              <MoneyField
                id="tx-capital"
                label="Share Capital"
                currency={ctx.currency}
                value={tx.shareCapital}
                onChange={(v) => ctx.set({ shareCapital: v })}
                error={ctx.errors.shareCapital}
              />
            </Grid>
            <h3 className="font-medium">Share Classes</h3>
            <ClassesEditor ctx={ctx} />
          </div>
        );
      if (step === 'shares')
        return (
          <div className="grid gap-3">
            {type === 'opening_balance' && (
              <p className="text-sm text-muted-foreground">
                Carry over the register as it stands on that date. To bring in a spreadsheet or PDF, use Import instead.
              </p>
            )}
            <AllocationsEditor ctx={ctx} field={type === 'incorporation' ? 'allocations' : 'lots'} />
          </div>
        );
      return null;
    case 'transfer':
      if (step === 'parties')
        return (
          <Grid>
            <ChoiceField
              id="transfer-kind"
              label="Kind of Transfer"
              value={tx.kind}
              onChange={(v) => ctx.set({ kind: v })}
              options={TRANSFER_KINDS.map((k) => ({ value: k, label: TRANSFER_LABELS[k] }))}
            />
            <EffectiveDate ctx={ctx} label="Transfer Date" />
            <HolderField
              id="transfer-from"
              label="From"
              ctx={ctx}
              allowNew={false}
              value={tx.fromHolderId}
              onChange={(v) => ctx.set({ fromHolderId: v })}
            />
            <HolderField id="transfer-to" label="To" ctx={ctx} value={tx.toHolderId} onChange={(v) => ctx.set({ toHolderId: v })} />
            {tx.kind === 'inheritance' && (
              <p className="text-sm text-muted-foreground sm:col-span-2">
                Transfer to the estate first. When the estate is divided, enter a Division of Property from the estate to the heirs.
              </p>
            )}
          </Grid>
        );
      if (step === 'shares')
        return <LinesEditor ctx={ctx} lines={tx.lines} onChange={(lines) => ctx.set({ lines })} holderId={tx.fromHolderId} />;
      if (step === 'restrictions') return <RestrictionsStep ctx={ctx} />;
      if (step === 'settlement')
        return (
          <Grid>
            <TextField
              id="transfer-price"
              label={`Price per Share (${ctx.currency})`}
              inputMode="decimal"
              value={tx.pricePerShare ?? ''}
              onChange={(v) => ctx.set({ pricePerShare: v || undefined })}
              hint={tx.kind === 'sale' ? 'Required for a sale' : 'Optional'}
            />
            <DateField
              id="settlement-date"
              label="Settlement Date"
              value={tx.settlement?.date ?? null}
              onChange={(v) => ctx.set({ settlement: { ...(tx.settlement ?? { reference: '', terms: '' }), date: v } })}
            />
            <TextField
              id="settlement-ref"
              label="Reference"
              value={tx.settlement?.reference ?? ''}
              onChange={(v) => ctx.set({ settlement: { ...(tx.settlement ?? { date: null, terms: '' }), reference: v } })}
            />
            <Note ctx={ctx} />
          </Grid>
        );
      return null;
    case 'holder_change':
      return step === 'details' ? <HolderChangeStep ctx={ctx} /> : null;
    case 'new_issue':
      if (step === 'decision')
        return (
          <div className="grid gap-4">
            <DecisionStep ctx={ctx} />
            <Grid>
              <ChoiceField
                id="issue-form"
                label="Payment"
                value={tx.form}
                onChange={(v) => ctx.set({ form: v })}
                options={ISSUE_FORMS.map((f) => ({ value: f, label: FORM_LABELS[f] }))}
              />
              <ChoiceField
                id="issue-allocation"
                label="Allocation"
                value={tx.allocation}
                onChange={(v) => ctx.set({ allocation: v })}
                options={[
                  { value: 'directed', label: 'Directed' },
                  { value: 'pro_rata', label: 'Pro Rata (Pre-emption)' },
                ]}
              />
              <ChoiceField
                id="issue-class"
                label="Class"
                value={tx.classCode}
                onChange={(v) => ctx.set({ classCode: v })}
                options={(ctx.register?.classes ?? []).map((c) => ({ value: c.code, label: c.code }))}
              />
              <TextField
                id="issue-price"
                label={`Subscription Price per Share (${ctx.currency})`}
                inputMode="decimal"
                value={tx.pricePerShare ?? ''}
                onChange={(v) => ctx.set({ pricePerShare: v })}
              />
            </Grid>
          </div>
        );
      if (step === 'subscription')
        return (
          <div className="grid gap-4">
            <DateField
              id="issue-sub-date"
              label="Subscription Date"
              value={tx.subscriptionDate}
              onChange={(v) => ctx.set({ subscriptionDate: v })}
            />
            <SubscriptionsEditor ctx={ctx} />
          </div>
        );
      if (step === 'payment')
        return (
          <Grid>
            <DateField id="issue-pay-date" label="Payment Date" value={tx.paymentDate} onChange={(v) => ctx.set({ paymentDate: v })} />
            <MoneyField
              id="issue-capital"
              label="Share Capital Increase"
              currency={ctx.currency}
              value={tx.capitalIncrease}
              onChange={(v) => ctx.set({ capitalIncrease: v })}
              hint="Leave empty to use the new shares times the current quota or nominal value"
            />
            {tx.form === 'in_kind' && (
              <Field label="Contribution in Kind" htmlFor="issue-in-kind" className="sm:col-span-2">
                <Textarea
                  id="issue-in-kind"
                  value={tx.inKindDescription ?? ''}
                  onChange={(e) => ctx.set({ inKindDescription: e.target.value })}
                />
              </Field>
            )}
          </Grid>
        );
      if (step === 'registration') return <RegistrationStep ctx={ctx} type={type} />;
      return null;
    case 'bonus_issue':
      if (step === 'decision') return <DecisionStep ctx={ctx} />;
      if (step === 'details')
        return (
          <Grid>
            <ChoiceField
              id="bonus-mode"
              label="Bonus Issue"
              value={tx.mode}
              onChange={(v) => ctx.set({ mode: v })}
              options={[
                { value: 'new_shares', label: 'With New Shares' },
                { value: 'quota_value', label: 'Raise the Quota Value Only' },
              ]}
            />
            <MoneyField
              id="bonus-capital"
              label="Share Capital Increase"
              currency={ctx.currency}
              value={tx.capitalIncrease}
              onChange={(v) => ctx.set({ capitalIncrease: v })}
            />
            {tx.mode === 'new_shares' && (
              <>
                <TextField
                  id="bonus-new"
                  label="New Shares"
                  inputMode="numeric"
                  value={tx.ratio?.newShares ?? ''}
                  onChange={(v) => ctx.set({ ratio: { ...tx.ratio, newShares: v.replace(/\D/g, '') } })}
                />
                <TextField
                  id="bonus-per"
                  label="Per Held Shares"
                  inputMode="numeric"
                  value={tx.ratio?.perShares ?? ''}
                  onChange={(v) => ctx.set({ ratio: { ...tx.ratio, perShares: v.replace(/\D/g, '') } })}
                />
                <ChoiceField
                  id="bonus-rounding"
                  label="Fractions"
                  value={tx.rounding}
                  onChange={(v) => ctx.set({ rounding: v })}
                  options={ROUNDING.map((r) => ({ value: r, label: ROUNDING_LABELS[r] }))}
                />
              </>
            )}
          </Grid>
        );
      if (step === 'registration') return <RegistrationStep ctx={ctx} type={type} />;
      return null;
    case 'split':
    case 'reverse_split':
      if (step === 'decision') return <DecisionStep ctx={ctx} />;
      if (step === 'details')
        return (
          <Grid>
            <Field label={type === 'split' ? 'Each Share Becomes' : 'Shares Combined Into One'} htmlFor="split-ratio">
              <Input
                id="split-ratio"
                inputMode="numeric"
                className="font-mono"
                value={tx.ratio ?? ''}
                onChange={(e) => ctx.set({ ratio: Number(e.target.value.replace(/\D/g, '')) || '' })}
              />
            </Field>
            {type === 'reverse_split' && (
              <>
                <ChoiceField
                  id="rs-fractions"
                  label="Fractions"
                  value={tx.fractions}
                  onChange={(v) => ctx.set({ fractions: v })}
                  options={FRACTION_HANDLING.map((f) => ({ value: f, label: FRACTION_LABELS[f] }))}
                />
                {tx.fractions === 'round' && (
                  <ChoiceField
                    id="rs-rounding"
                    label="Rounding"
                    value={tx.rounding}
                    onChange={(v) => ctx.set({ rounding: v })}
                    options={ROUNDING.map((r) => ({ value: r, label: ROUNDING_LABELS[r] }))}
                  />
                )}
                {tx.fractions === 'buy_out' && (
                  <TextField
                    id="rs-price"
                    label={`Price per Old Share (${ctx.currency})`}
                    inputMode="decimal"
                    value={tx.buyOutPricePerShare ?? ''}
                    onChange={(v) => ctx.set({ buyOutPricePerShare: v || undefined })}
                  />
                )}
                {tx.fractions === 'pool' && (
                  <HolderField
                    id="rs-pool"
                    label="Holder Collecting the Fractions"
                    ctx={ctx}
                    value={tx.poolHolderId ?? ''}
                    onChange={(v) => ctx.set({ poolHolderId: v })}
                  />
                )}
              </>
            )}
          </Grid>
        );
      if (step === 'registration') return <RegistrationStep ctx={ctx} type={type} />;
      return null;
    case 'registration': {
      const pending = ctx.register?.interimIssues ?? [];
      if (step !== 'registration') return null;
      return (
        <Grid>
          {pending.length ? (
            <ChoiceField
              id="reg-of"
              label="New Issue"
              value={tx.ofTransactionId}
              onChange={(v) => ctx.set({ ofTransactionId: v })}
              options={pending.map((id, i) => ({ value: id, label: `Interim Issue ${i + 1} (${id.slice(0, 8)})` }))}
            />
          ) : (
            <p className="text-muted-foreground">No new issue is waiting for registration.</p>
          )}
          <DateField
            id="reg-date"
            label="Registration Date"
            value={tx.registrationDate}
            onChange={(v) => ctx.set({ registrationDate: v, effectiveDate: v })}
          />
        </Grid>
      );
    }
    case 'pledge':
      if (step === 'parties')
        return (
          <Grid>
            <HolderField
              id="pledge-holder"
              label="Holder"
              ctx={ctx}
              allowNew={false}
              value={tx.holderId}
              onChange={(v) => ctx.set({ holderId: v })}
            />
            <EffectiveDate ctx={ctx} label="Pledge Date" />
            <TextField
              id="pledgee-name"
              label="Pledgee"
              value={tx.pledgee?.name ?? ''}
              onChange={(v) => ctx.set({ pledgee: { ...tx.pledgee, name: v } })}
            />
            <TextField
              id="pledgee-id"
              label="Pledgee ID Number"
              mono
              value={tx.pledgee?.nationalId ?? ''}
              onChange={(v) => ctx.set({ pledgee: { ...tx.pledgee, nationalId: v } })}
            />
            <Field label="Terms" htmlFor="pledge-terms" className="sm:col-span-2">
              <Textarea id="pledge-terms" value={tx.terms ?? ''} onChange={(e) => ctx.set({ terms: e.target.value })} />
            </Field>
          </Grid>
        );
      if (step === 'shares')
        return <LinesEditor ctx={ctx} lines={tx.lines} onChange={(lines) => ctx.set({ lines })} holderId={tx.holderId} />;
      return null;
    case 'pledge_release': {
      if (step !== 'details') return null;
      const pledges = ctx.register?.pledges ?? [];
      const name = (id: string) => ctx.register?.holders.find((h) => h.holderId === id)?.name ?? id;
      return (
        <Grid>
          {pledges.length ? (
            <ChoiceField
              id="release-pledge"
              label="Pledge"
              value={tx.pledgeId}
              onChange={(v) => ctx.set({ pledgeId: v })}
              options={pledges.map((p) => ({
                value: p.id,
                label: `${fmt(p.count)} ${p.classCode} of ${name(p.holderId)} to ${p.pledgee.name}${p.ranges.length ? ` (${fmtRanges(p.ranges)})` : ''}`,
              }))}
            />
          ) : (
            <p className="text-muted-foreground">There are no open pledges.</p>
          )}
          <EffectiveDate ctx={ctx} label="Release Date" />
        </Grid>
      );
    }
    case 'class_change':
      if (step === 'decision') return <DecisionStep ctx={ctx} />;
      if (step === 'details') return <ClassChangeStep ctx={ctx} />;
      if (step === 'registration') return <RegistrationStep ctx={ctx} type={type} />;
      return null;
    case 'reversal':
      return step === 'details' ? (
        <Grid>
          <EffectiveDate ctx={ctx} />
          <TextField id="reversal-reason" label="Reason" value={tx.reason ?? ''} onChange={(v) => ctx.set({ reason: v })} />
        </Grid>
      ) : null;
  }
}
