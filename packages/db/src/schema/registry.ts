import { sql } from 'drizzle-orm';
import { bigint, bigserial, boolean, check, date, index, integer, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, minorUnits, pk, pricePerShare, shareCount, timestamptz, updatedAt } from './columns.ts';
import { users } from './identity.ts';
import { files } from './platform.ts';

/**
 * The shareholder registry. `transaction` is the only source of truth: committed rows are immutable
 * (a trigger enforces it) and hash-chained. Classes, holder versions, movements, lots and
 * encumbrances are a cache rebuilt by replaying committed transactions.
 */
export const registry = pgSchema('registry');

export const registrySettings = registry.table(
  'settings',
  {
    id: integer().primaryKey().default(1),
    country: text().notNull(),
    legalForm: text().notNull(),
    rulePack: text().notNull(),
    nationalNumber: text().notNull().default(''),
    euid: text().notNull().default(''),
    lei: text().notNull().default(''),
    numbering: boolean().notNull().default(true),
    capitalMode: text().$type<'quota' | 'nominal'>().notNull().default('quota'),
    minShareCapital: minorUnits(),
    maxShareCapital: minorUnits(),
    minShares: shareCount(),
    maxShares: shareCount(),
    fourEyes: boolean().notNull().default(false),
    drafterCanCommit: boolean().notNull().default(false),
    tokenizeImportIds: boolean().notNull().default(true),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('settings_singleton', sql`${t.id} = 1`)],
);

export const registryTransactions = registry.table(
  'transaction',
  {
    id: pk(),
    /** Commit order, gapless from 1. Null while not committed. */
    seq: bigint({ mode: 'number' }),
    type: text().notNull(),
    status: text().$type<'draft' | 'awaiting_decision' | 'awaiting_registration' | 'committed' | 'reversed'>().notNull().default('draft'),
    decisionDate: date(),
    effectiveDate: date().notNull(),
    registrationDate: date(),
    /** When it was entered in the register (committed). */
    enteredAt: timestamptz(),
    reversesId: uuid(),
    rulePackVersion: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    summary: text().notNull().default(''),
    note: text().notNull().default(''),
    /** Another module that prepared this draft, e.g. the cap table, and its own reference. */
    origin: jsonb().$type<{ module: string; reference: string; label: string }>(),
    prevHash: text(),
    hash: text(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    submittedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamptz(),
    committedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    approvedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('transaction_seq_unique').on(t.seq),
    uniqueIndex('transaction_reverses_unique').on(t.reversesId),
    index('transaction_effective_idx').on(t.effectiveDate, t.seq),
    index('transaction_status_idx').on(t.status),
  ],
);

export const shareClasses = registry.table('share_class', {
  code: text().primaryKey(),
  name: text().notNull().default(''),
  votesPerShare: pricePerShare().notNull(),
  nominalPerShare: pricePerShare(),
  dividendTerms: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  liquidationTerms: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  conversionClause: text().notNull().default(''),
  redemptionClause: text().notNull().default(''),
  restrictions: jsonb().$type<{ consent: boolean; preEmption: boolean; firstRefusal: boolean }>().notNull(),
  /** Higher is paid first in a liquidation or exit; equal ranks are pari passu. */
  seniorityRank: integer().notNull().default(0),
  liqPrefMultiple: pricePerShare().notNull().default('1'),
  liqPrefCapMultiple: pricePerShare(),
  participation: text().$type<'none' | 'full' | 'capped'>().notNull().default('none'),
  antiDilution: text().$type<'none' | 'broad_weighted_average' | 'narrow_weighted_average' | 'full_ratchet'>().notNull().default('none'),
  issued: shareCount().notNull(),
  validFromTx: uuid().notNull(),
});

export const holders = registry.table('holder', {
  id: pk(),
  createdAt: createdAt(),
});

export const holderVersions = registry.table(
  'holder_version',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    holderId: uuid()
      .notNull()
      .references(() => holders.id),
    txId: uuid().notNull(),
    validFrom: date().notNull(),
    validTo: date(),
    kind: text().$type<'person' | 'company' | 'estate' | 'joint'>().notNull(),
    name: text().notNull(),
    nationalId: text().notNull().default(''),
    country: text().notNull().default(''),
    address: text().notNull().default(''),
    email: text().notNull().default(''),
    members: jsonb().$type<{ name: string; nationalId: string }[]>().notNull().default([]),
  },
  (t) => [index('holder_version_holder_idx').on(t.holderId, t.validFrom)],
);

/** Options, warrants and convertibles arrive in phase 2. */
export const instruments = registry.table('instrument', {
  id: pk(),
  kind: text().notNull(),
  name: text().notNull(),
  terms: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const movements = registry.table(
  'movement',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    txId: uuid().notNull(),
    classCode: text().notNull(),
    fromHolderId: uuid(),
    toHolderId: uuid(),
    count: shareCount().notNull(),
    rangeFrom: shareCount(),
    rangeTo: shareCount(),
    nominalAmount: minorUnits(),
    pricePerShare: pricePerShare(),
    consideration: minorUnits(),
  },
  (t) => [index('movement_tx_idx').on(t.txId)],
);

export const lots = registry.table(
  'lot',
  {
    key: text().primaryKey(),
    holderId: uuid().notNull(),
    classCode: text().notNull(),
    count: shareCount().notNull(),
    rangeFrom: shareCount(),
    rangeTo: shareCount(),
    nominalPerShare: pricePerShare(),
    interim: boolean().notNull().default(false),
    certificateId: uuid(),
    validFromTx: uuid().notNull(),
    validToTx: uuid(),
    validFromDate: date().notNull(),
    validToDate: date(),
  },
  (t) => [index('lot_holder_idx').on(t.holderId), index('lot_valid_idx').on(t.validFromDate, t.validToDate)],
);

export const encumbrances = registry.table('encumbrance', {
  id: text().primaryKey(),
  holderId: uuid().notNull(),
  classCode: text().notNull(),
  count: shareCount().notNull(),
  ranges: jsonb().$type<{ from: string; to: string }[]>().notNull().default([]),
  pledgee: jsonb().$type<{ name: string; nationalId: string; address: string }>().notNull(),
  validFromTx: uuid().notNull(),
  validToTx: uuid(),
  validFromDate: date().notNull(),
  validToDate: date(),
});

/** Share certificates arrive in phase 2. */
export const certificates = registry.table('certificate', {
  id: pk(),
  number: text().notNull(),
  holderId: uuid().notNull(),
  classCode: text().notNull(),
  rangeFrom: shareCount(),
  rangeTo: shareCount(),
  issuedOn: date(),
  cancelledOn: date(),
  createdAt: createdAt(),
});

export const txDocuments = registry.table(
  'tx_document',
  {
    id: pk(),
    txId: uuid()
      .notNull()
      .references(() => registryTransactions.id),
    fileId: uuid()
      .notNull()
      .references(() => files.id),
    storageKey: text().notNull(),
    kind: text().notNull(),
    name: text().notNull(),
    sha256: text().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('tx_document_tx_idx').on(t.txId)],
);

export const chainVerifications = registry.table('chain_verification', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  ranAt: timestamptz().notNull().defaultNow(),
  ok: boolean().notNull(),
  checked: integer().notNull(),
  brokenAtSeq: bigint({ mode: 'number' }),
  message: text().notNull().default(''),
});

export const registryImports = registry.table('import', {
  id: pk(),
  fileId: uuid()
    .notNull()
    .references(() => files.id),
  status: text().$type<'extracting' | 'review' | 'committed' | 'failed' | 'discarded'>().notNull().default('extracting'),
  source: jsonb().$type<Record<string, unknown>>(),
  result: jsonb().$type<Record<string, unknown>>(),
  error: text(),
  draftTxIds: jsonb().$type<string[]>().notNull().default([]),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
