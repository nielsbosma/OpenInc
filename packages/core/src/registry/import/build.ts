import { randomUUID } from 'node:crypto';
import {
  type HolderDetails,
  type ImportExtraction,
  type RegistryTransaction,
  type RegistryTransactionInput,
  registryTransaction,
  type Violation,
} from '@openinc/shared';
import { z } from 'zod';
import { type EngineConfig, type LedgerTx, replay } from '../engine.ts';

export interface ImportIssue {
  /** e.g. `holders.2`, `holdings.5`, `events.0`, `transactions.1`. */
  path: string;
  message: string;
  severity: 'error' | 'warning';
  rule?: string;
}

export interface BuiltImport {
  transactions: RegistryTransaction[];
  issues: ImportIssue[];
  holderIds: Record<string, string>;
}

const digits = (v: string) => v.replace(/[\s .,'’]/g, '');

/** "1 000,50" or "1,000.50" in normal units → minor units. */
export function toMinor(value: string, currencyDigits: number): string | null {
  const cleaned = value.replace(/[^\d.,-]/g, '');
  const m = /^(\d{1,3}(?:[ .,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = m[1]!.replace(/[ .,]/g, '');
  const fraction = (m[2] ?? '').padEnd(currencyDigits, '0').slice(0, currencyDigits);
  return (BigInt(whole) * 10n ** BigInt(currencyDigits) + BigInt(fraction || '0')).toString();
}

export function parseShareNumbers(text: string): { from: string; to: string }[] | null {
  if (!text.trim()) return [];
  const out: { from: string; to: string }[] = [];
  for (const part of text
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^(\d[\d\s]*)(?:\s*[-–—]\s*(\d[\d\s]*))?$/.exec(part);
    if (!m) return null;
    out.push({ from: digits(m[1]!), to: digits(m[2] ?? m[1]!) });
  }
  return out;
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  return z.iso.date().safeParse(value.trim()).success ? value.trim() : null;
}

/**
 * Turns what the model read into register transactions: one opening balance for a snapshot, or the
 * history replayed from the first event. Everything is checked by the same schemas and ledger as a
 * hand-entered transaction; nothing here trusts the model.
 */
export function buildImport(
  extraction: ImportExtraction,
  config: EngineConfig,
  opts: { existingHolders?: { holderId: string; name: string; nationalId: string }[]; committed?: LedgerTx[]; today: string },
): BuiltImport {
  const issues: ImportIssue[] = [];
  const holderIds: Record<string, string> = {};
  const holders: HolderDetails[] = [];
  extraction.holders.forEach((h, i) => {
    const match = opts.existingHolders?.find(
      (e) => (h.nationalId && e.nationalId && digits(e.nationalId) === digits(h.nationalId)) || (!h.nationalId && e.name === h.name),
    );
    const holderId = match?.holderId ?? randomUUID();
    holderIds[h.ref] = holderId;
    const details: HolderDetails = {
      holderId,
      kind: h.kind,
      name: h.name.trim(),
      nationalId: h.nationalId.trim(),
      country: (h.country || config.settings.country).trim().toUpperCase().slice(0, 2),
      address: h.address.trim(),
      email: '',
      members: [],
    };
    holders.push(details);
    for (const v of config.rulePack.checkHolder(details))
      issues.push({ path: `holders.${i}`, message: v.message, severity: v.severity, rule: v.rule });
    if (h.confidence < 0.6)
      issues.push({ path: `holders.${i}`, message: `${h.name}: the AI was not sure about this row`, severity: 'warning' });
  });

  const ref = (r: string | null, path: string) => {
    const id = r ? holderIds[r] : undefined;
    if (!id) issues.push({ path, message: `Unknown holder ${r ?? '(none)'}`, severity: 'error' });
    return id ?? '';
  };
  const classes = extraction.classes.length
    ? extraction.classes.map((c) => ({ code: c.code.trim() || 'A', votesPerShare: c.votesPerShare.replace(',', '.').trim() || '1' }))
    : [{ code: 'A', votesPerShare: '1' }];
  const shareCapital = extraction.company.shareCapital ? toMinor(extraction.company.shareCapital, config.currencyDigits) : null;
  if (!shareCapital) issues.push({ path: 'company', message: 'The share capital is missing or unreadable', severity: 'error' });
  const asOf = isoDate(extraction.company.asOfDate) ?? opts.today;

  const inputs: RegistryTransactionInput[] = [];
  if (extraction.mode === 'snapshot') {
    inputs.push({
      type: 'opening_balance',
      effectiveDate: asOf,
      note: 'Imported',
      shareCapital: shareCapital ?? '0',
      holders,
      classes,
      lots: extraction.holdings.map((h, i) => {
        const ranges = config.settings.numbering ? parseShareNumbers(h.shareNumbers) : [];
        if (ranges === null)
          issues.push({ path: `holdings.${i}`, message: `Share numbers "${h.shareNumbers}" do not read as ranges`, severity: 'error' });
        if (h.confidence < 0.6) issues.push({ path: `holdings.${i}`, message: 'The AI was not sure about this row', severity: 'warning' });
        return {
          holderId: ref(h.holderRef, `holdings.${i}`),
          classCode: h.classCode.trim() || classes[0]!.code,
          count: digits(h.count),
          ...(ranges?.length ? { ranges } : {}),
        };
      }),
    });
  } else {
    const events = [...extraction.events].sort((a, b) => a.date.localeCompare(b.date));
    const first = events[0];
    if (first?.type !== 'incorporation')
      issues.push({ path: 'events', message: 'A history must start with the incorporation', severity: 'error' });
    let pendingHolders = holders;
    for (const [i, e] of events.entries()) {
      const date = isoDate(e.date);
      const path = `events.${extraction.events.indexOf(e)}`;
      if (!date) {
        issues.push({ path, message: `"${e.date}" is not a date`, severity: 'error' });
        continue;
      }
      const ranges = config.settings.numbering ? parseShareNumbers(e.shareNumbers) : [];
      const lineRanges = ranges?.length ? { ranges } : {};
      const common = { effectiveDate: date, note: e.description.slice(0, 4000), holders: pendingHolders };
      if (e.type === 'incorporation' && i === 0) {
        const sameDay = events.filter((x) => x.type === 'incorporation' && x.date === e.date);
        inputs.push({
          ...common,
          type: 'incorporation',
          shareCapital: shareCapital ?? '0',
          classes,
          allocations: sameDay.map((x) => ({
            holderId: ref(x.toRef, path),
            classCode: x.classCode || classes[0]!.code,
            count: digits(x.count),
          })),
        });
      } else if (e.type === 'incorporation') {
        continue;
      } else if (e.type === 'new_issue') {
        inputs.push({
          ...common,
          type: 'new_issue',
          form: 'cash',
          allocation: 'directed',
          classCode: e.classCode || classes[0]!.code,
          pricePerShare: e.pricePerShare?.replace(',', '.') || '0',
          registrationDate: date,
          subscriptions: [{ holderId: ref(e.toRef, path), count: digits(e.count) }],
        });
      } else if (e.type === 'transfer') {
        inputs.push({
          ...common,
          type: 'transfer',
          kind: e.pricePerShare ? 'sale' : 'other',
          fromHolderId: ref(e.fromRef, path),
          toHolderId: ref(e.toRef, path),
          ...(e.pricePerShare ? { pricePerShare: e.pricePerShare.replace(',', '.') } : {}),
          lines: [{ classCode: e.classCode || classes[0]!.code, count: digits(e.count), ...lineRanges }],
          restrictionSteps: {
            consent: { obtained: true },
            preEmption: { outcome: 'not_exercised' },
            firstRefusal: { outcome: 'not_exercised' },
          },
        });
        issues.push({ path, message: 'Transfer restrictions are recorded as handled; check them', severity: 'warning' });
      } else if (e.type === 'split' && e.ratio && e.ratio >= 2) {
        inputs.push({ ...common, type: 'split', ratio: e.ratio, registrationDate: date });
      } else {
        issues.push({ path, message: `Not imported: ${e.description || e.type}. Enter it by hand.`, severity: 'warning' });
        continue;
      }
      pendingHolders = [];
    }
  }

  const transactions: RegistryTransaction[] = [];
  inputs.forEach((input, i) => {
    const parsed = registryTransaction.safeParse(input);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        issues.push({ path: `transactions.${i}.${issue.path.join('.')}`, message: issue.message, severity: 'error' });
    } else transactions.push(parsed.data);
  });

  if (!issues.some((i) => i.severity === 'error')) {
    const items: LedgerTx[] = [
      ...(opts.committed ?? []),
      ...transactions.map((tx, i) => ({
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        seq: Number.MAX_SAFE_INTEGER - 1000 + i,
        tx,
      })),
    ];
    const result = replay(items, config);
    if (!result.ok) {
      const index = items.indexOf(result.failedAt) - (opts.committed?.length ?? 0);
      for (const v of result.errors as Violation[])
        issues.push({ path: index >= 0 ? `transactions.${index}` : 'register', message: v.message, severity: 'error', rule: v.rule });
    } else
      for (const w of result.warnings)
        if (!issues.some((i) => i.message === w.message))
          issues.push({ path: 'register', message: w.message, severity: 'warning', rule: w.rule });
  }
  return { transactions, issues, holderIds };
}
