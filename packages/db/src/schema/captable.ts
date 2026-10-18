import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, minorUnits, percentage, pk, pricePerShare, shareCount, updatedAt } from './columns.ts';
import { users } from './identity.ts';
import { files } from './platform.ts';

/**
 * The cap table. It reads the share register (`registry` schema) and never writes it; a promoted
 * scenario or an exercise becomes registry drafts that a person commits. What lives here is what the
 * register cannot hold: stakeholders without shares, groups, equity plans and grants, unpriced
 * instruments until they convert, valuations and scenarios.
 */
export const captable = pgSchema('captable');

export const captableSettings = captable.table(
  'settings',
  {
    id: integer().primaryKey().default(1),
    includeUnallocatedPool: boolean().notNull().default(true),
    holdersSeeFullTable: boolean().notNull().default(false),
    updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [check('captable_settings_singleton', sql`${t.id} = 1`)],
);

export const stakeholderGroups = captable.table('stakeholder_group', {
  id: pk(),
  name: text().notNull(),
  color: text().notNull().default('indigo'),
  sortOrder: integer().notNull().default(0),
  createdAt: createdAt(),
});

/**
 * Anyone on the cap table. A holder in the share register is a stakeholder with the same id; someone
 * who only has options or a SAFE gets their own id, which becomes their holder id if they later receive shares.
 */
export const stakeholders = captable.table('stakeholder', {
  id: uuid().primaryKey(),
  name: text().notNull().default(''),
  kind: text().$type<'person' | 'company' | 'estate' | 'joint'>().notNull().default('person'),
  email: text().notNull().default(''),
  country: text().notNull().default(''),
  groupId: uuid().references(() => stakeholderGroups.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const vestingSchedules = captable.table('vesting_schedule', {
  id: pk(),
  name: text().notNull(),
  cliffMonths: integer().notNull(),
  totalMonths: integer().notNull(),
  frequencyMonths: integer().notNull(),
  acceleration: text().$type<'none' | 'single' | 'double'>().notNull().default('none'),
  createdAt: createdAt(),
});

export const equityPlans = captable.table('equity_plan', {
  id: pk(),
  name: text().notNull(),
  profile: text().notNull(),
  kind: text().$type<'option' | 'warrant' | 'virtual'>().notNull(),
  classCode: text().notNull().default(''),
  approvedOn: date(),
  notes: text().notNull().default(''),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The pool's size is the sum of its changes, so every top-up and reduction keeps its date and reason. */
export const poolChanges = captable.table(
  'pool_change',
  {
    id: pk(),
    planId: uuid()
      .notNull()
      .references(() => equityPlans.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    delta: shareCount().notNull(),
    note: text().notNull().default(''),
    scenarioId: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('pool_change_plan_idx').on(t.planId, t.date)],
);

export const grants = captable.table(
  'grant',
  {
    id: pk(),
    planId: uuid()
      .notNull()
      .references(() => equityPlans.id, { onDelete: 'restrict' }),
    stakeholderId: uuid()
      .notNull()
      .references(() => stakeholders.id, { onDelete: 'restrict' }),
    units: shareCount().notNull(),
    strikePrice: pricePerShare().notNull(),
    grantDate: date().notNull(),
    vestingStart: date().notNull(),
    scheduleId: uuid().references(() => vestingSchedules.id, { onDelete: 'restrict' }),
    terminatedOn: date(),
    leaver: text().$type<'good' | 'bad'>(),
    notes: text().notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('grant_plan_idx').on(t.planId), index('grant_stakeholder_idx').on(t.stakeholderId)],
);

/** An exercise counts once its registry transaction is committed and effective. */
export const exercises = captable.table(
  'exercise',
  {
    id: pk(),
    grantId: uuid()
      .notNull()
      .references(() => grants.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    units: shareCount().notNull(),
    registryTxId: uuid(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('exercise_grant_idx').on(t.grantId)],
);

export const unpricedInstruments = captable.table('unpriced_instrument', {
  id: pk(),
  stakeholderId: uuid()
    .notNull()
    .references(() => stakeholders.id, { onDelete: 'restrict' }),
  profile: text().notNull(),
  kind: text().$type<'safe' | 'note'>().notNull(),
  amount: minorUnits().notNull(),
  originalAmount: minorUnits(),
  originalCurrency: text(),
  valuationCap: minorUnits(),
  discountPct: percentage().notNull().default('0'),
  interestRatePct: percentage().notNull().default('0'),
  interest: text().$type<'simple' | 'compound'>().notNull().default('simple'),
  postMoney: boolean().notNull().default(true),
  mfn: boolean().notNull().default(false),
  signedOn: date().notNull(),
  maturityDate: date(),
  /** The registry new issue it converts in; it counts as converted once that is committed. */
  conversionTxId: uuid(),
  cancelledOn: date(),
  notes: text().notNull().default(''),
  fileId: uuid().references(() => files.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const valuations = captable.table('valuation', {
  id: pk(),
  date: date().notNull(),
  pricePerShare: pricePerShare().notNull(),
  source: text().$type<'internal' | 'external' | 'fair_value'>().notNull(),
  method: text().notNull().default(''),
  notes: text().notNull().default(''),
  inputs: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  fileId: uuid().references(() => files.id, { onDelete: 'set null' }),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const scenarios = captable.table(
  'scenario',
  {
    id: pk(),
    name: text().notNull(),
    description: text().notNull().default(''),
    baseDate: date().notNull(),
    /** The register's last committed sequence number when the scenario was based; promote refuses if it moved. */
    baseSeq: integer().notNull().default(0),
    steps: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
    status: text().$type<'draft' | 'promoted' | 'archived'>().notNull().default('draft'),
    sharedWith: jsonb().$type<string[]>().notNull().default([]),
    promotedTxIds: jsonb().$type<string[]>().notNull().default([]),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('scenario_created_by_idx').on(t.createdBy)],
);
