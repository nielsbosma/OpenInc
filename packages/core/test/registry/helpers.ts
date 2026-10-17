import { euBase, type RegistrySettingsView, type RegistryTransactionInput, registryTransaction, seAbl } from '@openinc/shared';
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
