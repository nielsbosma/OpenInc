import { currencyDigits, formatMoney } from '@openinc/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Combobox } from '@/components/Combobox';
import { type RouterOutputs, useTRPC } from '@/lib/trpc';

export type CapTableData = RouterOutputs['captable']['get'];
export type CapTableRow = CapTableData['rows'][number];

export { exportUrl as registryExportUrl, fmt, today } from '../registry/common';

export function captableExportUrl(kind: 'table' | 'scenario', params: Record<string, string | undefined>) {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return `/api/captable/export/${kind}${q.size ? `?${q}` : ''}`;
}

const pctFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (v: string | number) => `${pctFormat.format(Number(v))}%`;

export const money = (minor: string | bigint | null | undefined, currency: string) =>
  minor === null || minor === undefined ? '–' : formatMoney(BigInt(minor), currency);

/** Minor units from a major-unit amount typed by a person ("1 250 000,50" or "1250000.50"). */
export function toMinor(text: string, currency: string): string | null {
  const clean = text.replace(/[\s_']/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const digits = currencyDigits(currency);
  const [whole, fraction = ''] = clean.split('.');
  return (BigInt(whole!) * 10n ** BigInt(digits) + BigInt((fraction.slice(0, digits) || '0').padEnd(digits, '0'))).toString();
}

export function fromMinor(minor: string | null | undefined, currency: string): string {
  if (!minor) return '';
  const digits = currencyDigits(currency);
  const v = BigInt(minor);
  const scale = 10n ** BigInt(digits);
  const fraction = (v % scale).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${v / scale}${fraction ? `.${fraction}` : ''}`;
}

export const GROUP_SWATCH: Record<string, string> = {
  indigo: 'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-400',
  teal: 'bg-teal-500',
};

export const GROUP_FILL: Record<string, string> = {
  indigo: '#6366f1',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  slate: '#94a3b8',
  teal: '#14b8a6',
};

export function useStakeholders() {
  const trpc = useTRPC();
  return useQuery(trpc.captable.listStakeholders.queryOptions());
}

export function StakeholderPicker({
  id,
  value,
  onChange,
  placeholder = 'Pick a stakeholder…',
  invalid,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  const list = useStakeholders();
  const options = useMemo(
    () =>
      (list.data?.stakeholders ?? []).map((s) => ({
        value: s.id,
        label: s.name,
        hint: s.inRegister ? 'In the register' : 'Cap table only',
      })),
    [list.data],
  );
  return <Combobox id={id} value={value} onChange={onChange} options={options} placeholder={placeholder} invalid={invalid} />;
}

export function useCurrency() {
  const trpc = useTRPC();
  const t = useQuery(trpc.captable.get.queryOptions({ view: 'fully_diluted' }));
  return t.data?.currency ?? 'EUR';
}
