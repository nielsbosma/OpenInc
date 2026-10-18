import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/** WinAnsi is all the standard fonts can draw; anything else would make pdf-lib throw. */
const printable = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/**
 * Stamps the text diagonally across every page, light enough to read the document through it.
 * A PDF that cannot be parsed (encrypted, broken) is refused rather than sent without its watermark.
 */
export async function watermarkPdf(data: Uint8Array, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(data, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const line = printable(text);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(10, Math.min(28, (Math.hypot(width, height) * 0.8) / Math.max(line.length, 1) / 0.5));
    const textWidth = font.widthOfTextAtSize(line, size);
    const angle = Math.atan2(height, width);
    for (const at of [0.25, 0.5, 0.75]) {
      const cx = width * at;
      const cy = height * at;
      page.drawText(line, {
        x: cx - (Math.cos(angle) * textWidth) / 2,
        y: cy - (Math.sin(angle) * textWidth) / 2,
        size,
        font,
        color: rgb(0.45, 0.45, 0.5),
        opacity: 0.18,
        rotate: degrees((angle * 180) / Math.PI),
      });
    }
    page.drawText(line, { x: 24, y: 14, size: 8, font, color: rgb(0.45, 0.45, 0.5), opacity: 0.6 });
  }
  return pdf.save();
}
