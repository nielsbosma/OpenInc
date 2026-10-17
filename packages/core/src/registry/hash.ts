import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with sorted keys and bigints as strings, so equal content always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface HashedFields {
  id: string;
  seq: number;
  type: string;
  decisionDate: string | null;
  effectiveDate: string;
  registrationDate: string | null;
  enteredAt: Date;
  reversesId: string | null;
  rulePackVersion: string | null;
  committedBy: string | null;
  payload: unknown;
}

export function transactionHash(prevHash: string, fields: HashedFields): string {
  return createHash('sha256').update(prevHash).update(canonicalJson(fields)).digest('hex');
}
