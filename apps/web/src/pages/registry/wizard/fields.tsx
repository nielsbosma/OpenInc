import { formatMoney, type HolderDetails, parseMoney } from '@openinc/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmtRanges, type HolderOption, HolderPicker, parseRanges, type RegisterData } from '../common';

/** The transaction being prepared. Its shape is checked by the shared Zod schema on review and on the server. */
// biome-ignore lint/suspicious/noExplicitAny: a draft is partial and changes shape per transaction type
export type Draft = any;

export interface FormContext {
  tx: Draft;
  set: (patch: Draft) => void;
  register: RegisterData | null;
  holders: HolderOption[];
  addHolder: (h: HolderDetails) => void;
  currency: string;
  numbering: boolean;
  nominalMode: boolean;
  rulePack: 'eu-base' | 'se-abl';
  errors: Record<string, string>;
}

export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Input id={id} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}

export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  mono,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string;
  mono?: boolean;
  inputMode?: 'numeric' | 'decimal';
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <Input
        id={id}
        className={mono ? 'font-mono' : undefined}
        inputMode={inputMode}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

/** Amounts are typed in normal units and stored in minor units. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  currency,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (minor: string | undefined) => void;
  currency: string;
  hint?: string;
  error?: string;
}) {
  const [text, setText] = useState(() =>
    value
      ? formatMoney(BigInt(value), currency)
          .replace(/[^\d.,\s]/g, '')
          .trim()
      : '',
  );
  const [bad, setBad] = useState(false);
  return (
    <Field label={`${label} (${currency})`} htmlFor={id} hint={hint} error={error ?? (bad ? 'Enter an amount' : undefined)}>
      <Input
        id={id}
        inputMode="decimal"
        className="font-mono"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) {
            setBad(false);
            return onChange(undefined);
          }
          try {
            onChange(parseMoney(e.target.value, currency).toString());
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </Field>
  );
}

export function ChoiceField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: string;
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger id={id} className="w-full">
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

export function HolderField({
  id,
  label,
  ctx,
  value,
  onChange,
  allowNew = true,
  error,
  holders,
}: {
  id: string;
  label: string;
  ctx: FormContext;
  value: string;
  onChange: (id: string) => void;
  allowNew?: boolean;
  error?: string;
  holders?: HolderOption[];
}) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <HolderPicker
        id={id}
        value={value ?? ''}
        onChange={onChange}
        options={holders ?? ctx.holders}
        onAdd={allowNew ? ctx.addHolder : undefined}
        invalid={!!error}
      />
    </Field>
  );
}

export interface Line {
  classCode: string;
  count: string;
  ranges?: { from: string; to: string }[];
}

/** Shares of one or more classes, with optional share numbers. */
export function LinesEditor({
  ctx,
  lines,
  onChange,
  holderId,
  showNumbers = true,
}: {
  ctx: FormContext;
  lines: Line[];
  onChange: (lines: Line[]) => void;
  holderId?: string;
  showNumbers?: boolean;
}) {
  const classes = ctx.register?.classes.map((c) => c.code) ?? [];
  const held = (code: string) =>
    ctx.register?.holders.find((h) => h.holderId === holderId)?.positions.filter((p) => p.classCode === code && !p.interim);
  const [rangeText, setRangeText] = useState<string[]>(() =>
    lines.map((l) => (l.ranges ?? []).map((r) => (r.from === r.to ? r.from : `${r.from}-${r.to}`)).join(', ')),
  );
  const update = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="grid gap-3">
      {lines.map((line, i) => {
        const positions = holderId ? held(line.classCode) : undefined;
        const available = positions?.reduce((s, p) => s + p.count - p.pledged, 0n);
        return (
          <div key={i} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)_auto]">
            <ChoiceField
              id={`line-class-${i}`}
              label="Class"
              value={line.classCode}
              onChange={(v) => update(i, { classCode: v })}
              options={classes.map((c) => ({ value: c, label: c }))}
            />
            <TextField
              id={`line-count-${i}`}
              label="Shares"
              inputMode="numeric"
              mono
              value={line.count}
              onChange={(v) => update(i, { count: v.replace(/\D/g, '') })}
              hint={available !== undefined ? `${available} free to use` : undefined}
              error={ctx.errors[`lines.${i}.count`]}
            />
            {ctx.numbering && showNumbers ? (
              <TextField
                id={`line-ranges-${i}`}
                label="Share Numbers"
                mono
                value={rangeText[i] ?? ''}
                hint={
                  positions?.length
                    ? `Held: ${fmtRanges(positions.flatMap((p) => p.ranges))}. Leave empty to use the lowest free numbers.`
                    : 'Leave empty to use the lowest free numbers.'
                }
                onChange={(v) => {
                  setRangeText((t) => t.map((x, j) => (j === i ? v : x)).concat(i >= t.length ? [v] : []));
                  const parsed = parseRanges(v);
                  if (parsed) update(i, { ranges: parsed.length ? parsed : undefined });
                }}
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
                disabled={lines.length === 1}
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        );
      })}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            onChange([...lines, { classCode: classes[0] ?? '', count: '' }]);
            setRangeText((t) => [...t, '']);
          }}
        >
          <Plus /> Add Class
        </Button>
      </div>
    </div>
  );
}
