import {
  euBase,
  type ImportExtraction,
  type RegistrySettingsView,
  type RegistryTransactionInput,
  registryTransaction,
  seAbl,
} from '@openinc/shared';
import type { EngineConfig, LedgerTx } from '../../src/registry/engine.ts';

export const H = {
  anna: '00000000-0000-4000-8000-00000000000a',
  bjorn: '00000000-0000-4000-8000-00000000000b',
  cecilia: '00000000-0000-4000-8000-00000000000c',
  bolag: '00000000-0000-4000-8000-0000000000d0',
  estate: '00000000-0000-4000-8000-0000000000e0',
  pool: '00000000-0000-4000-8000-0000000000f0',
};

export const people = {
  anna: {
    holderId: H.anna,
    kind: 'person',
    name: 'Anna Andersson',
    nationalId: '19811218-9876',
    country: 'SE',
    address: 'Storgatan 1, Stockholm',
  },
  bjorn: {
    holderId: H.bjorn,
    kind: 'person',
    name: 'Björn Berg',
    nationalId: '19900101-0017',
    country: 'SE',
    address: 'Kungsgatan 2, Göteborg',
  },
  cecilia: { holderId: H.cecilia, kind: 'person', name: 'Cecilia Carlsson', nationalId: '19850615-2381', country: 'SE' },
  bolag: { holderId: H.bolag, kind: 'company', name: 'Invest AB', nationalId: '556036-0793', country: 'SE' },
  estate: { holderId: H.estate, kind: 'estate', name: 'Dödsbo efter Anna Andersson', nationalId: '19811218-9876', country: 'SE' },
  pool: { holderId: H.pool, kind: 'company', name: 'Fraction Pool AB', nationalId: '556677-8899', country: 'SE' },
} as const;

export function seSettings(over: Partial<RegistrySettingsView> = {}): RegistrySettingsView {
  return {
    country: 'SE',
    legalForm: 'AB',
    rulePack: 'se-abl',
    nationalNumber: '556123-4567',
    euid: '',
    lei: '',
    numbering: true,
    capitalMode: 'quota',
    minShareCapital: null,
    maxShareCapital: null,
    minShares: null,
    maxShares: null,
    ...over,
  };
}

export function seConfig(over: Partial<RegistrySettingsView> = {}): EngineConfig {
  return { settings: seSettings(over), rulePack: seAbl, currency: 'SEK', currencyDigits: 2 };
}

export function euConfig(over: Partial<RegistrySettingsView> = {}): EngineConfig {
  return {
    settings: seSettings({
      country: 'DE',
      legalForm: 'private',
      rulePack: 'eu-base',
      nationalNumber: '',
      numbering: false,
      capitalMode: 'nominal',
      ...over,
    }),
    rulePack: euBase,
    currency: 'EUR',
    currencyDigits: 2,
  };
}

let counter = 0;
export function txId(n = ++counter) {
  return `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export function tx(input: RegistryTransactionInput, seq: number, id = txId(seq)): LedgerTx {
  return { id, seq, tx: registryTransaction.parse(input) };
}

export function incorporation(seq = 1, date = '2024-01-15'): LedgerTx {
  return tx(
    {
      type: 'incorporation',
      effectiveDate: date,
      shareCapital: '2500000',
      holders: [people.anna, people.bjorn],
      classes: [
        { code: 'A', votesPerShare: '10', restrictions: { consent: true, preEmption: false, firstRefusal: false } },
        { code: 'B', votesPerShare: '1' },
      ],
      allocations: [
        { holderId: H.anna, classCode: 'A', count: 1000, pricePerShare: '1' },
        { holderId: H.bjorn, classCode: 'B', count: 24000, pricePerShare: '1' },
      ],
    },
    seq,
  );
}

export const src = (cell: string) => ({ source: { sheet: 'CSV', cell, page: null, line: null }, confidence: 0.95 });

export function snapshotExtraction(over: Partial<ImportExtraction> = {}): ImportExtraction {
  return {
    company: {
      name: 'Exempel AB',
      nationalNumber: '556123-4567',
      shareCapital: '25 000',
      currency: 'SEK',
      asOfDate: '2024-12-31',
      ...src('B1'),
    },
    classes: [{ code: 'A', votesPerShare: '1', ...src('C3') }],
    holders: [
      { ref: 'h1', kind: 'person', name: 'Åsa Öberg', nationalId: '19811218-9876', country: 'SE', address: 'Storgatan 1', ...src('A3') },
      { ref: 'h2', kind: 'company', name: 'Invest AB', nationalId: '556036-0793', country: 'SE', address: '', ...src('A4') },
    ],
    mode: 'snapshot',
    holdings: [
      { holderRef: 'h1', classCode: 'A', count: '15 000', shareNumbers: '1-15000', ...src('D3') },
      { holderRef: 'h2', classCode: 'A', count: '10000', shareNumbers: '15001–25000', ...src('D4') },
    ],
    events: [],
    notes: [],
    ...over,
  };
}
