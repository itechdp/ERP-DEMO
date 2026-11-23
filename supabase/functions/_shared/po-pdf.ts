// Builds the final Purchase Order PDF. Same content and the same look as the printed PO (src/purchase/print.ts): company header, navy PO card,
// vendor / delivery boxes, items table (header repeated on every page), tax summary, amount in words, terms, approval block.
//
// FONT DECISION: the standard Helvetica fonts that every PDF viewer has built in. They cannot draw the rupee sign, so amounts are written "Rs."
// (the printed PO does the same in its totals). Any other character outside the Windows-1252 set is replaced by "?" instead of failing.
// To get "₹" later, embed a TTF with @pdf-lib/fontkit; nothing else here would change.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from './deps.ts';
import { LOGO_HEIGHT, LOGO_PNG_BASE64, LOGO_WIDTH } from './logo.ts';
import { dmy, money, rupeesInWords } from './format.ts';

export interface PoPdfData {
  company: { name: string; address?: string | null; gstin?: string | null; phone?: string | null; email?: string | null };
  po: {
    po_no: string;
    rev_no: number;
    po_date: string;
    delivery_date?: string | null;
    urgency: string;
    payment_terms?: string | null;
    delivery_terms?: string | null;
    other_terms?: string | null;
    tax_type: 'intra' | 'inter';
    taxable_amount: number;
    gst_amount: number;
    total_amount: number;
    created_by?: string | null;
    approved_by?: string | null;
    approved_at?: string | null;
    released_by?: string | null;
    released_at?: string | null;
  };
  supplier: { name: string; gstin?: string | null; email?: string | null; address?: string | null; phone?: string | null };
  items: { line_no: number; item: string; material?: string | null; grade?: string | null; size?: string | null; hsn?: string | null; uom: string; qty: number; rate: number; gst_pct: number; amount: number }[];
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

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36; // page margin
const CW = PAGE_W - 2 * M; // content width

/** Windows-1252 is what the standard fonts can draw; map the common extras and replace the rest. */
const EXTRA_OK = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]);
export function winAnsi(s: unknown): string {
  return String(s ?? '')
    .replace(/₹/g, 'Rs.')
    .replace(/[\r\n\t]+/g, ' ')
    .split('')
    .map((ch) => {
      const c = ch.charCodeAt(0);
      return (c >= 0x20 && c <= 0xff) || EXTRA_OK.has(c) ? ch : '?';
    })
    .join('');
}

const stamp = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
};

export async function buildPoPdf(d: PoPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(LOGO_PNG_BASE64);
  const revTag = d.po.rev_no > 0 ? ` (REV ${d.po.rev_no})` : '';
  const poLabel = `${d.po.po_no}${revTag}`;
  const isInter = d.po.tax_type === 'inter';

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

  /** words wrapped to a width */
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
    text(`${poLabel}  (continued)`, M, y - 9, { size: 9, f: bold, color: NAVY });
    text(d.company.name, PAGE_W - M, y - 9, { size: 8, color: MUTED, right: PAGE_W - M });
    hline(M, PAGE_W - M, y - 16, TEAL, 1.2);
    y -= 30;
  };
  const need = (h: number) => {
    if (y - h < M + 34) newPage();
  };

  // ---------------------------------------------------------------- header: logo + company, PO card
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
    ['PO No.', poLabel],
    ['Date', dmy(d.po.po_date)],
    ['Delivery Dt.', dmy(d.po.delivery_date)],
  ];
  const cardH = 22 + rows.length * 18;
  rect(cardX, y - cardH, cardW, cardH, { fill: rgb(1, 1, 1), border: NAVY, bw: 1.2 });
  rect(cardX, y - 22, cardW, 22, { fill: NAVY });
  text('PURCHASE ORDER', cardX + cardW / 2, y - 15, { size: 11, f: bold, color: rgb(1, 1, 1), center: cardX + cardW / 2 });
  rows.forEach(([k, v], i) => {
    const ry = y - 22 - (i + 1) * 18;
    if (i < rows.length - 1) hline(cardX, cardX + cardW, ry, LINE);
    text(k, cardX + 8, ry + 6, { size: 8.5, f: bold, color: MUTED });
    text(v, cardX + cardW - 8, ry + 6, { size: 9, f: bold, color: STRONG, right: cardX + cardW - 8 });
  });
  y = Math.min(cy, y - cardH) - 18;

  // ---------------------------------------------------------------- vendor + delivery boxes
  const boxW = (CW - 14) / 2;
  const boxLines = (title: string, lines: { t: string; b?: boolean; big?: boolean }[]) => {
    const wrapped: { t: string; b?: boolean; big?: boolean }[] = [];
    for (const l of lines) for (const w of wrap(l.t, l.b || l.big ? bold : font, l.big ? 10.5 : 9, boxW - 20)) wrapped.push({ ...l, t: w });
    return { title, wrapped };
  };
  const vendor = boxLines('VENDOR / SUPPLIER', [
    { t: d.supplier.name, big: true, b: true },
    ...(d.supplier.address ? [{ t: d.supplier.address }] : []),
    ...(d.supplier.gstin ? [{ t: `GSTIN: ${d.supplier.gstin}` }] : []),
    ...(d.supplier.email ? [{ t: `Email: ${d.supplier.email}` }] : []),
    ...(d.supplier.phone ? [{ t: `Phone: ${d.supplier.phone}` }] : []),
    { t: `Priority: ${d.po.urgency}` },
    { t: `Payment Terms: ${d.po.payment_terms || '30 Days'}` },
  ]);
  const delivery = boxLines('DELIVERY ADDRESS / TERMS', [
    { t: d.company.name, big: true, b: true },
    ...(d.company.address ? [{ t: d.company.address }] : []),
    { t: `Delivery Terms: ${d.po.delivery_terms || 'Door Delivery'}` },
    { t: `Tax Type: ${isInter ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}` },
  ]);
  const boxH = 22 + Math.max(vendor.wrapped.length, delivery.wrapped.length) * 12.5 + 10;
  need(boxH + 10);
  [vendor, delivery].forEach((b, i) => {
    const bx = M + i * (boxW + 14);
    rect(bx, y - boxH, boxW, boxH, { fill: rgb(1, 1, 1), border: TEAL_LINE });
    rect(bx, y - 20, boxW, 20, { fill: TEAL_BG });
    hline(bx, bx + boxW, y - 20, TEAL_LINE);
    text(b.title, bx + 10, y - 14, { size: 8.5, f: bold, color: rgb(0.086, 0.396, 0.392) });
    b.wrapped.forEach((l, k) => text(l.t, bx + 10, y - 34 - k * 12.5, { size: l.big ? 10.5 : 9, f: l.b || l.big ? bold : font, color: l.big ? STRONG : INK }));
  });
  y -= boxH + 16;

  // ---------------------------------------------------------------- items table (header repeats on every page)
  const cols = [
    { k: '#', w: 22, a: 'c' },
    { k: 'HSN', w: 48, a: 'c' },
    { k: 'DESCRIPTION & SPECIFICATIONS', w: 196, a: 'l' },
    { k: 'UOM', w: 34, a: 'c' },
    { k: 'QTY', w: 54, a: 'r' },
    { k: 'RATE (Rs.)', w: 58, a: 'r' },
    { k: 'GST', w: 34, a: 'c' },
    { k: 'AMOUNT (Rs.)', w: CW - (22 + 48 + 196 + 34 + 54 + 58 + 34), a: 'r' },
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
    cols.forEach((c, i) => drawCell(c.k, i, y - 14.5, { f: bold, size: 7.6, color: STRONG }));
    y -= 22;
  };
  tableHead();
  for (const it of d.items) {
    const specs = [it.material, it.grade, it.size].filter(Boolean).join(' · ');
    const descLines = wrap(it.item, bold, 9, cols[2].w - 10);
    const specLines = specs ? wrap(specs, font, 8, cols[2].w - 10) : [];
    const rowH = Math.max(22, 8 + descLines.length * 11 + specLines.length * 10);
    if (y - rowH < M + 40) {
      newPage();
      tableHead();
    }
    const top = y;
    drawCell(String(it.line_no), 0, top - 14, { color: MUTED });
    drawCell(it.hsn || '—', 1, top - 14, { f: bold, color: INK });
    descLines.forEach((l, k) => text(l, xs[2] + 5, top - 14 - k * 11, { f: bold, size: 9, color: STRONG }));
    specLines.forEach((l, k) => text(l, xs[2] + 5, top - 14 - descLines.length * 11 + 1 - k * 10, { size: 8, color: MUTED }));
    drawCell(it.uom || 'KG', 3, top - 14);
    drawCell(Number(it.qty).toLocaleString('en-IN'), 4, top - 14, { f: bold, color: STRONG });
    drawCell(money(it.rate), 5, top - 14, { f: bold, color: STRONG });
    drawCell(`${it.gst_pct}%`, 6, top - 14);
    drawCell(money(it.amount), 7, top - 14, { f: bold, color: STRONG });
    y -= rowH;
    hline(M, M + CW, y, LINE);
  }
  y -= 16;

  // ---------------------------------------------------------------- tax summary (per GST rate), calc box, words
  type Grp = { pct: number; taxable: number };
  const groups = new Map<number, Grp>();
  for (const it of d.items) {
    const g = groups.get(it.gst_pct) ?? { pct: it.gst_pct, taxable: 0 };
    g.taxable += Number(it.qty) * Number(it.rate);
    groups.set(it.gst_pct, g);
  }
  const taxRows: { label: string; taxable: number; pct: string; tax: number }[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.pct - b.pct)) {
    if (isInter) taxRows.push({ label: 'Integrated GST (IGST)', taxable: g.taxable, pct: `${g.pct}%`, tax: (g.taxable * g.pct) / 100 });
    else {
      taxRows.push({ label: 'Central GST (CGST)', taxable: g.taxable, pct: `${g.pct / 2}%`, tax: (g.taxable * g.pct) / 200 });
      taxRows.push({ label: 'State GST (SGST)', taxable: g.taxable, pct: `${g.pct / 2}%`, tax: (g.taxable * g.pct) / 200 });
    }
  }
  const half = d.po.gst_amount / 2;
  const leftW = CW * 0.55 - 10;
  const rightW = CW * 0.45 - 6;
  const rightX = M + CW - rightW;
  const taxH = 20 + taxRows.length * 16;
  const wordsLines = wrap(rupeesInWords(d.po.total_amount), bold, 9.5, leftW - 24);
  const wordsH = 26 + wordsLines.length * 12;
  const calcRows: [string, string][] = [['Taxable Amount', `Rs. ${money(d.po.taxable_amount)}`], ...(isInter ? ([['IGST', `Rs. ${money(d.po.gst_amount)}`]] as [string, string][]) : ([['CGST', `Rs. ${money(half)}`], ['SGST', `Rs. ${money(half)}`]] as [string, string][]))];
  const blockH = Math.max(taxH + 12 + wordsH, calcRows.length * 18 + 28);
  need(blockH + 10);
  // left: tax summary
  rect(M, y - taxH, leftW, taxH, { border: LINE });
  rect(M, y - 18, leftW, 18, { fill: HEAD_BG });
  // label | taxable value (right-aligned) | rate | tax amount (right-aligned)
  const tx = [M + 8, M + leftW * 0.6, M + leftW * 0.67, M + leftW - 8];
  text('TAX SUMMARY', tx[0], y - 12, { size: 7.6, f: bold, color: MUTED });
  text('TAXABLE VALUE', tx[1], y - 12, { size: 7.6, f: bold, color: MUTED, right: tx[1] });
  text('RATE', tx[2], y - 12, { size: 7.6, f: bold, color: MUTED });
  text('TAX AMOUNT', tx[3], y - 12, { size: 7.6, f: bold, color: MUTED, right: tx[3] });
  taxRows.forEach((r, i) => {
    const ry = y - 18 - (i + 1) * 16;
    text(r.label, tx[0], ry + 5, { size: 8.8, f: bold, color: INK });
    text(money(r.taxable), tx[1], ry + 5, { size: 8.8, right: tx[1] });
    text(r.pct, tx[2], ry + 5, { size: 8.8 });
    text(money(r.tax), tx[3], ry + 5, { size: 8.8, f: bold, right: tx[3] });
  });
  // left: words
  const wy = y - taxH - 12;
  rect(M, wy - wordsH, leftW, wordsH, { fill: TEAL_BG, border: TEAL_LINE });
  rect(M, wy - wordsH, 4, wordsH, { fill: TEAL });
  text('AMOUNT IN WORDS', M + 14, wy - 13, { size: 7.6, f: bold, color: rgb(0.086, 0.396, 0.392) });
  wordsLines.forEach((l, i) => text(l, M + 14, wy - 26 - i * 12, { size: 9.5, f: bold, color: STRONG }));
  // right: calc
  calcRows.forEach(([k, v], i) => {
    const ry = y - (i + 1) * 18;
    text(k, rightX + 8, ry + 5, { size: 9.5, color: MUTED });
    text(v, rightX + rightW - 8, ry + 5, { size: 9.5, f: bold, color: STRONG, right: rightX + rightW - 8 });
  });
  const gy = y - calcRows.length * 18 - 4;
  rect(rightX, gy - 26, rightW, 26, { fill: NAVY });
  text('GRAND TOTAL', rightX + 10, gy - 17, { size: 10.5, f: bold, color: rgb(1, 1, 1) });
  text(`Rs. ${money(d.po.total_amount)}`, rightX + rightW - 10, gy - 17, { size: 11, f: bold, color: rgb(1, 1, 1), right: rightX + rightW - 10 });
  y -= blockH + 18;

  // ---------------------------------------------------------------- terms
  const terms = [
    `Payment as per agreed terms: ${d.po.payment_terms || '30 Days'}.`,
    'Material must match the approved drawing / specification / grade in all respects.',
    'Quote this PO number on all invoices, delivery challans and correspondence.',
    "Goods rejected on inspection are to be replaced at supplier's cost.",
    ...(d.po.other_terms ? [`Special Note: ${d.po.other_terms}`] : []),
  ];
  const termLines = terms.map((t, i) => wrap(`${i + 1}. ${t}`, font, 9, CW - 28));
  const termsH = 24 + termLines.reduce((a, l) => a + l.length * 12, 0) + 8;
  need(termsH + 10);
  rect(M, y - termsH, CW, termsH, { border: LINE });
  text('TERMS & CONDITIONS', M + 12, y - 15, { size: 8.5, f: bold, color: MUTED });
  let ty = y - 29;
  for (const lines of termLines) {
    for (const l of lines) {
      text(l, M + 14, ty, { size: 9, color: rgb(0.278, 0.333, 0.412) });
      ty -= 12;
    }
  }
  y -= termsH + 22;

  // ---------------------------------------------------------------- approval block
  const approvalH = 78;
  need(approvalH + 10);
  const colW = CW / 3;
  const blocks: [string, string, string][] = [
    ['PREPARED BY', d.po.created_by || 'Purchase Team', ''],
    ['APPROVED BY', d.po.approved_by || 'Pending', stamp(d.po.approved_at)],
    ['RELEASED / AUTHORISED', d.po.released_by || d.company.name, stamp(d.po.released_at)],
  ];
  blocks.forEach(([title, who, when], i) => {
    const bx = M + i * colW + 14;
    const bw = colW - 28;
    hline(bx, bx + bw, y - 44, rgb(0.8, 0.835, 0.882), 0.8);
    text(title, bx + bw / 2, y - 56, { size: 8, f: bold, color: MUTED, center: bx + bw / 2 });
    text(who, bx + bw / 2, y - 67, { size: 8.5, color: STRONG, center: bx + bw / 2 });
    if (when) text(when, bx + bw / 2, y - 77, { size: 7.5, color: MUTED, center: bx + bw / 2 });
  });
  y -= approvalH;

  // ---------------------------------------------------------------- footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    // no rule and no PO number down here: the PO number is in the header box already
    text('This is a computer-generated purchase order.', M, M + 4, { size: 7.5, color: rgb(0.58, 0.64, 0.72) });
    if (pages.length > 1) text(`Page ${i + 1} of ${pages.length}`, PAGE_W - M, M + 4, { size: 7.5, color: rgb(0.58, 0.64, 0.72), right: PAGE_W - M });
  });

  pdf.setTitle(`Purchase Order ${poLabel}`);
  pdf.setAuthor(d.company.name);
  pdf.setCreator('ForgeFlow ERP');
  return await pdf.save();
}
