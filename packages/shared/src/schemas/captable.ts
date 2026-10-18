import { z } from 'zod';
import { PLAN_KINDS, PLAN_PROFILE_IDS, UNPRICED_PROFILE_IDS } from '../captable/profiles.ts';
import { pagination } from './common.ts';
import { ANTI_DILUTION, decimalString, HOLDER_KINDS, integerString, isoDate, PARTICIPATION, positiveIntegerString } from './registry.ts';

/**
 * The cap table reads the share register and never writes it. What it owns: stakeholders and groups,
 * equity plans with grants and vesting, unpriced instruments (SAFEs, convertible loans) until they
 * convert, valuations and scenarios. Money is integer minor units as strings, like the register.
 */

const signedIntegerString = z.union([
  z.number().int(),
  z
    .string()
    .trim()
    .regex(/^-?\d+$/, 'Enter a whole number'),
]);
const percentString = z.union([
  z.number().min(0).max(100),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Enter a percentage')
    .refine((v) => Number(v) <= 100, 'At most 100'),
]);

export const captableAsOfInput = z.object({
  asOf: isoDate.optional(),
  /** Fully diluted (default) or only issued shares. */
  view: z.enum(['fully_diluted', 'issued']).default('fully_diluted'),
});

export const captableSettingsInput = z.object({
  includeUnallocatedPool: z.boolean().default(true),
  /** Shareholders see the whole cap table, not only their own position. */
  holdersSeeFullTable: z.boolean().default(false),
});
export type CaptableSettingsInput = z.input<typeof captableSettingsInput>;

export const GROUP_COLORS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'slate', 'teal'] as const;

export const groupInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Enter a name').max(80),
  color: z.enum(GROUP_COLORS).default('indigo'),
});

export const idInput = z.object({ id: z.uuid() });

export const stakeholderInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Enter a name').max(300),
  kind: z.enum(HOLDER_KINDS).default('person'),
  email: z.string().trim().max(254).default(''),
  country: z.string().trim().toUpperCase().max(2).default(''),
  groupId: z.uuid().nullable().default(null),
});

/** Puts a holder from the share register (or a cap table stakeholder) in a group. */
export const assignGroupInput = z.object({ stakeholderId: z.uuid(), groupId: z.uuid().nullable() });

export const ACCELERATION = ['none', 'single', 'double'] as const;
export const ACCELERATION_LABELS: Record<(typeof ACCELERATION)[number], string> = {
  none: 'None',
  single: 'Single Trigger',
  double: 'Double Trigger',
};

export const vestingScheduleInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, 'Enter a name').max(80),
    cliffMonths: z.number().int().min(0).max(120).default(12),
    totalMonths: z.number().int().min(1).max(240).default(48),
    frequencyMonths: z.number().int().min(1).max(12).default(1),
    acceleration: z.enum(ACCELERATION).default('none'),
  })
  .refine((v) => v.cliffMonths <= v.totalMonths, { message: 'The cliff cannot be longer than the vesting', path: ['cliffMonths'] });

export const planInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Enter a name').max(120),
  profile: z.enum(PLAN_PROFILE_IDS).default('options'),
  kind: z.enum(PLAN_KINDS).default('option'),
  /** The share class an exercise delivers. */
  classCode: z.string().trim().max(20).default(''),
  /** Size of the pool when the plan is created; later changes are pool changes. */
  poolSize: integerString,
  approvedOn: isoDate.nullable().default(null),
  notes: z.string().max(4000).default(''),
});

export const poolChangeInput = z.object({
  planId: z.uuid(),
  delta: signedIntegerString,
  date: isoDate,
  note: z.string().max(1000).default(''),
});

export const grantInput = z.object({
  id: z.uuid().optional(),
  planId: z.uuid(),
  stakeholderId: z.uuid(),
  units: positiveIntegerString,
  /** Major currency units per share. Zero for free shares; the base price for virtual shares. */
  strikePrice: decimalString.default('0'),
  grantDate: isoDate,
  vestingStart: isoDate,
  scheduleId: z.uuid().nullable().default(null),
  notes: z.string().max(4000).default(''),
});

export const LEAVER = ['good', 'bad'] as const;

export const terminateGrantInput = z.object({
  grantId: z.uuid(),
  date: isoDate,
  /** A good leaver keeps what has vested; a bad leaver forfeits everything not yet exercised. */
  leaver: z.enum(LEAVER).default('good'),
});

export const exerciseGrantInput = z.object({
  grantId: z.uuid(),
  units: positiveIntegerString,
  date: isoDate,
});

export const INTEREST = ['simple', 'compound'] as const;

export const unpricedInput = z.object({
  id: z.uuid().optional(),
  stakeholderId: z.uuid(),
  profile: z.enum(UNPRICED_PROFILE_IDS).default('safe_post'),
  /** Minor units, in the company's currency. */
  amount: positiveIntegerString,
  /** Set when the money came in another currency: the original amount and currency, converted on signing. */
  originalAmount: integerString.nullable().default(null),
  originalCurrency: z.string().trim().toUpperCase().length(3).nullable().default(null),
  /** Minor units. Null for no cap. */
  valuationCap: integerString.nullable().default(null),
  discountPct: percentString.default('0'),
  interestRatePct: percentString.default('0'),
  interest: z.enum(INTEREST).default('simple'),
  postMoney: z.boolean().default(true),
  mfn: z.boolean().default(false),
  signedOn: isoDate,
  maturityDate: isoDate.nullable().default(null),
  notes: z.string().max(4000).default(''),
  fileId: z.uuid().nullable().default(null),
});

export const VALUATION_SOURCES = ['internal', 'external', 'fair_value'] as const;
export const VALUATION_SOURCE_LABELS: Record<(typeof VALUATION_SOURCES)[number] | 'round', string> = {
  round: 'Priced Round',
  internal: 'Internal',
  external: 'External Report',
  fair_value: 'Fair Value Helper',
};

export const valuationInput = z.object({
  id: z.uuid().optional(),
  date: isoDate,
  pricePerShare: decimalString,
  source: z.enum(VALUATION_SOURCES).default('internal'),
  method: z.string().trim().max(200).default(''),
  notes: z.string().max(4000).default(''),
  inputs: z.record(z.string(), z.unknown()).default({}),
  fileId: z.uuid().nullable().default(null),
});

/** Black-Scholes inputs for an incentive instrument's market value. */
export const fairValueInput = z.object({
  sharePrice: decimalString,
  strikePrice: decimalString,
  years: z.union([
    z.number().positive().max(30),
    z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/),
  ]),
  volatilityPct: percentString,
  riskFreePct: percentString.default('0'),
  dividendPct: percentString.default('0'),
  /** Save the result in the valuation log on this date. */
  saveOn: isoDate.optional(),
});

const newInvestor = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(300),
  kind: z.enum(HOLDER_KINDS).default('company'),
  country: z.string().trim().toUpperCase().max(2).default(''),
  email: z.string().trim().max(254).default(''),
});

const investment = z
  .object({
    stakeholderId: z.uuid().optional(),
    newInvestor: newInvestor.optional(),
    /** Minor units. */
    amount: positiveIntegerString,
  })
  .refine((v) => !!v.stakeholderId !== !!v.newInvestor, 'Pick a stakeholder or name a new investor');

const pricedRoundShape = z.object({
  kind: z.literal('priced_round'),
  name: z.string().trim().min(1).max(120).default('Priced Round'),
  date: isoDate,
  /** Minor units. Give the pre-money valuation or the price per share. */
  preMoney: integerString.optional(),
  pricePerShare: decimalString.optional(),
  investments: z.array(investment).min(1).max(200),
  classCode: z.string().trim().min(1).max(20),
  className: z.string().trim().max(100).default(''),
  votesPerShare: decimalString.default('1'),
  seniorityRank: z.number().int().min(0).max(1000).default(1),
  liqPrefMultiple: decimalString.default('1'),
  liqPrefCapMultiple: decimalString.nullable().default(null),
  participation: z.enum(PARTICIPATION).default('none'),
  antiDilution: z.enum(ANTI_DILUTION).default('broad_weighted_average'),
  /** Target size of the unallocated pool after the round, as a percentage. */
  poolTargetPct: percentString.nullable().default(null),
  poolBasis: z.enum(['post', 'pre']).default('post'),
  /** The plan the pool top-up goes to. Left out: the first option plan. */
  poolPlanId: z.uuid().optional(),
  /** Unpriced instruments that convert. Left out: all outstanding ones. */
  convertIds: z.array(z.uuid()).max(500).optional(),
  /** Stakeholders whose pro rata right to keep their fully diluted percentage is shown. */
  proRataIds: z.array(z.uuid()).max(500).default([]),
});

const onePrice = (v: { preMoney?: unknown; pricePerShare?: unknown }) => (v.preMoney === undefined) !== (v.pricePerShare === undefined);
const onePriceMessage = 'Give the pre-money valuation or the price per share';

export const pricedRoundStep = pricedRoundShape.refine(onePrice, onePriceMessage);

export const poolChangeStep = z.object({
  kind: z.literal('pool_change'),
  planId: z.uuid().optional(),
  /** Units added (negative to shrink). */
  delta: signedIntegerString,
});

export const grantBatchStep = z.object({
  kind: z.literal('grant_batch'),
  planId: z.uuid().optional(),
  grants: z
    .array(
      z
        .object({
          stakeholderId: z.uuid().optional(),
          newStakeholder: newInvestor.optional(),
          units: positiveIntegerString,
          strikePrice: decimalString.default('0'),
        })
        .refine((v) => !!v.stakeholderId !== !!v.newStakeholder, 'Pick a stakeholder or name a new one'),
    )
    .min(1)
    .max(500),
});

export const secondaryStep = z.object({
  kind: z.literal('secondary'),
  fromStakeholderId: z.uuid(),
  toStakeholderId: z.uuid().optional(),
  newBuyer: newInvestor.optional(),
  classCode: z.string().trim().min(1),
  units: positiveIntegerString,
  pricePerShare: decimalString.default('0'),
});

export const exerciseStep = z.object({
  kind: z.literal('exercise'),
  /** Left out: every vested option and warrant is exercised. */
  grantIds: z.array(z.uuid()).max(1000).optional(),
});

export const UNVESTED_TREATMENT = ['accelerate', 'cancel'] as const;

export const exitStep = z.object({
  kind: z.literal('exit'),
  /** Minor units. */
  exitValue: integerString,
  transactionCosts: integerString.default('0'),
  debt: integerString.default('0'),
  unvested: z.enum(UNVESTED_TREATMENT).default('cancel'),
});

export const scenarioStep = z.discriminatedUnion('kind', [
  pricedRoundStep,
  poolChangeStep,
  grantBatchStep,
  secondaryStep,
  exerciseStep,
  exitStep,
]);
export type ScenarioStep = z.output<typeof scenarioStep>;
export type ScenarioStepInput = z.input<typeof scenarioStep>;
export type PricedRoundStep = z.output<typeof pricedRoundStep>;
export type ExitStep = z.output<typeof exitStep>;

export const SCENARIO_STEP_LABELS: Record<ScenarioStep['kind'], string> = {
  priced_round: 'Priced Round',
  pool_change: 'Pool Change',
  grant_batch: 'Grant Batch',
  secondary: 'Secondary Sale',
  exercise: 'Exercise',
  exit: 'Exit',
};

const steps = z
  .array(scenarioStep)
  .max(20)
  .refine(
    (s) => s.findIndex((x) => x.kind === 'exit') === -1 || s.findIndex((x) => x.kind === 'exit') === s.length - 1,
    'An exit must be the last step',
  );

export const scenarioInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, 'Enter a name').max(120),
  description: z.string().max(4000).default(''),
  /** The real cap table the scenario starts from. Left out: today. */
  baseDate: isoDate.optional(),
  steps,
  /** Users who may see it besides its author. */
  sharedWith: z.array(z.uuid()).max(100).default([]),
});
export type ScenarioInput = z.input<typeof scenarioInput>;

export const listScenariosInput = pagination.extend({ includeArchived: z.boolean().default(false) });

export const runScenarioInput = z.object({
  /** A saved scenario, or unsaved steps to try out. */
  scenarioId: z.uuid().optional(),
  baseDate: isoDate.optional(),
  steps: steps.optional(),
});

export const modelRoundInput = pricedRoundShape.omit({ kind: true }).extend({ asOf: isoDate.optional() }).refine(onePrice, onePriceMessage);

export const waterfallInput = exitStep.omit({ kind: true }).extend({
  asOf: isoDate.optional(),
  /** Run it on the end state of a saved scenario instead of the real cap table. */
  scenarioId: z.uuid().optional(),
  /** Also compute payouts across exit values from zero to this (minor units), for the breakpoint chart. */
  chartMax: integerString.optional(),
});

export const promoteScenarioInput = z.object({ scenarioId: z.uuid() });
export const rebaseScenarioInput = z.object({ scenarioId: z.uuid(), baseDate: isoDate.optional() });
export const compareScenariosInput = z.object({ leftId: z.uuid(), rightId: z.uuid() });
export const stakeholderDetailInput = z.object({ stakeholderId: z.uuid(), asOf: isoDate.optional() });
export const ownershipHistoryInput = z.object({ until: isoDate.optional() });
