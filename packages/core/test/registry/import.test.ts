import type { ImportExtraction } from '@openinc/shared';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildImport, parseShareNumbers, toMinor } from '../../src/registry/import/build.ts';
import { decodeText, detectDelimiter, extractFile, promptText, restoreIds, tokenizeIds } from '../../src/registry/import/extract.ts';
import { incorporation, seConfig, snapshotExtraction, src } from './helpers.ts';

describe('AI import: reading files', () => {
  it('reads a semicolon CSV saved as Windows-1252 by Swedish Excel', async () => {
    const csv =
      'Aktieägare;Personnummer;Antal aktier;Aktienummer\r\nÅsa Öberg;19811218-9876;15 000;1-15000\r\nInvest AB;556036-0793;10 000;15001-25000\r\n';
    const data = Buffer.from(csv, 'latin1');
    expect(decodeText(data).encoding).toBe('windows-1252');
    expect(detectDelimiter(csv)).toBe(';');
    const source = await extractFile(data, 'text/csv', 'aktiebok.csv');
    expect(source.sheets[0]!.rows[1]).toEqual(['Åsa Öberg', '19811218-9876', '15 000', '1-15000']);
    expect(promptText(source)).toContain('A2=Åsa Öberg | B2=19811218-9876');
  });

  it('reads every sheet of a workbook with cell addresses', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Holder', 'Shares'],
        ['Anna', 1000],
      ]),
      'Register',
    );
    const data = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const source = await extractFile(data, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'register.xlsx');
    expect(promptText(source)).toContain('### Sheet "Register"\nA1=Holder | B1=Shares\nA2=Anna | B2=1000');
  });

  it('hides valid Swedish ID numbers from the model and puts them back', () => {
    const { text, tokens } = tokenizeIds('A2=Åsa | B2=19811218-9876 | C2=556036-0793 | D2=1000001-1500000 | E2=811218-9875');
    expect(text).toBe('A2=Åsa | B2=[ID_1] | C2=[ID_2] | D2=1000001-1500000 | E2=811218-9875');
    expect(restoreIds({ nationalId: '[ID_2]', other: 'ID_1' }, tokens)).toEqual({ nationalId: '556036-0793', other: '19811218-9876' });
  });
});

describe('AI import: checking what the model returned', () => {
  it('parses amounts and share numbers as people write them', () => {
    expect(toMinor('25 000', 2)).toBe('2500000');
    expect(toMinor('1,234.5', 2)).toBe('123450');
    expect(toMinor('1.234,50', 2)).toBe('123450');
    expect(parseShareNumbers('1-500, 701 – 800')).toEqual([
      { from: '1', to: '500' },
      { from: '701', to: '800' },
    ]);
    expect(parseShareNumbers('ett till tio')).toBeNull();
  });

  it('turns a snapshot into one valid opening balance', () => {
    const built = buildImport(snapshotExtraction(), seConfig(), { today: '2025-01-01' });
    expect(built.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(built.transactions).toHaveLength(1);
    expect(built.transactions[0]).toMatchObject({ type: 'opening_balance', effectiveDate: '2024-12-31', shareCapital: '2500000' });
  });

  it('flags overlapping share numbers, bad ID numbers and unknown holders by row', () => {
    const bad = snapshotExtraction({
      holders: [{ ...snapshotExtraction().holders[0]!, nationalId: '19811218-9875' }, snapshotExtraction().holders[1]!],
      holdings: [
        { holderRef: 'h1', classCode: 'A', count: '15000', shareNumbers: '1-15000', ...src('D3') },
        { holderRef: 'h9', classCode: 'A', count: '10000', shareNumbers: '15001-25000', ...src('D4') },
      ],
    });
    const built = buildImport(bad, seConfig(), { today: '2025-01-01' });
    expect(built.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'holders.0', rule: 'SE_PERSONAL_NUMBER', severity: 'error' }),
        expect.objectContaining({ path: 'holdings.1', severity: 'error' }),
      ]),
    );
    const overlap = buildImport(
      snapshotExtraction({
        holdings: [
          { holderRef: 'h1', classCode: 'A', count: '15000', shareNumbers: '1-15000', ...src('D3') },
          { holderRef: 'h2', classCode: 'A', count: '10000', shareNumbers: '10001-20000', ...src('D4') },
        ],
      }),
      seConfig(),
      { today: '2025-01-01' },
    );
    expect(overlap.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'UNIQUE_SHARE_NUMBERS', path: 'transactions.0' })]),
    );
  });

  it('refuses an opening balance on a register that already has one', () => {
    const built = buildImport(snapshotExtraction(), seConfig(), { today: '2025-01-01', committed: [incorporation()] });
    expect(built.issues).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'ALREADY_INITIALIZED' })]));
  });

  it('replays a history from the incorporation', () => {
    const e = (over: Partial<ImportExtraction['events'][number]>) => ({
      date: '2020-01-01',
      type: 'incorporation' as const,
      fromRef: null,
      toRef: null,
      classCode: 'A',
      count: '0',
      shareNumbers: '',
      pricePerShare: null,
      ratio: null,
      description: '',
      ...src('A1'),
      ...over,
    });
    const built = buildImport(
      snapshotExtraction({
        mode: 'history',
        holdings: [],
        events: [
          e({ toRef: 'h1', count: '20000' }),
          e({ toRef: 'h2', count: '5000' }),
          e({ date: '2022-05-01', type: 'transfer', fromRef: 'h1', toRef: 'h2', count: '5000', pricePerShare: '12,50' }),
          e({ date: '2023-01-01', type: 'other', description: 'Pantsättning till banken' }),
        ],
      }),
      seConfig(),
      { today: '2025-01-01' },
    );
    expect(built.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(built.transactions.map((t) => t.type)).toEqual(['incorporation', 'transfer']);
    expect(built.issues.some((i) => i.message.includes('Pantsättning'))).toBe(true);
  });
});
