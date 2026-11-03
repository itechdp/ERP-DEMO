// The Dimension Report as the company's final-inspection sheet — Excel and print / PDF with the same layout:
//   logo · Form No. / Rev.  →  title  →  item / customer / report lines  →  parameter table (tolerances + 5 observations + result)  →
//   conclusion · customer approval · remarks · checked by · reviewed by
// Column widths, row heights, label wording, plain headings and which lines are boxed follow the paper sheet.
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import { FORM_FORMATS, saveSheet, sheetParts, type Cell } from '../export/xlsxSheet';
import { dmy, esc } from '../sales/print';
import { SAMPLES, lineResult, sampleOk, type DimLine, type DimReport } from './types';

const { LINE, txt, val } = sheetParts;
const COLS = 12; // Sr · Parameter · Instrument · Specification · USL · LSL · 1–5 · Result
/** column widths in characters, the ORIGINAL workbook's column widths, exactly as given (A to L) — never rounded or recalculated */
const ORIGINAL_WIDTHS = [4.28515625, 23.7109375, 21.28515625, 18.140625, 15.7109375, 13, 15, 13, 13, 15, 13, 16];
const WIDTHS = ORIGINAL_WIDTHS;
/** rows 4 to 12 (the item / customer / report lines, both heading rows and the first four parameter lines) are made almost twice as tall */
const TALL = 1.8;
/** rows 1 and 2 (the merged logo block): heights in points, and the logo is sized from them — 1 pt = 4/3 px, minus a margin — so it always fits inside */
const HEAD_ROW_1 = 30;
const HEAD_ROW_2 = 30;
const LOGO_PX = Math.floor(((HEAD_ROW_1 + HEAD_ROW_2) * 4) / 3 - 20);
const TALL_FROM = 4;
const TALL_TO = 12;
const conclusionText = (r: DimReport) => `Conclusion : ${r.conclusion || 'Lot Accepted / Rejected / Accepted Under deviation.'}`;

// ---------------------------------------------------------------- Excel
/** the sheet is set in Arial 10, like the paper form */
const FONT = { fontFamily: 'Arial', fontSize: 10 };
const T = (v: string, extra: object = {}): Cell => txt(v, { ...FONT, ...extra });

type Edge = 'thin' | 'medium' | undefined;
/** borders side by side: left, right, top, bottom */
const edges = (l: Edge, r: Edge, t: Edge, b: Edge) => ({
  ...(l ? { leftBorderColor: '#000000', leftBorderStyle: l } : {}),
  ...(r ? { rightBorderColor: '#000000', rightBorderStyle: r } : {}),
  ...(t ? { topBorderColor: '#000000', topBorderStyle: t } : {}),
  ...(b ? { bottomBorderColor: '#000000', bottomBorderStyle: b } : {}),
});

const CENTER = { align: 'center' as const, alignVertical: 'center' as const };

/** a typed number keeps its decimals ("90.0", "17.50"); anything else stays text */
function cell(v: string, extra: object = {}): Cell {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const d = t.includes('.') ? t.split('.')[1].length : 0;
    return { value: Number(t), type: Number, format: d ? `0.${'0'.repeat(d)}` : '0', ...FONT, ...CENTER, ...LINE, ...extra } as Cell;
  }
  return val(t, { ...FONT, ...CENTER, ...LINE, ...extra });
}

/** the sheet's rows and column widths (separate from the download so it can be checked on its own) */
export function buildDimensionSheet(r: DimReport, user: string): { data: Cell[][]; widths: number[] } {
  const data: Cell[][] = [];
  // cells hidden under a merged (columnSpan) cell must be null; the writer copies the merged cell's borders into them
  const hidden = (n: number): Cell[] => Array.from({ length: n }, () => null);
  const empty = (n: number): Cell[] => Array.from({ length: n }, () => ({ value: '', type: String, ...LINE }) as Cell);
  const row = (cells: Cell[], height?: number) => data.push(height && cells[0] ? [{ ...cells[0], height } as Cell, ...cells.slice(1)] : cells);
  const span = (text: string, n: number, extra: object = {}): Cell[] => [T(text, { columnSpan: n, alignVertical: 'center', ...extra }), ...hidden(n - 1)];

  // company header (rows 1 and 2 are HEAD_ROW_1 / HEAD_ROW_2 pt and the logo is LOGO_PX px, always inside them): one tall, clean block for the logo (columns A–I: outer line only — no boxes inside it) and the Form No. / Rev. No. & Date box (J–L)
  const logoBlock = (top: boolean): Cell => ({ value: '', type: String, columnSpan: 9, ...edges('thin', undefined, top ? 'thin' : undefined, top ? undefined : 'thin') }) as Cell;
  const formCell = (text: string): Cell[] => span(text, 3, { fontWeight: 'bold', align: 'center', ...LINE });
  row([logoBlock(true), ...hidden(8), ...formCell(`Form No. : ${FORM_FORMATS.qcFinalInspection.formNo}`)], HEAD_ROW_1);
  row([logoBlock(false), ...hidden(8), ...formCell(`Rev. No. & Date : ${FORM_FORMATS.qcFinalInspection.revision}`)], HEAD_ROW_2);
  row(span('FINAL INSPECTION', COLS, { fontWeight: 'bold', fontSize: 14, align: 'center', ...LINE }), 36);

  // item · customer · report lines: plain text, boxed only on the outside (no lines between them)
  const info = (a: string, b: string, c: string) => row([...span(a, 4, edges('thin', undefined, undefined, undefined)), ...span(b, 4), ...span(c, 4, edges(undefined, 'thin', undefined, undefined))], 23.25);
  info(`Item Name :- ${r.itemName}`, `Item No. :- ${r.itemNo}`, `Inspection Report No :- ${r.reportNo}`);
  info(`Customer Name :- ${r.customer}`, `Invoice Date :- ${r.invoiceDate ? dmy(r.invoiceDate) : ''}`, `Inspection Date:- ${dmy(r.reportDate)}`);
  info(`Die No:- ${r.dieNo}`, `Lot / Invoice Qty. :- ${r.invoiceQty}`, '');

  // two-level column headings (plain weight, heavier line underneath). No merged rows — the Excel writer refuses them next to merged
  // columns — so the heading sits in the upper cell, the lower one is empty and the line between them is left out.
  const upper = (text: string): Cell => T(text, { ...CENTER, alignVertical: 'bottom', wrap: true, ...edges('thin', 'thin', 'thin', undefined) });
  const lower = (): Cell => ({ value: '', type: String, ...edges('thin', 'thin', undefined, 'medium') }) as Cell;
  const sub = (text: string | number): Cell =>
    typeof text === 'number'
      ? ({ value: text, type: Number, ...FONT, ...CENTER, ...edges('thin', 'thin', 'thin', 'medium') } as Cell)
      : T(text, { ...CENTER, ...edges('thin', 'thin', 'thin', 'medium') });
  row([upper('Sr. No.'), upper('Parameter'), upper('Measuring Instrument'), upper('Specification'), ...span('TOLERENCES', 2, { ...CENTER, ...LINE }), ...span('Observation on Samples', SAMPLES, { ...CENTER, ...LINE }), upper('Result')], 19.5);
  row([lower(), lower(), lower(), lower(), sub('USL'), sub('LSL'), ...Array.from({ length: SAMPLES }, (_, i) => sub(i + 1)), lower()], 19.5);

  // lines
  r.lines.forEach((l: DimLine, i) => {
    const samples = l.samples.map((s) => (l.kind === 'measure' ? cell(s) : T(s, { ...CENTER, ...LINE })));
    row(
      [
        cell(String(i + 1)),
        T(l.parameter.toUpperCase(), { ...CENTER, ...LINE }),
        T(l.instrument, { ...CENTER, ...LINE }),
        l.kind === 'measure' ? cell(l.spec) : T(l.spec, { ...CENTER, ...LINE }),
        ...(l.kind === 'gonogo' ? [T('Go & Nogo', { columnSpan: 2, ...CENTER, ...LINE }), ...hidden(1)] : l.kind === 'text' ? empty(2) : [cell(l.usl), cell(l.lsl)]),
        ...samples,
        T(lineResult(l), { ...CENTER, ...LINE }),
      ],
      26.5, // the original's two merged rows per line: 15.6 + 10.9 pt
    );
  });

  // conclusion · approval · remarks · sign-off: boxed on the outside, a line between the rows, the last line heavier
  const foot = (a: string, b: string, h: number, last = false) =>
    row([...span(a, 8, { fontWeight: 'bold', ...edges('thin', undefined, 'thin', last ? 'medium' : 'thin') }), ...span(b, 4, { fontWeight: 'bold', ...edges(undefined, 'thin', 'thin', last ? 'medium' : 'thin') })], h);
  foot(conclusionText(r), `Customer Approval ( If required ) : ${r.customerApproval}`, 21);
  row(span(`Remarks (If any) : ${r.remarks}`, COLS, { fontWeight: 'bold', wrap: true, alignVertical: 'top', ...edges('thin', 'thin', 'thin', 'thin') }), 45.6);
  foot(`Checked By : ${r.checkedBy || user}`, `Reviewed By : ${r.reviewedBy}`, 21, true);

  for (let i = TALL_FROM - 1; i < Math.min(TALL_TO, data.length); i++) {
    const first = data[i][0] as { height?: number } | null;
    if (first?.height) first.height = Math.round(first.height * TALL * 100) / 100;
  }
  return { data, widths: WIDTHS };
}

export async function exportDimensionXlsx(r: DimReport, user: string) {
  const { data, widths } = buildDimensionSheet(r, user);
  await saveSheet(data, widths, r.reportNo, `Dimension-Report-${r.reportNo}`, LOGO_PX, { orientation: 'portrait', lastColumn: 'L', lastRow: data.length, merges: ['A1:I2'] }); // A4, one page, print area = the report; the logo block is one cell over rows 1 and 2
}

// ---------------------------------------------------------------- print / PDF
const total = WIDTHS.reduce((a, b) => a + b, 0);
const COLGROUP = `<colgroup>${WIDTHS.map((w) => `<col style="width:${((w / total) * 100).toFixed(2)}%"/>`).join('')}</colgroup>`;
const DIM_CSS = `
.dm{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px}
.dm td,.dm th{border:1px solid #14284b;padding:3px 3px;text-align:center;vertical-align:middle;line-height:1.25;word-break:break-word}
.dm th{font-weight:400;background:#fff}
.dm tr.top td{height:58px}
.dm td.logo{text-align:left;padding:6px 10px}
.dm td.logo img{height:60px;display:block}
.dm td.form{font-weight:700;font-size:11px}
.dm tr.title td{height:36px;font-weight:700;font-size:15px}
.dm tr.info td{border-top:0;border-bottom:0;border-left:0;border-right:0;text-align:left;padding:5px 8px;height:41px}
.dm tr.h1 th,.dm tr.head2 th{height:35px}
.dm tr.info td:first-child{border-left:1px solid #14284b}
.dm tr.info td:last-child{border-right:1px solid #14284b}
.dm tr.head2 th{border-bottom:2px solid #14284b}
.dm tr.ln td{height:27px}
.dm tr.ln.tl td{height:48px}
.dm .ng{background:#fde8e8;color:#b00020;font-weight:700}
.dm .res{font-weight:400}
.dm tr.foot td{text-align:left;font-weight:700;padding:5px 8px}
.dm tr.foot td:first-child{border-right:0}
.dm tr.foot td:last-child{border-left:0}
.dm tr.tall td{height:46px;vertical-align:top;padding:6px 8px}
.dm tr.last td{border-bottom:2px solid #14284b}
`;

export function dimensionHtml(r: DimReport) {
  const rows = r.lines
    .map((l, i) => {
      const res = lineResult(l);
      const obs = l.samples.map((s) => `<td${sampleOk(l, s) === false ? ' class="ng"' : ''}>${esc(s)}</td>`).join('');
      const tol = l.kind === 'gonogo' ? '<td colspan="2">Go &amp; Nogo</td>' : l.kind === 'text' ? '<td></td><td></td>' : `<td>${esc(l.usl)}</td><td>${esc(l.lsl)}</td>`;
      return `<tr class="ln${i < TALL_TO - 8 ? ' tl' : ''}"><td>${i + 1}</td><td>${esc(l.parameter.toUpperCase())}</td><td>${esc(l.instrument)}</td><td>${esc(l.spec)}</td>${tol}${obs}<td class="res${res === 'NOT OK' ? ' ng' : ''}">${esc(res)}</td></tr>`;
    })
    .join('');
  return `<div class="rc sd pl">
  <table class="dm">
    ${COLGROUP}
    <tr class="top"><td colspan="9" rowspan="2" class="logo"><img src="/everest-logo.png" alt="Everest Auto Forge"/></td><td colspan="3" class="form">Form No. : ${FORM_FORMATS.qcFinalInspection.formNo}</td></tr>
    <tr class="top"><td colspan="3" class="form">Rev. No. &amp; Date : ${FORM_FORMATS.qcFinalInspection.revision}</td></tr>
    <tr class="title"><td colspan="12">FINAL INSPECTION</td></tr>
    <tr class="info"><td colspan="4">Item Name :- ${esc(r.itemName)}</td><td colspan="4">Item No. :- ${esc(r.itemNo)}</td><td colspan="4">Inspection Report No :- ${esc(r.reportNo)}</td></tr>
    <tr class="info"><td colspan="4">Customer Name :- ${esc(r.customer)}</td><td colspan="4">Invoice Date :- ${r.invoiceDate ? dmy(r.invoiceDate) : ''}</td><td colspan="4">Inspection Date:- ${dmy(r.reportDate)}</td></tr>
    <tr class="info"><td colspan="4">Die No:- ${esc(r.dieNo)}</td><td colspan="4">Lot / Invoice Qty. :- ${esc(r.invoiceQty)}</td><td colspan="4"></td></tr>
    <tr class="h1"><th rowspan="2">Sr. No.</th><th rowspan="2">Parameter</th><th rowspan="2">Measuring Instrument</th><th rowspan="2">Specification</th><th colspan="2">TOLERENCES</th><th colspan="${SAMPLES}">Observation on Samples</th><th rowspan="2">Result</th></tr>
    <tr class="head2"><th>USL</th><th>LSL</th>${Array.from({ length: SAMPLES }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr>
    ${rows}
    <tr class="foot"><td colspan="8">${esc(conclusionText(r))}</td><td colspan="4">Customer Approval ( If required ) : ${esc(r.customerApproval)}</td></tr>
    <tr class="foot tall"><td colspan="12">Remarks (If any) : ${esc(r.remarks)}</td></tr>
    <tr class="foot last"><td colspan="8">Checked By : ${esc(r.checkedBy)}</td><td colspan="4">Reviewed By : ${esc(r.reviewedBy)}</td></tr>
  </table>
</div>`;
}

export const printDimensionReport = (r: DimReport) => printHtml(`Dimension Report ${r.reportNo}`, dimensionHtml(r), ROUTE_CARD_CSS + DIM_CSS);
