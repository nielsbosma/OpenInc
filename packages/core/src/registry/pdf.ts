import PDFDocument from 'pdfkit';

/** A small layer over pdfkit for print-ready A4 tables: wrapping cells, repeated headers, page numbers. */

export interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
  mono?: boolean;
}

const MARGIN = 48;
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const MONO = 'Courier';

export class PdfWriter {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(
    private readonly footer: string,
    options: { landscape?: boolean; title: string },
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout: options.landscape ? 'landscape' : 'portrait',
      margins: { top: MARGIN, bottom: MARGIN + 16, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: options.title, Producer: 'OpenInc' },
    });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.done = new Promise((resolve) => this.doc.on('end', () => resolve(Buffer.concat(this.chunks))));
    this.doc.font(FONT).fontSize(9);
  }

  get width() {
    return this.doc.page.width - MARGIN * 2;
  }

  title(text: string, subtitle?: string) {
    this.doc.font(BOLD).fontSize(16).fillColor('#111').text(text);
    if (subtitle) this.doc.font(FONT).fontSize(10).fillColor('#555').text(subtitle);
    this.doc.moveDown(0.8).fillColor('#111').fontSize(9).font(FONT);
  }

  heading(text: string) {
    this.ensure(40);
    this.doc.moveDown(0.6).font(BOLD).fontSize(11).text(text).moveDown(0.3).font(FONT).fontSize(9);
  }

  paragraph(text: string) {
    this.doc.font(FONT).fontSize(9).fillColor('#333').text(text, { width: this.width }).fillColor('#111').moveDown(0.4);
  }

  facts(rows: [string, string][]) {
    const labelWidth = 170;
    for (const [label, value] of rows) {
      this.ensure(14);
      const y = this.doc.y;
      this.doc.font(FONT).fillColor('#555').text(label, MARGIN, y, { width: labelWidth });
      this.doc.fillColor('#111').text(value || '—', MARGIN + labelWidth, y, { width: this.width - labelWidth });
      this.doc.x = MARGIN;
    }
    this.doc.moveDown(0.4);
  }

  private ensure(height: number) {
    if (this.doc.y + height > this.doc.page.height - MARGIN - 16) this.doc.addPage();
  }

  table(columns: Column[], rows: string[][]) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const widths = columns.map((c) => (c.width / total) * this.width);
    const pad = 3;
    const drawRow = (cells: string[], header: boolean) => {
      this.doc.font(header ? BOLD : FONT).fontSize(8);
      const heights = cells.map((cell, i) => {
        this.doc.font(header ? BOLD : columns[i]!.mono ? MONO : FONT);
        return this.doc.heightOfString(cell || ' ', { width: widths[i]! - pad * 2 });
      });
      const h = Math.max(...heights) + pad * 2;
      if (this.doc.y + h > this.doc.page.height - MARGIN - 16) {
        this.doc.addPage();
        if (!header) drawRow(columns.map((c) => c.header), true);
      }
      const y = this.doc.y;
      let x = MARGIN;
      if (header) this.doc.rect(MARGIN, y, this.width, h).fill('#f1f1f4').fillColor('#111');
      cells.forEach((cell, i) => {
        this.doc
          .font(header ? BOLD : columns[i]!.mono ? MONO : FONT)
          .fontSize(8)
          .fillColor('#111')
          .text(cell, x + pad, y + pad, { width: widths[i]! - pad * 2, align: columns[i]!.align ?? 'left' });
        x += widths[i]!;
      });
      this.doc
        .moveTo(MARGIN, y + h)
        .lineTo(MARGIN + this.width, y + h)
        .lineWidth(0.5)
        .strokeColor('#dddde3')
        .stroke();
      this.doc.y = y + h;
      this.doc.x = MARGIN;
    };
    drawRow(
      columns.map((c) => c.header),
      true,
    );
    for (const row of rows) drawRow(row, false);
    this.doc.moveDown(0.6);
  }

  signatureLines(labels: string[]) {
    this.ensure(70);
    this.doc.moveDown(2);
    const w = (this.width - 24 * (labels.length - 1)) / labels.length;
    const y = this.doc.y + 24;
    labels.forEach((label, i) => {
      const x = MARGIN + i * (w + 24);
      this.doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.5).strokeColor('#999').stroke();
      this.doc.font(FONT).fontSize(8).fillColor('#555').text(label, x, y + 4, { width: w });
    });
    this.doc.fillColor('#111');
  }

  async finish(): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      const bottom = this.doc.page.height - MARGIN + 4;
      this.doc.page.margins.bottom = 0;
      this.doc
        .font(FONT)
        .fontSize(7)
        .fillColor('#777')
        .text(this.footer, MARGIN, bottom, { width: this.width - 60, lineBreak: false })
        .text(`${i + 1} / ${range.count}`, MARGIN + this.width - 60, bottom, { width: 60, align: 'right', lineBreak: false });
    }
    this.doc.end();
    return this.done;
  }
}
