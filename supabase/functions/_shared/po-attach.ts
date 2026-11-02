// Puts the files attached to a purchase order behind the PO itself, so the one PDF that is downloaded (or attached to a mail by hand)
// carries everything: PDF attachments are added page by page, JPG / PNG pictures get a page each. Word / Excel files cannot be
// turned into pages, so a closing page lists them (and any file that could not be read) — those are sent separately.
// A bad attachment never stops the PO from being built.
import { PDFDocument, StandardFonts, rgb } from './deps.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;
export interface PoAttachment {
  name: string;
  path: string;
}

const A4: [number, number] = [595.28, 841.89];
const ext = (n: string) => (n.split('.').pop() ?? '').toLowerCase();

export async function appendAttachments(admin: Admin, mainPdf: Uint8Array, attachments: PoAttachment[]): Promise<Uint8Array> {
  if (!attachments.length) return mainPdf;
  const doc = await PDFDocument.load(mainPdf);
  const notIncluded: string[] = [];

  for (const a of attachments) {
    try {
      const { data, error } = await admin.storage.from('po-attachments').download(a.path);
      if (error || !data) throw new Error(error?.message ?? 'not found');
      const bytes = new Uint8Array(await data.arrayBuffer());
      const e = ext(a.name || a.path);
      if (e === 'pdf') {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
      } else if (e === 'png' || e === 'jpg' || e === 'jpeg') {
        const img = e === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage(A4);
        const margin = 36;
        const scale = Math.min((A4[0] - margin * 2) / img.width, (A4[1] - margin * 2) / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
      } else {
        notIncluded.push(`${a.name || a.path} (${e.toUpperCase() || 'file'} — send separately)`);
      }
    } catch (err) {
      console.error('po attachment skipped:', a.path, err instanceof Error ? err.message : err);
      notIncluded.push(`${a.name || a.path} (could not be read — send separately)`);
    }
  }

  if (notIncluded.length) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage(A4);
    page.drawText('Attachments not included in this PDF', { x: 48, y: A4[1] - 72, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
    notIncluded.forEach((line, i) => page.drawText(`${i + 1}.  ${line}`.replace(/[^\x20-\xFF]/g, '?'), { x: 48, y: A4[1] - 104 - i * 20, size: 10.5, font, color: rgb(0.2, 0.2, 0.2) }));
  }
  return await doc.save();
}
