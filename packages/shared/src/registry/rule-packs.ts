import type { HolderDetails, TransactionType } from '../schemas/registry.ts';
import { isLei, isSwedishOrgNumber, isSwedishPersonalNumber } from './ids.ts';

export interface Violation {
  /** Stable rule name, e.g. `PLEDGED_SHARES`. */
  rule: string;
  message: string;
  severity: 'error' | 'warning';
  /** The transaction the problem arose at, when known. */
  transactionId?: string;
}

export type WizardStepKey =
  | 'details'
  | 'parties'
  | 'shares'
  | 'restrictions'
  | 'settlement'
  | 'decision'
  | 'subscription'
  | 'payment'
  | 'registration'
  | 'documents'
  | 'review';

export interface WizardStep {
  key: WizardStepKey;
  label: string;
  /** The status a transaction parked at this step gets. */
  waitStatus?: 'awaiting_decision' | 'awaiting_registration';
}

export interface RegistrySettingsView {
  country: string;
  legalForm: string;
  rulePack: RulePackId;
  nationalNumber: string;
  euid: string;
  lei: string;
  numbering: boolean;
  capitalMode: 'quota' | 'nominal';
  minShareCapital: bigint | null;
  maxShareCapital: bigint | null;
  minShares: bigint | null;
  maxShares: bigint | null;
}

export const RULE_PACK_IDS = ['eu-base', 'se-abl'] as const;
export type RulePackId = (typeof RULE_PACK_IDS)[number];

export interface RulePack {
  id: RulePackId;
  version: string;
  label: string;
  summary: string;
  /** False for the generic pack: the UI says no country-specific checks run. */
  countrySpecific: boolean;
  legalForms: { code: string; label: string }[];
  defaults: { numbering: boolean; capitalMode: 'quota' | 'nominal' };
  /** What the register and its restriction clauses are called in this jurisdiction. */
  terms: {
    register: string;
    registerLocal?: string;
    consent: string;
    preEmption: string;
    firstRefusal: string;
    registrationAuthority: string;
  };
  /** New shares that are entered as interim shares until the registration authority registers them. */
  interimUntilRegistered: readonly TransactionType[];
  /** Transactions that cannot be entered before they are registered. */
  registrationRequired: readonly TransactionType[];
  steps(type: TransactionType): WizardStep[];
  checkHolder(holder: HolderDetails): Violation[];
  checkSettings(settings: RegistrySettingsView): Violation[];
  checkCapital(input: { shareCapital: bigint; totalShares: bigint; currency: string; settings: RegistrySettingsView }): Violation[];
}

const review: WizardStep = { key: 'review', label: 'Review' };
const documents: WizardStep = { key: 'documents', label: 'Documents' };

function genericSteps(type: TransactionType, registrationWaits: boolean): WizardStep[] {
  const decision: WizardStep = { key: 'decision', label: 'Decision', waitStatus: 'awaiting_decision' };
  const registration: WizardStep = {
    key: 'registration',
    label: 'Registration',
    ...(registrationWaits ? { waitStatus: 'awaiting_registration' as const } : {}),
  };
  switch (type) {
    case 'incorporation':
    case 'opening_balance':
      return [{ key: 'details', label: 'Company' }, { key: 'shares', label: 'Classes and Holdings' }, documents, review];
    case 'transfer':
      return [
        { key: 'parties', label: 'Parties' },
        { key: 'shares', label: 'Shares' },
        { key: 'restrictions', label: 'Restrictions' },
        { key: 'settlement', label: 'Price and Settlement' },
        documents,
        review,
      ];
    case 'holder_change':
      return [{ key: 'details', label: 'Holder Details' }, documents, review];
    case 'new_issue':
      return [
        decision,
        { key: 'subscription', label: 'Subscription' },
        { key: 'payment', label: 'Payment' },
        registration,
        documents,
        review,
      ];
    case 'bonus_issue':
    case 'split':
    case 'reverse_split':
      return [decision, { key: 'details', label: 'Terms' }, registration, documents, review];
    case 'registration':
      return [registration, documents, review];
    case 'class_change':
      return [decision, { key: 'details', label: 'Class Terms' }, registration, documents, review];
    case 'pledge':
      return [{ key: 'parties', label: 'Pledgee' }, { key: 'shares', label: 'Shares' }, documents, review];
    case 'pledge_release':
    case 'reversal':
      return [{ key: 'details', label: 'Details' }, documents, review];
  }
}

function sharesWithinLimits(totalShares: bigint, settings: RegistrySettingsView): Violation[] {
  const out: Violation[] = [];
  if (settings.minShares !== null && totalShares < settings.minShares)
    out.push({
      rule: 'SHARE_COUNT_LIMITS',
      severity: 'error',
      message: `The company would have ${totalShares} shares, below the articles' minimum of ${settings.minShares}`,
    });
  if (settings.maxShares !== null && totalShares > settings.maxShares)
    out.push({
      rule: 'SHARE_COUNT_LIMITS',
      severity: 'error',
      message: `The company would have ${totalShares} shares, above the articles' maximum of ${settings.maxShares}`,
    });
  return out;
}

function capitalWithinLimits(shareCapital: bigint, settings: RegistrySettingsView): Violation[] {
  const out: Violation[] = [];
  if (settings.minShareCapital !== null && shareCapital < settings.minShareCapital)
    out.push({ rule: 'SHARE_CAPITAL_LIMITS', severity: 'error', message: "The share capital would be below the articles' minimum" });
  if (settings.maxShareCapital !== null && shareCapital > settings.maxShareCapital)
    out.push({ rule: 'SHARE_CAPITAL_LIMITS', severity: 'error', message: "The share capital would be above the articles' maximum" });
  return out;
}

export const euBase: RulePack = {
  id: 'eu-base',
  version: 'eu-base@1',
  label: 'EU Private Company (Generic)',
  summary:
    'Core transactions for any private limited company in the EU. Share numbers optional, counts or nominal amounts, generic beneficial-owner report. No country-specific checks run.',
  countrySpecific: false,
  legalForms: [{ code: 'private', label: 'Private Limited Company' }],
  defaults: { numbering: true, capitalMode: 'nominal' },
  terms: {
    register: 'Share Register',
    consent: 'Consent Clause',
    preEmption: 'Pre-emption Right',
    firstRefusal: 'Right of First Refusal',
    registrationAuthority: 'the business register',
  },
  interimUntilRegistered: [],
  registrationRequired: [],
  steps: (type) => genericSteps(type, false),
  checkHolder: () => [],
  checkSettings(settings) {
    if (settings.lei && !isLei(settings.lei)) return [{ rule: 'LEI', severity: 'warning', message: 'The LEI check digits do not match' }];
    return [];
  },
  checkCapital: ({ shareCapital, totalShares, settings }) => [
    ...capitalWithinLimits(shareCapital, settings),
    ...sharesWithinLimits(totalShares, settings),
  ],
};

/** In öre: 25 000 SEK for a private aktiebolag, 500 000 SEK for a public one (ABL 1:5). */
export const SE_MIN_CAPITAL_SEK = 2_500_000n;
export const SE_MIN_CAPITAL_SEK_PUBL = 50_000_000n;

export const seAbl: RulePack = {
  id: 'se-abl',
  version: 'se-abl@1',
  label: 'Swedish Aktiebolag (ABL)',
  summary:
    'Swedish aktiebolag (private or publ) under aktiebolagslagen: personnummer and organisationsnummer checks, numbered shares, interim shares until Bolagsverket registers a new issue, samtycke, förköp and hembud clauses.',
  countrySpecific: true,
  legalForms: [
    { code: 'AB', label: 'Aktiebolag (Private)' },
    { code: 'AB_PUBL', label: 'Aktiebolag (Public, publ)' },
  ],
  defaults: { numbering: true, capitalMode: 'quota' },
  terms: {
    register: 'Share Register',
    registerLocal: 'Aktiebok',
    consent: 'Consent Clause (samtyckesförbehåll)',
    preEmption: 'Pre-emption Clause (förköpsförbehåll)',
    firstRefusal: 'Post-transfer Purchase Clause (hembudsförbehåll)',
    registrationAuthority: 'Bolagsverket',
  },
  interimUntilRegistered: ['new_issue'],
  registrationRequired: ['bonus_issue', 'split', 'reverse_split', 'class_change'],
  steps: (type) => genericSteps(type, true),
  checkHolder(holder) {
    const out: Violation[] = [];
    const swedish = holder.country === 'SE' || holder.country === '';
    if (!swedish) return out;
    const id = holder.nationalId;
    if (!id) {
      if (holder.country === 'SE')
        out.push({
          rule: 'SE_NATIONAL_ID_MISSING',
          severity: 'warning',
          message: `${holder.name}: the aktiebok should state a personnummer or organisationsnummer`,
        });
      return out;
    }
    const isCompany = holder.kind === 'company';
    if (isCompany ? !isSwedishOrgNumber(id) : !isSwedishPersonalNumber(id))
      out.push({
        rule: isCompany ? 'SE_ORG_NUMBER' : 'SE_PERSONAL_NUMBER',
        severity: 'error',
        message: `${holder.name}: ${id} is not a valid ${isCompany ? 'organisationsnummer' : 'personnummer or samordningsnummer'}`,
      });
    return out;
  },
  checkSettings(settings) {
    const out: Violation[] = [];
    if (!settings.numbering)
      out.push({
        rule: 'SE_NUMBERING_OFF',
        severity: 'warning',
        message: 'Share numbering is off. A Swedish aktiebok normally lists shares by number (ABL 5:2).',
      });
    if (settings.nationalNumber && !isSwedishOrgNumber(settings.nationalNumber))
      out.push({ rule: 'SE_ORG_NUMBER', severity: 'error', message: `${settings.nationalNumber} is not a valid organisationsnummer` });
    if (settings.minShareCapital !== null && settings.maxShareCapital !== null && settings.maxShareCapital > settings.minShareCapital * 4n)
      out.push({
        rule: 'SE_CAPITAL_LIMITS_RATIO',
        severity: 'warning',
        message: "The articles' maximum share capital may be at most four times the minimum (ABL 3:1)",
      });
    if (settings.minShares !== null && settings.maxShares !== null && settings.maxShares > settings.minShares * 4n)
      out.push({
        rule: 'SE_SHARE_LIMITS_RATIO',
        severity: 'warning',
        message: "The articles' maximum number of shares may be at most four times the minimum (ABL 3:1)",
      });
    return out;
  },
  checkCapital({ shareCapital, totalShares, currency, settings }) {
    const out = [...capitalWithinLimits(shareCapital, settings), ...sharesWithinLimits(totalShares, settings)];
    const publ = settings.legalForm === 'AB_PUBL';
    if (currency === 'SEK' && shareCapital < (publ ? SE_MIN_CAPITAL_SEK_PUBL : SE_MIN_CAPITAL_SEK))
      out.push({
        rule: 'SE_MIN_SHARE_CAPITAL',
        severity: 'error',
        message: publ
          ? 'A public aktiebolag needs a share capital of at least 500 000 SEK (ABL 1:5)'
          : 'A private aktiebolag needs a share capital of at least 25 000 SEK (ABL 1:5)',
      });
    return out;
  },
};

export const RULE_PACKS: Record<RulePackId, RulePack> = { 'eu-base': euBase, 'se-abl': seAbl };

/** The rule pack for a country and legal form. Everything without its own pack uses the generic EU one. */
export function rulePackFor(country: string, legalForm: string): RulePack {
  if (country === 'SE' && (legalForm === 'AB' || legalForm === 'AB_PUBL')) return seAbl;
  return euBase;
}

export function legalFormsFor(country: string): { code: string; label: string; rulePack: RulePackId }[] {
  const generic = euBase.legalForms.map((f) => ({ ...f, rulePack: euBase.id }));
  if (country === 'SE') return [...seAbl.legalForms.map((f) => ({ ...f, rulePack: seAbl.id })), ...generic];
  return generic;
}
