import {
  HOLDER_KINDS,
  type HolderDetails,
  type HolderKind,
  holderDetails,
  RULE_PACKS,
  type RulePackId,
  type TxStatus,
} from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Combobox } from '@/components/Combobox';
import { Field, validate } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { countryOptions } from '@/lib/locale-options';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';

export type RegistryStatus = Extract<RouterOutputs['registry']['status'], { setUp: true }>;
export type RegisterData = RouterOutputs['registry']['getRegister'];

export function useRegistryStatus() {
  const trpc = useTRPC();
  return useQuery(trpc.registry.status.queryOptions());
}

export function rulePackOf(status: RegistryStatus) {
  return RULE_PACKS[status.settings.rulePack as RulePackId];
}

const numberFormat = new Intl.NumberFormat('en');
export const fmt = (v: bigint | number | string) => numberFormat.format(typeof v === 'string' ? Number(v) : v);

export function fmtRanges(ranges: { from: bigint; to: bigint }[]) {
  return ranges.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(', ');
}

/** "1-100, 200-250" → ranges. Returns null when the text does not parse. */
export function parseRanges(text: string): { from: string; to: string }[] | null {
  if (!text.trim()) return [];
  const out: { from: string; to: string }[] = [];
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:[-–](\d+))?$/.exec(part);
    if (!m) return null;
    out.push({ from: m[1]!, to: m[2] ?? m[1]! });
  }
  return out;
}

export function rangesCount(ranges: { from: string; to: string }[]) {
  return ranges.reduce((s, r) => s + (BigInt(r.to) - BigInt(r.from) + 1n), 0n);
}

const STATUS_VARIANT: Record<TxStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  awaiting_decision: 'secondary',
  awaiting_registration: 'secondary',
  committed: 'default',
  reversed: 'destructive',
};

export function StatusBadge({ status, label }: { status: TxStatus; label: string }) {
  return <Badge variant={STATUS_VARIANT[status]}>{label}</Badge>;
}

export const HOLDER_KIND_LABELS: Record<HolderKind, string> = {
  person: 'Person',
  company: 'Company',
  estate: 'Estate',
  joint: 'Joint Holders',
};

export interface HolderOption {
  holderId: string;
  name: string;
  nationalId: string;
}

/** Holders in the register plus those added in the transaction being prepared. */
export function useHolderOptions(extra: HolderDetails[] = []) {
  const trpc = useTRPC();
  const list = useQuery(trpc.registry.searchHolders.queryOptions({ search: '' }));
  return useMemo(() => {
    const map = new Map<string, HolderOption>();
    for (const h of list.data ?? []) map.set(h.holderId, h);
    for (const h of extra) map.set(h.holderId, h);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [list.data, extra]);
}

export function HolderPicker({
  id,
  value,
  onChange,
  options,
  onAdd,
  invalid,
  placeholder = 'Pick a holder…',
}: {
  id?: string;
  value: string;
  onChange: (holderId: string) => void;
  options: HolderOption[];
  onAdd?: (holder: HolderDetails) => void;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        invalid={invalid}
        placeholder={placeholder}
        options={options.map((o) => ({ value: o.holderId, label: o.name, hint: o.nationalId }))}
        footer={
          onAdd && (
            <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setAdding(true)}>
              <Plus /> Add New Holder
            </Button>
          )
        }
      />
      {onAdd && (
        <HolderDialog
          open={adding}
          onOpenChange={setAdding}
          onSave={(h) => {
            onAdd(h);
            onChange(h.holderId);
          }}
        />
      )}
    </>
  );
}

export function HolderDialog({
  open,
  onOpenChange,
  onSave,
  initial,
  rulePack,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (holder: HolderDetails) => void;
  initial?: HolderDetails;
  rulePack?: RulePackId;
}) {
  const [form, setForm] = useState<HolderDetails>(
    () =>
      initial ?? {
        holderId: crypto.randomUUID(),
        kind: 'person',
        name: '',
        nationalId: '',
        country: 'SE',
        address: '',
        email: '',
        members: [],
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (patch: Partial<HolderDetails>) => setForm((f) => ({ ...f, ...patch }));
  const save = () => {
    const result = validate(holderDetails, form);
    if (result.errors) return setErrors(result.errors);
    const problems = rulePack ? RULE_PACKS[rulePack].checkHolder(result.data).filter((p) => p.severity === 'error') : [];
    if (problems.length) return setErrors({ nationalId: problems[0]!.message });
    onSave(result.data);
    onOpenChange(false);
    if (!initial) setForm({ ...form, holderId: crypto.randomUUID(), name: '', nationalId: '', address: '', email: '' });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit Holder' : 'Add New Holder'}</DialogTitle>
          <DialogDescription>Saved with this transaction. The register shows them once it is committed.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kind" htmlFor="holder-kind">
            <Select value={form.kind} onValueChange={(v) => set({ kind: v as HolderKind })}>
              <SelectTrigger id="holder-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLDER_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {HOLDER_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Country" htmlFor="holder-country">
            <Combobox id="holder-country" value={form.country} onChange={(v) => set({ country: v })} options={countryOptions()} />
          </Field>
          <Field label="Name" htmlFor="holder-name" error={errors.name} className="sm:col-span-2">
            <Input id="holder-name" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field
            label={form.kind === 'company' ? 'Registration Number' : 'National ID Number'}
            htmlFor="holder-id"
            error={errors.nationalId}
            hint={
              form.country === 'SE' ? (form.kind === 'company' ? 'Organisationsnummer' : 'Personnummer or samordningsnummer') : undefined
            }
          >
            <Input id="holder-id" className="font-mono" value={form.nationalId} onChange={(e) => set({ nationalId: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="holder-email" error={errors.email}>
            <Input id="holder-email" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Address" htmlFor="holder-address" className="sm:col-span-2">
            <Input id="holder-address" value={form.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          {(form.kind === 'joint' || form.kind === 'estate') && (
            <Field
              label={form.kind === 'estate' ? 'Heirs and Representative' : 'Joint Holders'}
              htmlFor="holder-members"
              hint="One per line: name, ID number"
              className="sm:col-span-2"
            >
              <Textarea
                id="holder-members"
                value={form.members.map((m) => [m.name, m.nationalId].filter(Boolean).join(', ')).join('\n')}
                onChange={(e) =>
                  set({
                    members: e.target.value
                      .split('\n')
                      .filter((l) => l.trim())
                      .map((l) => {
                        const [name, nationalId = ''] = l.split(',').map((x) => x.trim());
                        return { name: name!, nationalId };
                      }),
                  })
                }
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{initial ? 'Save' : 'Add Holder'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function exportUrl(kind: string, params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return `/api/registry/export/${kind}${q.size ? `?${q}` : ''}`;
}
