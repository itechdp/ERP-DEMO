// Builds the customer's copy of a Sales Quotation as a PDF. Same look as the Purchase Order PDF (po-pdf.ts): company header, navy card with the
// quotation number, customer / terms boxes, items table (header repeated on every page), total, amount in words, terms, signature block.
// It NEVER carries cost, profit or margin: this is the document the customer receives.
//
// Font: the standard Helvetica built into every PDF viewer (cannot draw the rupee sign, so amounts are written "Rs."; see po-pdf.ts).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from './deps.ts';
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from './logo.ts';
import { dmy, money, rupeesInWords } from './format.ts';
import { winAnsi } from './po-pdf.ts';

export interface QuotationPdfData {
  company: { name: string; address?: string | null; gstin?: string | null; phone?: string | null; email?: string | null };
  quotation: {
    qt_no: string;
    qt_date: string;
    valid_until?: string | null;
    enquiry_no?: string | null;
    payment_terms?: string | null;
    delivery_terms?: string | null;
    remarks?: string | null;
    salesperson?: string | null;
    approved_by?: string | null;
    approved_at?: string | null;
  };
  customer: { name: string; contact?: string | null; phone?: string | null; email?: string | null; address?: string | null; city?: string | null; state?: string | null; gstin?: string | null };
  items: { line_no: number; product: string; grade?: string | null; size?: string | null; uom: string; qty: number; rate: number; discount_pct: number; net_rate: number; amount: number }[];
}

const NAVY = rgb(0.102, 0.235, 0.38);
const TEAL = rgb(0.145, 0.576, 0.573);
const TEAL_BG = rgb(0.902, 0.965, 0.965);
const TEAL_LINE = rgb(0.737, 0.91, 0.906);
const LINE = rgb(0.886, 0.91, 0.941);
const HEAD_BG = rgb(0.973, 0.98, 0.988);
const INK = rgb(0.118, 0.161, 0.231);
const MUTED = rgb(0.392, 0.455, 0.545);
const STRONG = rgb(0.059, 0.09, 0.165);
const WHITE = rgb(1, 1, 1);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36;
const CW = PAGE_W - 2 * M;

const stamp = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

export async function buildQuotationPdf(d: QuotationPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);
  const q = d.quotation;

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (t: unknown, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: number; center?: number } = {}) => {
    const f = o.f ?? font;
    const size = o.size ?? 9;
    const s = winAnsi(t);
    let xx = x;
    if (o.right != null) xx = o.right - f.widthOfTextAtSize(s, size);
    if (o.center != null) xx = o.center - f.widthOfTextAtSize(s, size) / 2;
    page.drawText(s, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };
  const rect = (x: number, yy: number, w: number, h: number, o: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb>; bw?: number } = {}) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color: o.fill, borderColor: o.border, borderWidth: o.border ? o.bw ?? 0.8 : 0 });
  const hline = (x1: number, x2: number, yy: number, color = LINE, w = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const wrap = (t: unknown, f: PDFFont, size: number, width: number): string[] => {
    const words = winAnsi(t).split(' ').filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) <= width || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
    text(`${q.qt_no}  (continued)`, M, y - 9, { size: 9, f: bold, color: NAVY });
    text(d.company.name, PAGE_W - M, y - 9, { size: 8, color: MUTED, right: PAGE_W - M });
    hline(M, PAGE_W - M, y - 16, TEAL, 1.2);
    y -= 30;
  };
  const need = (h: number) => {
    if (y - h < M + 34) newPage();
  };

  // ---------------------------------------------------------------- header
  const logoH = 40;
  const logoW = (LOGO_WIDTH / LOGO_HEIGHT) * logoH;
  page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });
  let cy = y - logoH - 12;
  text(d.company.name, M, cy, { size: 10, f: bold, color: STRONG });
  const compLines = [d.company.address, d.company.gstin ? `GSTIN: ${d.company.gstin}` : '', [d.company.phone ? `Phone: ${d.company.phone}` : '', d.company.email ?? ''].filter(Boolean).join('   ')].filter(Boolean) as string[];
  for (const l of compLines) {
    cy -= 11;
    text(l, M, cy, { size: 8.5, color: MUTED });
  }

  const cardW = 200;
  const cardX = PAGE_W - M - cardW;
  const rows: [string, string][] = [
    ['Quotation No.', q.qt_no],
    ['Date', dmy(q.qt_date)],
    ['Valid Until', dmy(q.valid_until)],
    ...(q.enquiry_no ? ([['Enquiry Ref.', q.enquiry_no]] as [string, string][]) : []),
  ];
  const cardH = 22 + rows.length * 18;
  rect(cardX, y - cardH, cardW, cardH, { fill: WHITE, border: NAVY, bw: 1.2 });
  rect(cardX, y - 22, cardW, 22, { fill: NAVY });
  text('SALES QUOTATION', cardX + cardW / 2, y - 15, { size: 11, f: bold, color: WHITE, center: cardX + cardW / 2 });
  rows.forEach(([k, v], i) => {
    const ry = y - 22 - (i + 1) * 18;
    if (i < rows.length - 1) hline(cardX, cardX + cardW, ry, LINE);
    text(k, cardX + 8, ry + 6, { size: 8.5, f: bold, color: MUTED });
    text(v, cardX + cardW - 8, ry + 6, { size: 9, f: bold, color: STRONG, right: cardX + cardW - 8 });
  });
  y = Math.min(cy, y - cardH) - 18;

  // ---------------------------------------------------------------- customer + terms boxes
  const boxW = (CW - 14) / 2;
  const boxLines = (title: string, lines: { t: string; b?: boolean; big?: boolean }[]) => {
    const wrapped: { t: string; b?: boolean; big?: boolean }[] = [];
    for (const l of lines) for (const w of wrap(l.t, l.b || l.big ? bold : font, l.big ? 10.5 : 9, boxW - 20)) wrapped.push({ ...l, t: w });
    return { title, wrapped };
  };
  const customer = boxLines('QUOTATION FOR', [
    { t: d.customer.name, big: true, b: true },
    ...(d.customer.address ? [{ t: d.customer.address }] : []),
    ...([d.customer.city, d.customer.state].filter(Boolean).length ? [{ t: [d.customer.city, d.customer.state].filter(Boolean).join(', ') }] : []),
    ...(d.customer.gstin ? [{ t: `GSTIN: ${d.customer.gstin}`, b: true }] : []),
    ...(d.customer.contact ? [{ t: `Attention: ${d.customer.contact}` }] : []),
    ...(d.customer.phone ? [{ t: `Phone: ${d.customer.phone}` }] : []),
    ...(d.customer.email ? [{ t: `Email: ${d.customer.email}` }] : []),
  ]);
  const terms = boxLines('TERMS', [
    { t: `Payment Terms: ${q.payment_terms || 'As agreed'}` },
    { t: `Delivery Terms: ${q.delivery_terms || 'As agreed'}` },
    { t: `Valid Until: ${dmy(q.valid_until)}` },
    ...(q.salesperson ? [{ t: `Prepared by: ${q.salesperson}` }] : []),
  ]);
  const boxH = 22 + Math.max(customer.wrapped.length, terms.wrapped.length) * 12.5 + 10;
  need(boxH + 10);
  [customer, terms].forEach((b, i) => {
    const bx = M + i * (boxW + 14);
    rect(bx, y - boxH, boxW, boxH, { fill: WHITE, border: TEAL_LINE });
    rect(bx, y - 20, boxW, 20, { fill: TEAL_BG });
    hline(bx, bx + boxW, y - 20, TEAL_LINE);
    text(b.title, bx + 10, y - 14, { size: 8.5, f: bold, color: rgb(0.086, 0.396, 0.392) });
    b.wrapped.forEach((l, k) => text(l.t, bx + 10, y - 34 - k * 12.5, { size: l.big ? 10.5 : 9, f: l.b || l.big ? bold : font, color: l.big ? STRONG : INK }));
  });
  y -= boxH + 16;

  // ---------------------------------------------------------------- items
  const cols = [
    { k: '#', w: 24, a: 'c' },
    { k: 'PRODUCT & SPECIFICATIONS', w: 190, a: 'l' },
    { k: 'UOM', w: 36, a: 'c' },
    { k: 'QTY', w: 56, a: 'r' },
    { k: 'RATE (Rs.)', w: 62, a: 'r' },
    { k: 'DISC.', w: 38, a: 'c' },
    { k: 'NET RATE (Rs.)', w: 62, a: 'r' },
    { k: 'AMOUNT (Rs.)', w: CW - (24 + 190 + 36 + 56 + 62 + 38 + 62), a: 'r' },
  ] as const;
  const xs: number[] = [];
  cols.reduce((x, c) => (xs.push(x), x + c.w), M);
  const drawCell = (txt: string, i: number, yy: number, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const c = cols[i];
    const f = o.f ?? font;
    const size = o.size ?? 9;
    const w = f.widthOfTextAtSize(winAnsi(txt), size);
    const x = c.a === 'l' ? xs[i] + 5 : c.a === 'r' ? xs[i] + c.w - 5 - w : xs[i] + (c.w - w) / 2;
    text(txt, x, yy, { f, size, color: o.color });
  };
  const tableHead = () => {
    need(40);
    rect(M, y - 22, CW, 22, { fill: HEAD_BG });
    hline(M, M + CW, y - 22, TEAL, 1.6);
    cols.forEach((c, i) => drawCell(c.k, i, y - 14.5, { f: bold, size: 7.4, color: STRONG }));
    y -= 22;
  };
  tableHead();
  let total = 0;
  for (const it of d.items) {
    total += Number(it.amount);
    const specs = [it.grade, it.size].filter(Boolean).join(' · ');
    const nameLines = wrap(it.product, bold, 9, cols[1].w - 10);
    const specLines = specs ? wrap(specs, font, 8, cols[1].w - 10) : [];
    const rowH = Math.max(22, 8 + nameLines.length * 11 + specLines.length * 10);
    if (y - rowH < M + 40) {
      newPage();
      tableHead();
    }
    const top = y;
    drawCell(String(it.line_no), 0, top - 14, { color: MUTED });
    nameLines.forEach((l, k) => text(l, xs[1] + 5, top - 14 - k * 11, { f: bold, size: 9, color: STRONG }));
    specLines.forEach((l, k) => text(l, xs[1] + 5, top - 14 - nameLines.length * 11 + 1 - k * 10, { size: 8, color: MUTED }));
    drawCell(it.uom || 'PCS', 2, top - 14);
    drawCell(Number(it.qty).toLocaleString('en-IN'), 3, top - 14, { f: bold, color: STRONG });
    drawCell(money(it.rate), 4, top - 14);
    drawCell(Number(it.discount_pct) ? `${Number(it.discount_pct)}%` : '-', 5, top - 14);
    drawCell(money(it.net_rate), 6, top - 14, { f: bold, color: STRONG });
    drawCell(money(it.amount), 7, top - 14, { f: bold, color: STRONG });
    y -= rowH;
    hline(M, M + CW, y, LINE);
  }
  y -= 16;

  // ---------------------------------------------------------------- total + words
  const leftW = CW * 0.58 - 10;
  const rightW = CW * 0.42 - 6;
  const rightX = M + CW - rightW;
  const wordsLines = wrap(rupeesInWords(total), bold, 9.5, leftW - 24);
  const wordsH = 26 + wordsLines.length * 12;
  need(Math.max(wordsH, 30) + 10);
  rect(M, y - wordsH, leftW, wordsH, { fill: TEAL_BG, border: TEAL_LINE });
  rect(M, y - wordsH, 4, wordsH, { fill: TEAL });
  text('AMOUNT IN WORDS', M + 14, y - 13, { size: 7.6, f: bold, color: rgb(0.086, 0.396, 0.392) });
  wordsLines.forEach((l, i) => text(l, M + 14, y - 26 - i * 12, { size: 9.5, f: bold, color: STRONG }));
  rect(rightX, y - 28, rightW, 28, { fill: NAVY });
  text('TOTAL', rightX + 10, y - 18, { size: 10.5, f: bold, color: WHITE });
  text(`Rs. ${money(total)}`, rightX + rightW - 10, y - 18, { size: 11, f: bold, color: WHITE, right: rightX + rightW - 10 });
  y -= Math.max(wordsH, 28) + 20;

  // ---------------------------------------------------------------- terms
  const notes = [
    `This quotation is valid until ${dmy(q.valid_until)}.`,
    `Payment: ${q.payment_terms || 'as agreed'}. Delivery: ${q.delivery_terms || 'as agreed'}.`,
    ...(q.remarks ? [q.remarks] : []),
  ];
  const noteLines = notes.map((t, i) => wrap(`${i + 1}. ${t}`, font, 9, CW - 28));
  const notesH = 24 + noteLines.reduce((a, l) => a + l.length * 12, 0) + 8;
  need(notesH + 10);
  rect(M, y - notesH, CW, notesH, { border: LINE });
  text('TERMS & NOTES', M + 12, y - 15, { size: 8.5, f: bold, color: MUTED });
  let ty = y - 29;
  for (const lines of noteLines) {
    for (const l of lines) {
      text(l, M + 14, ty, { size: 9, color: rgb(0.278, 0.333, 0.412) });
      ty -= 12;
    }
  }
  y -= notesH + 22;

  // ---------------------------------------------------------------- signatures
  const sigH = 78;
  need(sigH + 10);
  const colW = CW / 2;
  const blocks: [string, string, string][] = [
    ['FOR ' + d.company.name.toUpperCase(), q.approved_by ? `Approved by ${q.approved_by}` : 'Authorised signatory', stamp(q.approved_at)],
    ['CUSTOMER ACCEPTANCE', 'Signature & date', ''],
  ];
  blocks.forEach(([title, who, when], i) => {
    const bx = M + i * colW + 24;
    const bw = colW - 48;
    hline(bx, bx + bw, y - 44, rgb(0.8, 0.835, 0.882), 0.8);
    text(title, bx + bw / 2, y - 56, { size: 8, f: bold, color: MUTED, center: bx + bw / 2 });
    text(who, bx + bw / 2, y - 67, { size: 8.5, color: STRONG, center: bx + bw / 2 });
    if (when) text(when, bx + bw / 2, y - 77, { size: 7.5, color: MUTED, center: bx + bw / 2 });
  });
  y -= sigH;

  // ---------------------------------------------------------------- footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    // no rule and no quotation number down here: the number is in the header box already
    text('This is a computer-generated quotation.', M, M + 4, { size: 7.5, color: rgb(0.58, 0.64, 0.72) });
    if (pages.length > 1) text(`Page ${i + 1} of ${pages.length}`, PAGE_W - M, M + 4, { size: 7.5, color: rgb(0.58, 0.64, 0.72), right: PAGE_W - M });
  });

  pdf.setTitle(`Sales Quotation ${q.qt_no}`);
  pdf.setAuthor(d.company.name);
  pdf.setCreator('ForgeFlow ERP');
  return await pdf.save();
}
