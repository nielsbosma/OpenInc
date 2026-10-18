import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { Signer, SUBFILTER_ETSI_CADES_DETACHED } from '@signpdf/utils';
import * as asn1js from 'asn1js';
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from 'pdf-lib';
import type { Certificate } from 'pkijs';
import { type CryptoKey, signCms } from './pki.ts';

export const ENVELOPE_KEYWORD = 'openinc-envelope:';

/** Opens a PDF the way signing needs it: not encrypted, at least one page. Throws a readable message otherwise. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if ((error as Error).name === 'EncryptedPDFError')
      throw new Error('The PDF is password protected. Remove the protection and upload it again.');
    throw new Error('The file could not be read as a PDF.');
  }
  if (doc.getPageCount() === 0) throw new Error('The PDF has no pages.');
  return doc;
}

export interface StampField {
  type: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: string | null;
}

const FALLBACK: Record<string, string> = { Ł: 'L', ł: 'l', Đ: 'D', đ: 'd', Ħ: 'H', ħ: 'h', ı: 'i', Ŀ: 'L', ŀ: 'l' };

/** Replaces characters the standard PDF fonts cannot draw, so a name in another script never breaks sealing. */
export function drawable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += (FALLBACK[ch] ?? ch)
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\x20-\x7e]/g, '?');
    }
  }
  return out;
}

function fitText(page: PDFPage, font: PDFFont, text: string, box: { x: number; y: number; width: number; height: number }) {
  const safe = drawable(font, text);
  let size = Math.min(box.height * 0.7, 28);
  while (size > 5 && font.widthOfTextAtSize(safe, size) > box.width - 4) size -= 0.5;
  page.drawText(safe, { x: box.x + 2, y: box.y + (box.height - size * 0.72) / 2, size, font, color: rgb(0.08, 0.08, 0.2) });
}

/** Draws every filled field onto its page. Positions are fractions of the visible page area from its top left. */
export async function stampFields(doc: PDFDocument, fields: StampField[]) {
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const script = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page || !f.value) continue;
    const view = page.getCropBox();
    const box = {
      x: view.x + f.x * view.width,
      y: view.y + view.height - (f.y + f.height) * view.height,
      width: f.width * view.width,
      height: f.height * view.height,
    };
    if ((f.type === 'signature' || f.type === 'initials') && f.value.startsWith('data:image/png;base64,')) {
      const image = await doc.embedPng(Buffer.from(f.value.slice('data:image/png;base64,'.length), 'base64'));
      const scale = Math.min(box.width / image.width, box.height / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h });
    } else if (f.type === 'checkbox') {
      if (f.value !== 'true') continue;
      const s = Math.min(box.width, box.height);
      const color = rgb(0.08, 0.08, 0.2);
      page.drawLine({
        start: { x: box.x + s * 0.15, y: box.y + s * 0.5 },
        end: { x: box.x + s * 0.4, y: box.y + s * 0.2 },
        thickness: 1.5,
        color,
      });
      page.drawLine({
        start: { x: box.x + s * 0.4, y: box.y + s * 0.2 },
        end: { x: box.x + s * 0.85, y: box.y + s * 0.85 },
        thickness: 1.5,
        color,
      });
    } else {
      fitText(page, f.type === 'signature' || f.type === 'initials' ? script : helvetica, f.value, box);
    }
  }
}

export interface CertificateSigner {
  name: string;
  email: string;
  role: string;
  status: string;
  signedAt: string | null;
  method: string;
  ip: string | null;
  statementHash: string | null;
}

export interface CertificateContent {
  envelopeId: string;
  title: string;
  fileName: string;
  company: string;
  documentHash: string;
  sentBy: string;
  sentAt: string;
  completedAt: string;
  chainHead: string;
  signers: CertificateSigner[];
  verifyUrl: string;
  sealedBy: string;
}

/** Appends the Swedish signing certificate: who signed, when, how, and the hashes that tie it together. */
export async function appendCertificate(doc: PDFDocument, c: CertificateContent) {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const [W, H, M] = [595.28, 841.89, 56];
  const ink = rgb(0.1, 0.1, 0.12);
  const quiet = rgb(0.42, 0.42, 0.46);
  let page = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (space: number) => {
    if (y - space >= M) return;
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const wrap = (text: string, font: PDFFont, size: number, width: number) => {
    const words = drawable(font, text).split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const text = (
    value: string,
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {},
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 9.5;
    for (const line of wrap(value, font, size, opts.width ?? W - 2 * M - (opts.x ?? 0))) {
      ensure(size + 4);
      page.drawText(line, { x: M + (opts.x ?? 0), y: y - size, size, font, color: opts.color ?? ink });
      y -= size + 4;
    }
  };
  const row = (label: string, value: string, valueFont: PDFFont = regular) => {
    ensure(14);
    const top = y;
    page.drawText(drawable(regular, label), { x: M, y: y - 9, size: 8.5, font: regular, color: quiet });
    text(value, { font: valueFont, size: valueFont === mono ? 7.5 : 9.5, x: 130 });
    if (y === top) y -= 13;
    y -= 2;
  };
  const rule = () => {
    ensure(16);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.87) });
    y -= 10;
  };

  text('Signeringsintyg', { font: bold, size: 18 });
  y -= 2;
  text(`${c.company} · Signing certificate`, { size: 9.5, color: quiet });
  rule();
  row('Dokument', c.title, bold);
  row('Fil', c.fileName);
  row('Kuvert-id', c.envelopeId, mono);
  row('Skickat av', `${c.sentBy}, ${c.sentAt}`);
  row('Slutfört', c.completedAt);
  row('Original (SHA-256)', c.documentHash, mono);

  for (const s of c.signers) {
    rule();
    text(`${s.name} <${s.email}>`, { font: bold, size: 10.5 });
    y -= 2;
    row('Roll', s.role === 'cc' ? 'Kopia' : 'Undertecknare');
    if (s.role !== 'cc') {
      row('Status', s.status === 'signed' ? 'Signerat' : s.status);
      if (s.signedAt) row('Signerat', s.signedAt);
      row('Metod', s.method);
      if (s.ip) row('IP-adress', s.ip);
      if (s.statementHash) row('Underskrift (SHA-256)', s.statementHash, mono);
    }
  }

  rule();
  row('Händelsekedja', c.chainHead, mono);
  y -= 4;
  text(
    `Dokumentet är förseglat med en elektronisk stämpel (PAdES) utfärdad av ${c.sealedBy}. Varje ändring efter förseglingen syns som en ogiltig underskrift. Kontrollera dokumentet på ${c.verifyUrl}.`,
    { size: 8.5, color: quiet },
  );
}

class CmsSigner extends Signer {
  constructor(private readonly key: { cert: Certificate; privateKey: CryptoKey; chain: Certificate[] }) {
    super();
  }

  override async sign(pdfBuffer: Buffer): Promise<Buffer> {
    return signCms(pdfBuffer, this.key);
  }
}

/** Adds a PAdES signature (ETSI.CAdES.detached) covering the whole file. */
export async function sealPdf(
  doc: PDFDocument,
  key: { cert: Certificate; privateKey: CryptoKey; chain: Certificate[] },
  info: { envelopeId: string; name: string; reason: string; location: string; contactInfo: string; signingTime: Date },
): Promise<Buffer> {
  doc.setKeywords([`${ENVELOPE_KEYWORD}${info.envelopeId}`]);
  doc.setProducer('OpenInc');
  doc.setModificationDate(info.signingTime);
  pdflibAddPlaceholder({
    pdfDoc: doc,
    reason: info.reason,
    contactInfo: info.contactInfo,
    name: info.name,
    location: info.location,
    signingTime: info.signingTime,
    signatureLength: 12_000,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    appName: 'OpenInc',
  });
  const unsigned = Buffer.from(await doc.save({ useObjectStreams: false }));
  return new SignPdf().sign(unsigned, new CmsSigner(key), info.signingTime);
}

export interface EmbeddedSignature {
  cms: Buffer;
  signedContent: Buffer;
  /** False when bytes were added after the signature (an incremental update). */
  coversWholeFile: boolean;
}

/** The last signature in a PDF: its CMS and the bytes it covers. Null when the file carries none. */
export function extractSignature(pdf: Buffer): EmbeddedSignature | null {
  const text = pdf.toString('latin1');
  const matches = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const last = matches.at(-1);
  if (!last) return null;
  const [a, b, c, d] = last.slice(1, 5).map(Number) as [number, number, number, number];
  if (a !== 0 || a + b > c || c + d > pdf.length) return null;
  const hex = text.slice(a + b, c).replace(/[<>\s]/g, '');
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2) return null;
  const padded = Buffer.from(hex, 'hex');
  // The placeholder is padded with zeros; the DER header says where the signature really ends.
  const parsed = asn1js.fromBER(padded);
  if (parsed.offset === -1) return null;
  return {
    cms: padded.subarray(0, parsed.offset),
    signedContent: Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]),
    coversWholeFile: c + d === pdf.length,
  };
}

export async function envelopeIdFromPdf(pdf: Buffer): Promise<string | null> {
  try {
    const doc = await PDFDocument.load(pdf, { updateMetadata: false, ignoreEncryption: true });
    const match = doc.getKeywords()?.match(/openinc-envelope:([0-9a-f-]{36})/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
