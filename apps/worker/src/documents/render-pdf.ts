import PDFDocument from 'pdfkit';
import type { DocumentContent } from './document-content.js';

const MARGIN = 56;
const VALUE_COLUMN_WIDTH = 140;

export function renderDocumentPdf(content: DocumentContent, creationDate: Date): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: content.title, Creator: 'photoo.lu', CreationDate: creationDate },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const labelWidth = width - VALUE_COLUMN_WIDTH;

  doc.font('Helvetica-Bold').fontSize(18).text(content.title, left);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(10);
  for (const line of content.meta) {
    doc.text(line, left);
  }
  doc.moveDown();

  for (const party of content.parties) {
    doc.font('Helvetica-Bold').fontSize(11).text(party.heading, left);
    doc.font('Helvetica').fontSize(10);
    for (const line of party.lines) {
      doc.text(line, left);
    }
    doc.moveDown();
  }

  if (content.rowsHeading) {
    doc.font('Helvetica-Bold').fontSize(11).text(content.rowsHeading, left);
    doc.moveDown(0.3);
  }
  for (const entry of content.rows) {
    doc.font(entry.emphasis ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
    const top = doc.y;
    doc.text(entry.label, left, top, { width: labelWidth - 8 });
    const labelBottom = doc.y;
    doc.text(entry.value, left + labelWidth, top, { width: VALUE_COLUMN_WIDTH, align: 'right' });
    doc.y = Math.max(labelBottom, doc.y) + 4;
  }
  doc.moveDown();
  doc.font('Helvetica').fontSize(9).text(content.notice, left, doc.y, { width });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.height - doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(content.footer, left, bottom + 16, { width, align: 'left', lineBreak: false })
      .text(content.pageLabel(index - range.start + 1, range.count), left, bottom + 16, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }
  doc.end();
  return done;
}
