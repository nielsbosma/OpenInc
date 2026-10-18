import {
  ANTI_DILUTION,
  ANTI_DILUTION_LABELS,
  HOLDER_KINDS,
  type HolderKind,
  PARTICIPATION,
  PARTICIPATION_LABELS,
  SCENARIO_STEP_LABELS,
  type ScenarioStepInput,
} from '@openinc/shared';
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Combobox } from '@/components/Combobox';
import { Field } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { countryOptions } from '@/lib/locale-options';
import { HOLDER_KIND_LABELS } from '../registry/common';
import { fromMinor, StakeholderPicker, toMinor, useStakeholders } from './common';

type Kind = ScenarioStepInput['kind'];
export type StepDraft = ScenarioStepInput;
type Of<K extends Kind> = Extract<StepDraft, { kind: K }>;
type Person = { name: string; kind?: HolderKind; country?: string; email?: string };

export interface StepContext {
  currency: string;
  baseDate: string;
  plans: { id: string; name: string }[];
  classes: { code: string; name: string }[];
  unpriced: { id: string; label: string }[];
  readOnly: boolean;
}

export function newStep(kind: Kind, baseDate: string): StepDraft {
  switch (kind) {
    case 'priced_round':
      return {
        kind,
        name: 'Priced Round',
        date: baseDate,
        preMoney: '',
        investments: [{ stakeholderId: '', amount: '' }],
        classCode: '',
        className: '',
        votesPerShare: '1',
        seniorityRank: 1,
        liqPrefMultiple: '1',
        liqPrefCapMultiple: null,
        participation: 'none',
        antiDilution: 'broad_weighted_average',
        poolTargetPct: null,
        poolBasis: 'post',
        proRataIds: [],
      };
    case 'pool_change':
      return { kind, delta: '' };
    case 'grant_batch':
      return { kind, grants: [{ stakeholderId: '', units: '', strikePrice: '0' }] };
    case 'secondary':
      return { kind, fromStakeholderId: '', classCode: '', units: '', pricePerShare: '0' };
    case 'exercise':
      return { kind };
    case 'exit':
      return { kind, exitValue: '', transactionCosts: '0', debt: '0', unvested: 'cancel' };
  }
}

const blank = (v: unknown) => (v === '' ? undefined : v);
const minor = (v: unknown, currency: string) =>
  v === undefined || v === null || v === '' ? v : (toMinor(String(v), currency) ?? `invalid:${v}`);
const major = (v: unknown, currency: string) => (v === undefined || v === null || v === '' ? v : fromMinor(String(v), currency));

/** Editor drafts hold money in major units and empty strings for unset ids; the services take minor units. */
export function toInput(step: StepDraft, currency: string): StepDraft {
  switch (step.kind) {
    case 'priced_round':
      return {
        ...step,
        preMoney: minor(step.preMoney, currency) as string | undefined,
        poolPlanId: blank(step.poolPlanId) as string | undefined,
        investments: step.investments.map((i) => ({
          ...i,
          stakeholderId: i.newInvestor ? undefined : (blank(i.stakeholderId) as string | undefined),
          amount: minor(i.amount, currency) as string,
        })),
      };
    case 'pool_change':
      return { ...step, planId: blank(step.planId) as string | undefined };
    case 'grant_batch':
      return {
        ...step,
        planId: blank(step.planId) as string | undefined,
        grants: step.grants.map((g) => ({
          ...g,
          stakeholderId: g.newStakeholder ? undefined : (blank(g.stakeholderId) as string | undefined),
        })),
      };
    case 'secondary':
      return { ...step, toStakeholderId: step.newBuyer ? undefined : (blank(step.toStakeholderId) as string | undefined) };
    case 'exit':
      return {
        ...step,
        exitValue: minor(step.exitValue, currency) as string,
        transactionCosts: minor(step.transactionCosts ?? '0', currency) as string,
        debt: minor(step.debt ?? '0', currency) as string,
      };
    default:
      return step;
  }
}

export function fromInput(step: StepDraft, currency: string): StepDraft {
  switch (step.kind) {
    case 'priced_round':
      return {
        ...step,
        preMoney: major(step.preMoney, currency) as string | undefined,
        investments: step.investments.map((i) => ({ ...i, amount: major(i.amount, currency) as string })),
      };
    case 'exit':
      return {
        ...step,
        exitValue: major(step.exitValue, currency) as string,
        transactionCosts: major(step.transactionCosts, currency) as string,
        debt: major(step.debt, currency) as string,
      };
    default:
      return step;
  }
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

function TextField({
  label,
  value,
  onChange,
  mono = true,
  disabled,
  hint,
  type,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  mono?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  type?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type={type}
        className={mono ? 'font-mono' : undefined}
        value={str(value)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const DEFAULT = '__default';

function PersonPicker({
  label,
  stakeholderId,
  person,
  onChange,
  newLabel,
  disabled,
}: {
  label: string;
  stakeholderId?: string;
  person?: Person;
  onChange: (v: { stakeholderId?: string; person?: Person }) => void;
  newLabel: string;
  disabled?: boolean;
}) {
  const mode = person ? 'new' : 'existing';
  return (
    <div className="grid gap-2">
      <SelectField
        label={label}
        value={mode}
        disabled={disabled}
        onChange={(m) => onChange(m === 'new' ? { person: { name: '', kind: 'company', country: '', email: '' } } : { stakeholderId: '' })}
        options={[
          { value: 'existing', label: 'Existing Stakeholder' },
          { value: 'new', label: newLabel },
        ]}
      />
      {mode === 'existing' ? (
        <StakeholderPicker value={stakeholderId ?? ''} onChange={(id) => onChange({ stakeholderId: id })} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <TextField
            label="Name"
            mono={false}
            value={person!.name}
            disabled={disabled}
            onChange={(name) => onChange({ person: { ...person!, name } })}
          />
          <SelectField
            label="Kind"
            value={person!.kind ?? 'company'}
            disabled={disabled}
            onChange={(kind) => onChange({ person: { ...person!, kind } })}
            options={HOLDER_KINDS.map((k) => ({ value: k, label: HOLDER_KIND_LABELS[k] }))}
          />
          <Field label="Country">
            <Combobox
              value={person!.country ?? ''}
              disabled={disabled}
              onChange={(country) => onChange({ person: { ...person!, country } })}
              options={countryOptions()}
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function RemoveButton({ onClick, disabled, label }: { onClick: () => void; disabled?: boolean; label: string }) {
  return (
    <Button type="button" variant="ghost" size="icon" onClick={onClick} disabled={disabled} aria-label={label}>
      <X />
    </Button>
  );
}

function PricedRoundForm({ step, set, ctx }: { step: Of<'priced_round'>; set: (s: Of<'priced_round'>) => void; ctx: StepContext }) {
  const ro = ctx.readOnly;
  const stakeholders = useStakeholders();
  const names = new Map((stakeholders.data?.stakeholders ?? []).map((s) => [s.id, s.name]));
  const byPrice = step.pricePerShare !== undefined;
  const selected = step.convertIds ?? ctx.unpriced.map((u) => u.id);
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label="Name" mono={false} value={step.name} disabled={ro} onChange={(name) => set({ ...step, name })} />
        <TextField label="Date" type="date" value={step.date} disabled={ro} onChange={(date) => set({ ...step, date })} />
        <SelectField
          label="Priced By"
          value={byPrice ? 'price' : 'pre'}
          disabled={ro}
          onChange={(m) => set({ ...step, preMoney: m === 'pre' ? '' : undefined, pricePerShare: m === 'price' ? '' : undefined })}
          options={[
            { value: 'pre', label: 'Pre-Money Valuation' },
            { value: 'price', label: 'Price per Share' },
          ]}
        />
        {byPrice ? (
          <TextField
            label={`Price per Share (${ctx.currency})`}
            value={step.pricePerShare}
            disabled={ro}
            onChange={(pricePerShare) => set({ ...step, pricePerShare })}
          />
        ) : (
          <TextField
            label={`Pre-Money Valuation (${ctx.currency})`}
            value={step.preMoney}
            disabled={ro}
            onChange={(preMoney) => set({ ...step, preMoney })}
          />
        )}
      </div>
      <div className="grid gap-2">
        <Label>Investments</Label>
        {step.investments.map((inv, i) => (
          <div key={i} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_auto]">
            <PersonPicker
              label="Investor"
              newLabel="New Investor"
              disabled={ro}
              stakeholderId={inv.stakeholderId}
              person={inv.newInvestor}
              onChange={(v) =>
                set({
                  ...step,
                  investments: step.investments.map((x, j) =>
                    j === i
                      ? {
                          amount: x.amount,
                          stakeholderId: v.stakeholderId,
                          newInvestor: v.person ? { kind: 'company', ...v.person } : undefined,
                        }
                      : x,
                  ),
                })
              }
            />
            <TextField
              label={`Amount (${ctx.currency})`}
              value={inv.amount}
              disabled={ro}
              onChange={(amount) => set({ ...step, investments: step.investments.map((x, j) => (j === i ? { ...x, amount } : x)) })}
            />
            <RemoveButton
              label="Remove Investment"
              disabled={ro || step.investments.length === 1}
              onClick={() => set({ ...step, investments: step.investments.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        {!ro && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => set({ ...step, investments: [...step.investments, { stakeholderId: '', amount: '' }] })}
          >
            <Plus /> Add Investment
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField
          label="Class Code"
          value={step.classCode}
          disabled={ro}
          onChange={(classCode) => set({ ...step, classCode })}
          hint="An existing class, or a new one"
        />
        <TextField
          label="Class Name"
          mono={false}
          value={step.className}
          disabled={ro}
          onChange={(className) => set({ ...step, className })}
        />
        <TextField
          label="Votes per Share"
          value={step.votesPerShare}
          disabled={ro}
          onChange={(votesPerShare) => set({ ...step, votesPerShare })}
        />
        <TextField
          label="Seniority"
          value={step.seniorityRank}
          disabled={ro}
          onChange={(v) => set({ ...step, seniorityRank: Number(v) || 0 })}
          hint="Higher is paid first"
        />
        <TextField
          label="Liquidation Preference (x)"
          value={step.liqPrefMultiple}
          disabled={ro}
          onChange={(liqPrefMultiple) => set({ ...step, liqPrefMultiple })}
        />
        <SelectField
          label="Participation"
          value={step.participation ?? 'none'}
          disabled={ro}
          onChange={(participation) =>
            set({ ...step, participation, liqPrefCapMultiple: participation === 'capped' ? (step.liqPrefCapMultiple ?? '3') : null })
          }
          options={PARTICIPATION.map((p) => ({ value: p, label: PARTICIPATION_LABELS[p] }))}
        />
        {step.participation === 'capped' && (
          <TextField
            label="Cap (x)"
            value={step.liqPrefCapMultiple}
            disabled={ro}
            onChange={(liqPrefCapMultiple) => set({ ...step, liqPrefCapMultiple })}
          />
        )}
        <SelectField
          label="Anti-Dilution"
          value={step.antiDilution ?? 'broad_weighted_average'}
          disabled={ro}
          onChange={(antiDilution) => set({ ...step, antiDilution })}
          options={ANTI_DILUTION.map((a) => ({ value: a, label: ANTI_DILUTION_LABELS[a] }))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Pool Target (%)"
          value={step.poolTargetPct}
          disabled={ro}
          hint="Leave empty to keep the pool as it is"
          onChange={(v) => set({ ...step, poolTargetPct: v === '' ? null : v })}
        />
        <SelectField
          label="Pool Target Of"
          value={step.poolBasis ?? 'post'}
          disabled={ro}
          onChange={(poolBasis) => set({ ...step, poolBasis })}
          options={[
            { value: 'post', label: 'Post-Money' },
            { value: 'pre', label: 'Pre-Money' },
          ]}
        />
        <SelectField
          label="Pool Plan"
          value={step.poolPlanId || DEFAULT}
          disabled={ro}
          onChange={(v) => set({ ...step, poolPlanId: v === DEFAULT ? undefined : v })}
          options={[{ value: DEFAULT, label: 'First Option Plan' }, ...ctx.plans.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </div>
      {ctx.unpriced.length > 0 && (
        <div className="grid gap-2">
          <Label>Converting Instruments</Label>
          {ctx.unpriced.map((u) => (
            <Label key={u.id} className="flex items-center gap-2 font-normal">
              <Checkbox
                checked={selected.includes(u.id)}
                disabled={ro}
                onCheckedChange={(on) => {
                  const next = on ? [...selected, u.id] : selected.filter((id) => id !== u.id);
                  set({ ...step, convertIds: next.length === ctx.unpriced.length ? undefined : next });
                }}
              />
              {u.label}
            </Label>
          ))}
        </div>
      )}
      <div className="grid gap-2">
        <Label>Pro Rata Rights</Label>
        <div className="flex flex-wrap gap-2">
          {(step.proRataIds ?? []).map((id) => (
            <Badge key={id} variant="secondary" className="gap-1">
              {names.get(id) ?? id}
              {!ro && (
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => set({ ...step, proRataIds: (step.proRataIds ?? []).filter((x) => x !== id) })}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
        {!ro && (
          <div className="max-w-sm">
            <StakeholderPicker
              value=""
              placeholder="Add a stakeholder…"
              onChange={(id) => !(step.proRataIds ?? []).includes(id) && set({ ...step, proRataIds: [...(step.proRataIds ?? []), id] })}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PlanSelect({ value, onChange, ctx }: { value?: string; onChange: (v: string | undefined) => void; ctx: StepContext }) {
  return (
    <SelectField
      label="Equity Plan"
      value={value || DEFAULT}
      disabled={ctx.readOnly}
      onChange={(v) => onChange(v === DEFAULT ? undefined : v)}
      options={[{ value: DEFAULT, label: 'First Option Plan' }, ...ctx.plans.map((p) => ({ value: p.id, label: p.name }))]}
    />
  );
}

function GrantBatchForm({ step, set, ctx }: { step: Of<'grant_batch'>; set: (s: Of<'grant_batch'>) => void; ctx: StepContext }) {
  const ro = ctx.readOnly;
  return (
    <div className="grid gap-3">
      <div className="max-w-sm">
        <PlanSelect value={step.planId} onChange={(planId) => set({ ...step, planId })} ctx={ctx} />
      </div>
      {step.grants.map((g, i) => (
        <div key={i} className="grid items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_9rem_auto]">
          <PersonPicker
            label="Recipient"
            newLabel="New Person"
            disabled={ro}
            stakeholderId={g.stakeholderId}
            person={g.newStakeholder}
            onChange={(v) =>
              set({
                ...step,
                grants: step.grants.map((x, j) =>
                  j === i
                    ? { ...x, stakeholderId: v.stakeholderId, newStakeholder: v.person ? { kind: 'person', ...v.person } : undefined }
                    : x,
                ),
              })
            }
          />
          <TextField
            label="Units"
            value={g.units}
            disabled={ro}
            onChange={(units) => set({ ...step, grants: step.grants.map((x, j) => (j === i ? { ...x, units } : x)) })}
          />
          <TextField
            label={`Strike (${ctx.currency})`}
            value={g.strikePrice}
            disabled={ro}
            onChange={(strikePrice) => set({ ...step, grants: step.grants.map((x, j) => (j === i ? { ...x, strikePrice } : x)) })}
          />
          <RemoveButton
            label="Remove Grant"
            disabled={ro || step.grants.length === 1}
            onClick={() => set({ ...step, grants: step.grants.filter((_, j) => j !== i) })}
          />
        </div>
      ))}
      {!ro && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => set({ ...step, grants: [...step.grants, { stakeholderId: '', units: '', strikePrice: '0' }] })}
        >
          <Plus /> Add Grant
        </Button>
      )}
    </div>
  );
}

function SecondaryForm({ step, set, ctx }: { step: Of<'secondary'>; set: (s: Of<'secondary'>) => void; ctx: StepContext }) {
  const ro = ctx.readOnly;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Seller">
        <StakeholderPicker value={step.fromStakeholderId} onChange={(fromStakeholderId) => set({ ...step, fromStakeholderId })} />
      </Field>
      <PersonPicker
        label="Buyer"
        newLabel="New Buyer"
        disabled={ro}
        stakeholderId={step.toStakeholderId}
        person={step.newBuyer}
        onChange={(v) =>
          set({ ...step, toStakeholderId: v.stakeholderId, newBuyer: v.person ? { kind: 'company', ...v.person } : undefined })
        }
      />
      <SelectField
        label="Class"
        value={step.classCode}
        disabled={ro}
        onChange={(classCode) => set({ ...step, classCode })}
        options={ctx.classes.map((c) => ({ value: c.code, label: c.name && c.name !== c.code ? `${c.code} (${c.name})` : c.code }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Units" value={step.units} disabled={ro} onChange={(units) => set({ ...step, units })} />
        <TextField
          label={`Price per Share (${ctx.currency})`}
          value={step.pricePerShare}
          disabled={ro}
          onChange={(pricePerShare) => set({ ...step, pricePerShare })}
        />
      </div>
    </div>
  );
}

function ExitForm({ step, set, ctx }: { step: Of<'exit'>; set: (s: Of<'exit'>) => void; ctx: StepContext }) {
  const ro = ctx.readOnly;
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <TextField
        label={`Exit Value (${ctx.currency})`}
        value={step.exitValue}
        disabled={ro}
        onChange={(exitValue) => set({ ...step, exitValue })}
      />
      <TextField
        label="Transaction Costs"
        value={step.transactionCosts}
        disabled={ro}
        onChange={(transactionCosts) => set({ ...step, transactionCosts })}
      />
      <TextField label="Debt" value={step.debt} disabled={ro} onChange={(debt) => set({ ...step, debt })} />
      <SelectField
        label="Unvested Awards"
        value={step.unvested ?? 'cancel'}
        disabled={ro}
        onChange={(unvested) => set({ ...step, unvested })}
        options={[
          { value: 'cancel', label: 'Cancel' },
          { value: 'accelerate', label: 'Accelerate' },
        ]}
      />
    </div>
  );
}

export function StepEditor({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  ctx,
  children,
}: {
  step: StepDraft;
  index: number;
  count: number;
  onChange: (s: StepDraft) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  ctx: StepContext;
  children?: ReactNode;
}) {
  const ro = ctx.readOnly;
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>
          {index + 1}. {SCENARIO_STEP_LABELS[step.kind]}
        </CardTitle>
        {!ro && (
          <CardAction className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Move Up"
              disabled={index === 0 || step.kind === 'exit'}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Move Down"
              disabled={index === count - 1 || step.kind === 'exit'}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove Step" onClick={onRemove}>
              <Trash2 />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-5">
        {step.kind === 'priced_round' && <PricedRoundForm step={step} set={onChange} ctx={ctx} />}
        {step.kind === 'pool_change' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <PlanSelect value={step.planId} onChange={(planId) => onChange({ ...step, planId })} ctx={ctx} />
            <TextField
              label="Units Added"
              value={step.delta}
              disabled={ro}
              hint="Negative to shrink the pool"
              onChange={(delta) => onChange({ ...step, delta })}
            />
          </div>
        )}
        {step.kind === 'grant_batch' && <GrantBatchForm step={step} set={onChange} ctx={ctx} />}
        {step.kind === 'secondary' && <SecondaryForm step={step} set={onChange} ctx={ctx} />}
        {step.kind === 'exercise' && <p className="text-muted-foreground">Every vested option and warrant is exercised into shares.</p>}
        {step.kind === 'exit' && <ExitForm step={step} set={onChange} ctx={ctx} />}
        {children}
      </CardContent>
    </Card>
  );
}
