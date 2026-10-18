import { isSwedishOrgNumber, isSwedishPersonalNumber } from '@openinc/shared';
import { extractText, getDocumentProxy } from 'unpdf';
import * as XLSX from 'xlsx';

/** What the review screen shows next to the extracted rows, and what the model reads. */
export interface ExtractedSource {
  kind: 'sheet' | 'pdf';
  sheets: { name: string; rows: string[][] }[];
  pages: string[][];
  /** Pages with almost no text: probably scanned, so the model needs the PDF itself. */
  scanned: boolean;
  encoding?: string;
  delimiter?: string;
}

const MAX_ROWS = 3000;
const MAX_COLUMNS = 40;

export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** UTF-8 when it decodes cleanly, otherwise Windows-1252 (what Excel in Sweden saves CSV as). */
export function decodeText(data: Buffer): { text: string; encoding: string } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(data), encoding: 'windows-1252' };
  }
}

/** The delimiter that splits the first lines into the same number of columns most often, preferring more columns. */
export function detectDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    if (!counts.length || counts.every((c) => c === 0)) continue;
    const mode = counts.sort((a, b) => counts.filter((x) => x === b).length - counts.filter((x) => x === a).length)[0]!;
    const score = lines.filter((l) => l.split(d).length - 1 === mode).length * 100 + mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function sheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
  return rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLUMNS).map((c) => String(c ?? '').trim()));
}

export async function extractFile(data: Buffer, contentType: string, name: string): Promise<ExtractedSource> {
  const lower = name.toLowerCase();
  if (contentType === 'application/pdf' || lower.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((page) =>
      page
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const chars = pages.reduce((s, p) => s + p.join('').length, 0);
    return { kind: 'pdf', sheets: [], pages, scanned: chars < 40 * Math.max(pages.length, 1) };
  }
  if (lower.endsWith('.csv') || contentType.startsWith('text/')) {
    const { text, encoding } = decodeText(data);
    const delimiter = detectDelimiter(text);
    const wb = XLSX.read(text, { type: 'string', FS: delimiter, raw: true });
    return {
      kind: 'sheet',
      sheets: [{ name: 'CSV', rows: sheetRows(wb.Sheets[wb.SheetNames[0]!]!) }],
      pages: [],
      scanned: false,
      encoding,
      delimiter,
    };
  }
  const wb = XLSX.read(data, { type: 'buffer', cellDates: false });
  return {
    kind: 'sheet',
    sheets: wb.SheetNames.map((n) => ({ name: n, rows: sheetRows(wb.Sheets[n]!) })),
    pages: [],
    scanned: false,
  };
}

/** The file as the model reads it: every non-empty cell with its address, or every line with its page and line number. */
export function promptText(source: ExtractedSource, limit = 200_000): string {
  const out: string[] = [];
  if (source.kind === 'sheet') {
    for (const sheet of source.sheets) {
      out.push(`### Sheet "${sheet.name}"`);
      sheet.rows.forEach((row, r) => {
        const cells = row.map((v, c) => (v ? `${columnName(c)}${r + 1}=${v}` : '')).filter(Boolean);
        if (cells.length) out.push(cells.join(' | '));
      });
    }
  } else {
    source.pages.forEach((lines, p) => {
      out.push(`### Page ${p + 1}`);
      for (const [l, line] of lines.entries()) out.push(`p${p + 1} l${l + 1}: ${line}`);
    });
  }
  const text = out.join('\n');
  return text.length > limit ? `${text.slice(0, limit)}\n[cut off]` : text;
}

const ID_PATTERN = /\b(?:\d{8}|\d{6})[-+]?\d{4}\b/g;

/**
 * Swaps Swedish personnummer and organisationsnummer for placeholders before the text leaves the
 * server. Only numbers that pass the checksum are swapped, so share numbers and amounts survive.
 */
export function tokenizeIds(text: string): { text: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  const byValue = new Map<string, string>();
  const replaced = text.replace(ID_PATTERN, (match) => {
    if (!isSwedishPersonalNumber(match) && !isSwedishOrgNumber(match)) return match;
    let token = byValue.get(match);
    if (!token) {
      token = `ID_${byValue.size + 1}`;
      byValue.set(match, token);
      tokens.set(token, match);
    }
    return `[${token}]`;
  });
  return { text: replaced, tokens };
}

export function restoreIds<T>(value: T, tokens: Map<string, string>): T {
  if (!tokens.size) return value;
  return JSON.parse(JSON.stringify(value).replace(/\[?(ID_\d+)\]?/g, (m, token: string) => tokens.get(token) ?? m)) as T;
}
