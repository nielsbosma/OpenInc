import { z } from 'zod';
import { pagination } from './common.ts';

/**
 * Share counts, amounts and prices travel as strings (or safe integers) so the same schemas work
 * over tRPC, MCP, the assistant and in stored payloads. The ledger engine turns them into bigints.
 */
export const integerString = z.union([z.number().int().nonnegative(), z.string().trim().regex(/^\d+$/, 'Enter a whole number')]);
export const positiveIntegerString = z.union([
  z.number().int().positive(),
  z
    .string()
    .trim()
    .regex(/^0*[1-9]\d*$/, 'Enter a whole number greater than zero'),
]);
export const decimalString = z.union([
  z.number().nonnegative(),
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, 'Enter a number'),
]);
export const isoDate = z.iso.date('Use the format YYYY-MM-DD');

export const HOLDER_KINDS = ['person', 'company', 'estate', 'joint'] as const;
export type HolderKind = (typeof HOLDER_KINDS)[number];

export const holderMember = z.object({
  name: z.string().trim().min(1).max(300),
  nationalId: z.string().trim().max(60).default(''),
});

export const holderDetails = z.object({
  holderId: z.uuid(),
  kind: z.enum(HOLDER_KINDS),
  name: z.string().trim().min(1, 'Enter a name').max(300),
  nationalId: z.string().trim().max(60).default(''),
  country: z.string().trim().toUpperCase().max(2).default(''),
  address: z.string().trim().max(500).default(''),
  email: z.string().trim().max(254).default(''),
  /** Joint holders, or the estate's heirs and representative. */
  members: z.array(holderMember).max(50).default([]),
});
export type HolderDetails = z.output<typeof holderDetails>;

export const restrictions = z.object({
  consent: z.boolean().default(false),
  preEmption: z.boolean().default(false),
  firstRefusal: z.boolean().default(false),
});
export type Restrictions = z.output<typeof restrictions>;

export const PARTICIPATION = ['none', 'full', 'capped'] as const;
export type Participation = (typeof PARTICIPATION)[number];
export const ANTI_DILUTION = ['none', 'broad_weighted_average', 'narrow_weighted_average', 'full_ratchet'] as const;
export type AntiDilution = (typeof ANTI_DILUTION)[number];

export const PARTICIPATION_LABELS: Record<Participation, string> = {
  none: 'Non-participating',
  full: 'Fully Participating',
  capped: 'Participating up to a Cap',
};
export const ANTI_DILUTION_LABELS: Record<AntiDilution, string> = {
  none: 'None',
  broad_weighted_average: 'Broad-Based Weighted Average',
  narrow_weighted_average: 'Narrow-Based Weighted Average',
  full_ratchet: 'Full Ratchet',
};

/**
 * The economic terms an exit waterfall reads. Higher seniority is paid first; equal ranks share pari passu.
 * The multiple is of the original issue price (0 for common shares); the cap is a multiple too.
 */
export const classEconomics = {
  seniorityRank: z.number().int().min(0).max(1000).default(0),
  liqPrefMultiple: decimalString.default('1'),
  liqPrefCapMultiple: decimalString.nullable().default(null),
  participation: z.enum(PARTICIPATION).default('none'),
  antiDilution: z.enum(ANTI_DILUTION).default('none'),
};

export const shareClassDef = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a class code')
    .max(20)
    .regex(/^[A-Za-z0-9 _-]+$/, 'Use letters, digits, spaces, - or _'),
  name: z.string().trim().max(100).default(''),
  votesPerShare: decimalString.default('1'),
  /** Major currency units per share. Only in nominal-value mode. */
  nominalPerShare: decimalString.nullable().default(null),
  dividendTerms: z.record(z.string(), z.unknown()).default({}),
  liquidationTerms: z.record(z.string(), z.unknown()).default({}),
  conversionClause: z.string().max(4000).default(''),
  redemptionClause: z.string().max(4000).default(''),
  restrictions: restrictions.default({ consent: false, preEmption: false, firstRefusal: false }),
  ...classEconomics,
});
export type ShareClassDef = z.output<typeof shareClassDef>;

export const shareRange = z.object({ from: positiveIntegerString, to: positiveIntegerString });

/** Shares of one class. With numbering on, `ranges` names the share numbers (picked lowest-first when left out). */
export const shareLine = z.object({
  classCode: z.string().trim().min(1),
  count: positiveIntegerString,
  ranges: z.array(shareRange).max(500).optional(),
});

const base = {
  effectiveDate: isoDate,
  decisionDate: isoDate.nullable().default(null),
  registrationDate: isoDate.nullable().default(null),
  note: z.string().max(4000).default(''),
  /** Details for holders that are new or changed by this transaction. */
  holders: z.array(holderDetails).max(1000).default([]),
};

export const incorporationTx = z.object({
  type: z.literal('incorporation'),
  ...base,
  shareCapital: integerString,
  classes: z.array(shareClassDef).min(1).max(20),
  allocations: z
    .array(
      z.object({
        holderId: z.uuid(),
        classCode: z.string().trim().min(1),
        count: positiveIntegerString,
        pricePerShare: decimalString.optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const openingBalanceTx = z.object({
  type: z.literal('opening_balance'),
  ...base,
  shareCapital: integerString,
  classes: z.array(shareClassDef).min(1).max(20),
  lots: z
    .array(
      z.object({
        holderId: z.uuid(),
        classCode: z.string().trim().min(1),
        count: positiveIntegerString,
        ranges: z.array(shareRange).max(500).optional(),
        interim: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(5000),
  pledges: z
    .array(
      z.object({
        holderId: z.uuid(),
        classCode: z.string().trim().min(1),
        count: positiveIntegerString,
        ranges: z.array(shareRange).max(500).optional(),
        pledgee: z.object({
          name: z.string().trim().min(1).max(300),
          nationalId: z.string().trim().max(60).default(''),
          address: z.string().max(500).default(''),
        }),
      }),
    )
    .max(500)
    .default([]),
});

export const TRANSFER_KINDS = ['sale', 'gift', 'inheritance', 'division_of_property', 'will', 'other'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const STEP_OUTCOMES = ['not_exercised', 'waived', 'exercised'] as const;

export const restrictionSteps = z.object({
  consent: z.object({ obtained: z.boolean(), date: isoDate.nullable().default(null), note: z.string().max(1000).default('') }).optional(),
  preEmption: z
    .object({ outcome: z.enum(STEP_OUTCOMES), date: isoDate.nullable().default(null), note: z.string().max(1000).default('') })
    .optional(),
  firstRefusal: z
    .object({ outcome: z.enum(STEP_OUTCOMES), date: isoDate.nullable().default(null), note: z.string().max(1000).default('') })
    .optional(),
});

export const transferTx = z.object({
  type: z.literal('transfer'),
  ...base,
  kind: z.enum(TRANSFER_KINDS),
  fromHolderId: z.uuid(),
  toHolderId: z.uuid(),
  lines: z.array(shareLine).min(1).max(20),
  /** Major currency units per share, for sales. */
  pricePerShare: decimalString.optional(),
  settlement: z
    .object({
      date: isoDate.nullable().default(null),
      reference: z.string().max(200).default(''),
      terms: z.string().max(4000).default(''),
    })
    .optional(),
  restrictionSteps: restrictionSteps.default({}),
});

export const holderChangeTx = z.object({
  type: z.literal('holder_change'),
  ...base,
  holders: z.array(holderDetails).min(1).max(1000),
});

export const ISSUE_FORMS = ['cash', 'set_off', 'in_kind'] as const;
export const ISSUE_ALLOCATIONS = ['directed', 'pro_rata'] as const;

export const newIssueTx = z.object({
  type: z.literal('new_issue'),
  ...base,
  form: z.enum(ISSUE_FORMS),
  allocation: z.enum(ISSUE_ALLOCATIONS),
  classCode: z.string().trim().min(1),
  pricePerShare: decimalString,
  /** Minor units. Left out: the new shares times the current quota or nominal value. */
  capitalIncrease: integerString.optional(),
  subscriptionDate: isoDate.nullable().default(null),
  paymentDate: isoDate.nullable().default(null),
  inKindDescription: z.string().max(4000).default(''),
  subscriptions: z
    .array(z.object({ holderId: z.uuid(), count: positiveIntegerString, paidOn: isoDate.nullable().default(null) }))
    .min(1)
    .max(1000),
});

export const registrationTx = z.object({
  type: z.literal('registration'),
  ...base,
  registrationDate: isoDate,
  ofTransactionId: z.uuid(),
});

export const ROUNDING = ['down', 'nearest', 'up'] as const;

export const bonusIssueTx = z.object({
  type: z.literal('bonus_issue'),
  ...base,
  mode: z.enum(['new_shares', 'quota_value']),
  capitalIncrease: integerString,
  /** New shares per held shares, e.g. 1 new per 4 held. Only for new shares. */
  ratio: z.object({ newShares: positiveIntegerString, perShares: positiveIntegerString }).optional(),
  /** Class of the new shares. Left out: the same class as the shares they are based on. */
  classCode: z.string().trim().min(1).optional(),
  rounding: z.enum(ROUNDING).default('down'),
});

export const splitTx = z.object({
  type: z.literal('split'),
  ...base,
  ratio: z.number().int().min(2).max(1_000_000),
});

export const FRACTION_HANDLING = ['round', 'buy_out', 'pool'] as const;

export const reverseSplitTx = z.object({
  type: z.literal('reverse_split'),
  ...base,
  ratio: z.number().int().min(2).max(1_000_000),
  fractions: z.enum(FRACTION_HANDLING),
  rounding: z.enum(ROUNDING).default('down'),
  buyOutPricePerShare: decimalString.optional(),
  poolHolderId: z.uuid().optional(),
});

export const pledgeTx = z.object({
  type: z.literal('pledge'),
  ...base,
  holderId: z.uuid(),
  lines: z.array(shareLine).min(1).max(20),
  pledgee: z.object({
    name: z.string().trim().min(1).max(300),
    nationalId: z.string().trim().max(60).default(''),
    address: z.string().max(500).default(''),
  }),
  terms: z.string().max(4000).default(''),
});

export const pledgeReleaseTx = z.object({
  type: z.literal('pledge_release'),
  ...base,
  /** The pledge transaction's id, or one pledge from an opening balance. */
  pledgeId: z.string().trim().min(1).max(100),
});

/**
 * Creates share classes or changes the terms of existing ones (an amendment of the articles). Rights
 * attached to shares that are already issued only change this way, so the history shows when.
 */
export const classChangeTx = z.object({
  type: z.literal('class_change'),
  ...base,
  classes: z.array(shareClassDef).min(1).max(20),
});

export const reversalTx = z.object({
  type: z.literal('reversal'),
  ...base,
  reversesId: z.uuid(),
  reason: z.string().trim().min(1, 'Say why it is reversed').max(2000),
});

export const registryTransaction = z.discriminatedUnion('type', [
  incorporationTx,
  openingBalanceTx,
  transferTx,
  holderChangeTx,
  newIssueTx,
  registrationTx,
  bonusIssueTx,
  splitTx,
  reverseSplitTx,
  pledgeTx,
  pledgeReleaseTx,
  classChangeTx,
  reversalTx,
]);
export type RegistryTransaction = z.output<typeof registryTransaction>;
export type RegistryTransactionInput = z.input<typeof registryTransaction>;
export type TransactionType = RegistryTransaction['type'];

export const TRANSACTION_TYPES = [
  'incorporation',
  'opening_balance',
  'transfer',
  'holder_change',
  'new_issue',
  'registration',
  'bonus_issue',
  'split',
  'reverse_split',
  'pledge',
  'pledge_release',
  'class_change',
  'reversal',
] as const satisfies readonly TransactionType[];

export const TRANSACTION_LABELS: Record<TransactionType, string> = {
  incorporation: 'Incorporation',
  opening_balance: 'Opening Balance',
  transfer: 'Transfer',
  holder_change: 'Holder Details Change',
  new_issue: 'New Issue',
  registration: 'Registration',
  bonus_issue: 'Bonus Issue',
  split: 'Split',
  reverse_split: 'Reverse Split',
  pledge: 'Pledge',
  pledge_release: 'Pledge Release',
  class_change: 'Class Terms Change',
  reversal: 'Reversal',
};

export const TX_STATUSES = ['draft', 'awaiting_decision', 'awaiting_registration', 'committed', 'reversed'] as const;
export type TxStatus = (typeof TX_STATUSES)[number];

export const TX_STATUS_LABELS: Record<TxStatus, string> = {
  draft: 'Draft',
  awaiting_decision: 'Awaiting Decision',
  awaiting_registration: 'Awaiting Registration',
  committed: 'Committed',
  reversed: 'Reversed',
};

export const TX_DOCUMENT_KINDS = [
  'decision',
  'minutes',
  'subscription_list',
  'payment_proof',
  'registration_certificate',
  'agreement',
  'consent',
  'other',
] as const;

export const CAPITAL_MODES = ['quota', 'nominal'] as const;

export const registrySetupInput = z.object({
  country: z.string().trim().toUpperCase().length(2, 'Pick a country'),
  legalForm: z.string().trim().min(1, 'Pick a legal form').max(40),
  nationalNumber: z.string().trim().max(60).default(''),
  euid: z.string().trim().max(60).default(''),
  lei: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z0-9]{18}\d{2})?$/, 'An LEI is 20 characters')
    .default(''),
  numbering: z.boolean().optional(),
  capitalMode: z.enum(CAPITAL_MODES).default('quota'),
  minShareCapital: integerString.nullable().default(null),
  maxShareCapital: integerString.nullable().default(null),
  minShares: integerString.nullable().default(null),
  maxShares: integerString.nullable().default(null),
  fourEyes: z.boolean().default(false),
  drafterCanCommit: z.boolean().default(false),
  commitOverMcp: z.boolean().default(false),
  tokenizeImportIds: z.boolean().default(true),
});
export type RegistrySetupInput = z.input<typeof registrySetupInput>;

export const asOfInput = z.object({
  /** Calendar date; left out means today. */
  asOf: isoDate.optional(),
  /** Only what had been entered by this moment (ISO timestamp): "what did the register say then". */
  knownAt: z.iso.datetime({ offset: true }).optional(),
});

export const holderIdInput = z.object({ holderId: z.uuid(), asOf: isoDate.optional() });
export const transactionIdInput = z.object({ transactionId: z.uuid() });

export const listTransactionsInput = pagination.extend({
  status: z.enum(TX_STATUSES).optional(),
  type: z.enum(TRANSACTION_TYPES).optional(),
  holderId: z.uuid().optional(),
  includeDrafts: z.boolean().default(true),
});

/** Set when another module prepares the draft, e.g. the cap table's Promote. Shown in the wizard and the ledger. */
export const draftOrigin = z.object({
  module: z.string().trim().min(1).max(40),
  reference: z.string().trim().max(200).default(''),
  label: z.string().trim().max(200).default(''),
});

export const draftTransactionInput = z.object({
  transaction: registryTransaction,
  summary: z.string().trim().max(300).optional(),
  origin: draftOrigin.optional(),
});

export const updateDraftInput = draftTransactionInput.extend({ transactionId: z.uuid() });

export const parkTransactionInput = z.object({
  transactionId: z.uuid(),
  status: z.enum(['draft', 'awaiting_decision', 'awaiting_registration']),
});

export const validateTransactionInput = z
  .object({
    transaction: registryTransaction.optional(),
    /** A saved draft: validated as stored, or replaced by `transaction` when both are given. */
    transactionId: z.uuid().optional(),
  })
  .refine((v) => v.transaction || v.transactionId, 'Give a transaction or a transactionId');

export const attachDocumentInput = z.object({
  transactionId: z.uuid(),
  fileId: z.uuid(),
  kind: z.enum(TX_DOCUMENT_KINDS),
});

export const reverseTransactionInput = z.object({
  transactionId: z.uuid(),
  reason: z.string().trim().min(1, 'Say why it is reversed').max(2000),
  effectiveDate: isoDate.optional(),
});

export const searchHoldersInput = z.object({ search: z.string().trim().max(200).default('') });

/** Where in the uploaded file a value came from: a spreadsheet cell, or a PDF page and line. */
export const importSource = z.object({
  sheet: z.string().nullable(),
  cell: z.string().nullable(),
  page: z.number().int().nullable(),
  line: z.number().int().nullable(),
});
export type ImportSource = z.output<typeof importSource>;

const sourced = { source: importSource, confidence: z.number().min(0).max(1) };

/**
 * What the AI import asks the model for. Every field is required (null when unknown) so the same
 * schema works with every provider's structured output. Values stay strings until validation.
 */
export const importExtraction = z.object({
  company: z.object({
    name: z.string().nullable(),
    nationalNumber: z.string().nullable(),
    shareCapital: z.string().nullable(),
    currency: z.string().nullable(),
    asOfDate: z.string().nullable(),
    ...sourced,
  }),
  classes: z.array(z.object({ code: z.string(), votesPerShare: z.string(), ...sourced })),
  holders: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(HOLDER_KINDS),
      name: z.string(),
      nationalId: z.string(),
      country: z.string(),
      address: z.string(),
      ...sourced,
    }),
  ),
  mode: z.enum(['snapshot', 'history']),
  holdings: z.array(z.object({ holderRef: z.string(), classCode: z.string(), count: z.string(), shareNumbers: z.string(), ...sourced })),
  events: z.array(
    z.object({
      date: z.string(),
      type: z.enum(['incorporation', 'new_issue', 'transfer', 'split', 'other']),
      fromRef: z.string().nullable(),
      toRef: z.string().nullable(),
      classCode: z.string(),
      count: z.string(),
      shareNumbers: z.string(),
      pricePerShare: z.string().nullable(),
      ratio: z.number().nullable(),
      description: z.string(),
      ...sourced,
    }),
  ),
  notes: z.array(z.string()),
});
export type ImportExtraction = z.output<typeof importExtraction>;

export const IMPORT_TYPES = /\.(xlsx|xls|csv|pdf)$/i;

export const startImportInput = z.object({ fileId: z.uuid() });
export const importIdInput = z.object({ importId: z.uuid() });
export const updateImportInput = z.object({ importId: z.uuid(), extraction: importExtraction });
