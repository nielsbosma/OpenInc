/**
 * Instrument profiles: the European pre-priced investments and incentive plans the cap table knows.
 * A profile is a label, the fields it uses and how it behaves; the maths is the same for all of them.
 * Labels and countries are to be checked with local counsel before they are relied on.
 */

export const UNPRICED_KINDS = ['safe', 'note'] as const;
export type UnpricedKind = (typeof UNPRICED_KINDS)[number];

export interface UnpricedProfile {
  id: string;
  label: string;
  country: string | null;
  /** A note accrues interest and has a maturity; a SAFE does not. */
  kind: UnpricedKind;
  postMoney: boolean;
  description: string;
}

export const UNPRICED_PROFILES = [
  {
    id: 'safe_post',
    label: 'SAFE (Post-Money)',
    country: null,
    kind: 'safe',
    postMoney: true,
    description: 'Simple agreement for future equity; the cap fixes ownership against the post-money capitalization.',
  },
  {
    id: 'safe_pre',
    label: 'SAFE (Pre-Money)',
    country: null,
    kind: 'safe',
    postMoney: false,
    description: 'Simple agreement for future equity; the cap is measured against the pre-money capitalization.',
  },
  {
    id: 'convertible_loan',
    label: 'Convertible Loan',
    country: null,
    kind: 'note',
    postMoney: false,
    description: 'A loan that converts into shares at the next priced round, with interest, a cap and a discount.',
  },
  {
    id: 'se_convertible_loan',
    label: 'Convertible Loan Agreement (Sweden)',
    country: 'SE',
    kind: 'note',
    postMoney: false,
    description: 'Konvertibelt lån agreed before a meeting decision; converts by set-off in a new issue.',
  },
  {
    id: 'de_wandeldarlehen',
    label: 'Wandeldarlehen (Germany)',
    country: 'DE',
    kind: 'note',
    postMoney: false,
    description: 'Convertible loan for a GmbH; converts into new Geschäftsanteile at the next round.',
  },
  {
    id: 'fr_bsa_air',
    label: 'BSA AIR (France)',
    country: 'FR',
    kind: 'safe',
    postMoney: false,
    description: "Bon de souscription d'actions - accord d'investissement rapide, the French SAFE.",
  },
  {
    id: 'uk_asa',
    label: 'Advance Subscription Agreement (UK)',
    country: 'GB',
    kind: 'safe',
    postMoney: false,
    description: 'Money paid now for shares issued at the next round, usually with a discount and a long-stop date.',
  },
  {
    id: 'nl_convertible_loan',
    label: 'Convertible Loan (Netherlands)',
    country: 'NL',
    kind: 'note',
    postMoney: false,
    description: 'Converteerbare lening; converts by a notarial deed of issue at the next round.',
  },
] as const satisfies readonly UnpricedProfile[];

export type UnpricedProfileId = (typeof UNPRICED_PROFILES)[number]['id'];
export const UNPRICED_PROFILE_IDS = UNPRICED_PROFILES.map((p) => p.id) as [UnpricedProfileId, ...UnpricedProfileId[]];

export const PLAN_KINDS = ['option', 'warrant', 'virtual'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_KIND_LABELS: Record<PlanKind, string> = {
  option: 'Options',
  warrant: 'Warrants',
  virtual: 'Virtual Shares',
};

export interface PlanProfile {
  id: string;
  label: string;
  country: string | null;
  kind: PlanKind;
  /** Must be sold at market value, so the fair value helper applies. */
  marketValue: boolean;
  description: string;
}

export const PLAN_PROFILES = [
  {
    id: 'options',
    label: 'Employee Options',
    country: null,
    kind: 'option',
    marketValue: false,
    description: 'Options to buy shares at a strike price, with vesting.',
  },
  {
    id: 'phantom',
    label: 'Phantom Shares',
    country: null,
    kind: 'virtual',
    marketValue: false,
    description: 'Cash-settled; pays the value of a share above a base price at an exit. Never reaches the register.',
  },
  {
    id: 'se_warrants',
    label: 'Warrants (Teckningsoptioner)',
    country: 'SE',
    kind: 'warrant',
    marketValue: true,
    description: 'Incentive warrants bought by employees at market value; exercise is a new issue.',
  },
  {
    id: 'se_kpo',
    label: 'Qualified Employee Options (KPO)',
    country: 'SE',
    kind: 'option',
    marketValue: false,
    description: 'Kvalificerade personaloptioner, taxed at exercise of the shares rather than as salary.',
  },
  {
    id: 'de_vsop',
    label: 'Virtual Shares (VSOP)',
    country: 'DE',
    kind: 'virtual',
    marketValue: false,
    description: 'Virtual stock option plan; cash at an exit, paid ahead of the split to holders.',
  },
  {
    id: 'de_esop',
    label: 'Options (Germany)',
    country: 'DE',
    kind: 'option',
    marketValue: false,
    description: 'Real options over Geschäftsanteile, settled through a capital increase.',
  },
  {
    id: 'fr_bspce',
    label: 'BSPCE (France)',
    country: 'FR',
    kind: 'warrant',
    marketValue: false,
    description: "Bons de souscription de parts de créateur d'entreprise, for employees of young companies.",
  },
  {
    id: 'fr_bsa',
    label: 'BSA (France)',
    country: 'FR',
    kind: 'warrant',
    marketValue: true,
    description: "Bons de souscription d'actions for advisors and board members, sold at market value.",
  },
  {
    id: 'fr_aga',
    label: 'Free Shares (AGA)',
    country: 'FR',
    kind: 'option',
    marketValue: false,
    description: 'Attributions gratuites d’actions: shares granted for free after a vesting period. Strike is zero.',
  },
  {
    id: 'nl_stak',
    label: 'Depositary Receipts (STAK)',
    country: 'NL',
    kind: 'option',
    marketValue: false,
    description: 'Options over depositary receipts issued by a foundation (STAK) that holds the shares.',
  },
  {
    id: 'dk_warrants',
    label: 'Warrants (Tegningsoptioner)',
    country: 'DK',
    kind: 'warrant',
    marketValue: true,
    description: 'Danish warrants, often granted under section 7P.',
  },
  {
    id: 'uk_emi',
    label: 'EMI Options (UK)',
    country: 'GB',
    kind: 'option',
    marketValue: false,
    description: 'Enterprise Management Incentive options, tax-advantaged for qualifying UK companies.',
  },
] as const satisfies readonly PlanProfile[];

export type PlanProfileId = (typeof PLAN_PROFILES)[number]['id'];
export const PLAN_PROFILE_IDS = PLAN_PROFILES.map((p) => p.id) as [PlanProfileId, ...PlanProfileId[]];

export function unpricedProfile(id: string): UnpricedProfile {
  return UNPRICED_PROFILES.find((p) => p.id === id) ?? UNPRICED_PROFILES[0];
}

export function planProfile(id: string): PlanProfile {
  return PLAN_PROFILES.find((p) => p.id === id) ?? PLAN_PROFILES[0];
}

/** Profiles for a company's country first, then the generic ones, then other countries. */
export function profilesFor<T extends { country: string | null }>(list: readonly T[], country: string): T[] {
  const rank = (p: T) => (p.country === country ? 0 : p.country === null ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b));
}
