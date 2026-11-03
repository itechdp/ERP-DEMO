// The company's Excel form layout, shared by every document that is downloaded as a sheet:
//   logo (left) · Form No. / Rev. No. & Date (right)  →  title  →  detail lines  →  table(s)  →  notes  →  Checked By / Reviewed By
// To add a new sheet, build a SheetSpec and call downloadFormSheet(); the header and footer come for free.
import writeExcelFile from 'write-excel-file/browser';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isNative, saveFile } from '../native/native';

/** Form number and revision printed on top of each sheet — change them here, in one place. */
export const FORM_FORMATS = {
  quotation: { formNo: 'F SL 01', revision: '00 / 01.10.25' },
  purchaseOrder: { formNo: 'F PU 01', revision: '00 / 01.10.25' },
  taskReport: { formNo: 'F WH 01', revision: '00 / 01.10.25' },
  report: { formNo: 'F RP 01', revision: '00 / 01.10.25' },
  packingList: { formNo: 'F DS 01', revision: '00 / 01.10.25' },
  qcFinalInspection: { formNo: 'F QC 01', revision: '00 / 01.10.25' },
  salesOrder: { formNo: 'F SL 02', revision: '00 / 01.10.25' },
  purchaseRequisition: { formNo: 'F PU 02', revision: '00 / 01.10.25' },
  procurementRequest: { formNo: 'F PU 03', revision: '00 / 01.10.25' },
  supplierQuotation: { formNo: 'F PU 04', revision: '00 / 01.10.25' },
  quotationComparison: { formNo: 'F PU 05', revision: '00 / 01.10.25' },
  goodsReceipt: { formNo: 'F ST 01', revision: '00 / 01.10.25' },
  purchaseInvoice: { formNo: 'F AC 01', revision: '00 / 01.10.25' },
  paymentVoucher: { formNo: 'F AC 02', revision: '00 / 01.10.25' },
  payables: { formNo: 'F AC 03', revision: '00 / 01.10.25' },
  routeCard: { formNo: 'F PD 03', revision: '00 / 01.10.25' },
  jobWorkIn: { formNo: 'F JW 01', revision: '00 / 01.10.25' },
  jobWorkOut: { formNo: 'F JW 02', revision: '00 / 01.10.25' },
  hardnessReport: { formNo: 'F QC 03', revision: '00 / 01.10.25' },
  qcRecord: { formNo: 'F QC 02', revision: '00 / 01.10.25' },
} as const;
export type FormFormat = { formNo: string; revision: string };

export type SheetValue = string | number | null | undefined;
export interface SheetRow {
  cells: SheetValue[];
  bold?: boolean;
}
export interface SheetBlock {
  heading?: string;
  headers: string[];
  /** how many sheet columns each header/cell spans; must add up to the number of sheet columns */
  spans?: number[];
  align?: ('left' | 'right' | 'center')[];
  rows: SheetRow[];
}
export interface SheetSpec {
  filename: string;
  sheet: string;
  form: FormFormat;
  title: string;
  /** the detail lines under the title, up to three "Label :- value" texts per line */
  info?: string[][];
  /** column widths of the sheet */
  widths: number[];
  blocks: SheetBlock[];
  notes?: string[];
  /** the signed-in user */
  checkedBy: string;
  reviewedBy?: string;
}

export type Cell = {
  value?: string | number;
  type?: StringConstructor | NumberConstructor;
  fontWeight?: 'bold';
  fontSize?: number;
  height?: number;
  format?: string;
  backgroundColor?: string;
  align?: 'left' | 'right' | 'center';
  alignVertical?: 'top' | 'center' | 'bottom';
  wrap?: boolean;
  columnSpan?: number;
  borderColor?: string;
  borderStyle?: string;
} | null;

const LINE = { borderColor: '#000000', borderStyle: 'thin' };
const txt = (v: string, extra: object = {}): Cell => ({ value: v, type: String, alignVertical: 'center', ...extra });
const val = (v: SheetValue, extra: object = {}): Cell => {
  if (v == null || v === '') return { value: '', type: String, alignVertical: 'center', ...extra };
  if (typeof v === 'number') return { value: v, type: Number, alignVertical: 'center', ...(Number.isInteger(v) ? {} : { format: '#,##0.00' }), ...extra };
  return txt(v, extra);
};

async function logo(logoHeight = 34): Promise<{ content: Blob; width: number; height: number } | null> {
  try {
    const res = await fetch('/everest-logo.png');
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const height = logoHeight; // 34 fits the standard two header rows; a sheet with taller header rows can ask for more
    return { content: blob, width: Math.round((bmp.width / bmp.height) * height), height };
  } catch {
    return null;
  }
}

export async function downloadFormSheet(spec: SheetSpec) {
  const n = spec.widths.length;
  const pad = (cells: Cell[]): Cell[] => [...cells, ...Array<Cell>(Math.max(0, n - cells.reduce((t, c) => t + (c?.columnSpan ?? 1), 0)))];
  const data: Cell[][] = [];
  // the row height is a style of the row's first cell
  const rowAt = (cells: Cell[], height?: number) => {
    data.push(height && cells[0] ? [{ ...cells[0], height } as Cell, ...cells.slice(1)] : cells);
  };
  // the cells hidden under a merged (columnSpan) cell must be null — the writer copies the merged cell's style and borders into them
  const blank = (cols: number): Cell[] => Array.from({ length: cols }, () => null);

  // ---- header: logo box (left) and form number (right)
  const rightSpan = Math.min(3, Math.max(1, Math.floor(n / 3)));
  const leftSpan = n - rightSpan;
  rowAt([{ value: '', type: String, columnSpan: leftSpan, ...LINE }, ...blank(leftSpan - 1), txt(`Form No. : ${spec.form.formNo}`, { columnSpan: rightSpan, fontWeight: 'bold', align: 'center', ...LINE }), ...blank(rightSpan - 1)], 26);
  rowAt([{ value: '', type: String, columnSpan: leftSpan, ...LINE }, ...blank(leftSpan - 1), txt(`Rev. No. & Date : ${spec.form.revision}`, { columnSpan: rightSpan, fontWeight: 'bold', align: 'center', ...LINE }), ...blank(rightSpan - 1)], 26);
  rowAt(pad([txt(spec.title.toUpperCase(), { columnSpan: n, fontWeight: 'bold', fontSize: 13, align: 'center', ...LINE })]), 26);

  // ---- detail lines
  for (const line of spec.info ?? []) {
    const parts = line.filter(Boolean);
    const base = Math.floor(n / parts.length);
    const cells: Cell[] = [];
    parts.forEach((p, i) => {
      const span = i === parts.length - 1 ? n - base * (parts.length - 1) : base;
      cells.push(txt(p, { columnSpan: span, ...LINE }), ...blank(span - 1));
    });
    rowAt(cells, 22);
  }

  // ---- tables
  for (const b of spec.blocks) {
    const spans = b.spans ?? Array(b.headers.length).fill(1);
    const fill = (cells: Cell[], i: number) => [cells[0], ...blank(spans[i] - 1)];
    if (b.heading) rowAt(pad([txt(b.heading, { columnSpan: n, fontWeight: 'bold', backgroundColor: '#f1f5f9', ...LINE })]), 22);
    rowAt(
      b.headers.flatMap((h, i) => fill([txt(h, { columnSpan: spans[i], fontWeight: 'bold', align: 'center', wrap: true, backgroundColor: '#e8eef5', ...LINE })], i)),
      30,
    );
    for (const r of b.rows) {
      rowAt(
        b.headers.flatMap((_, i) => {
          const align = b.align?.[i] ?? (typeof r.cells[i] === 'number' ? 'right' : 'left');
          return fill([val(r.cells[i], { columnSpan: spans[i], align, wrap: true, ...(r.bold ? { fontWeight: 'bold' } : {}), ...LINE })], i);
        }),
        20,
      );
    }
  }

  // ---- notes and sign-off
  for (const note of spec.notes ?? []) rowAt(pad([txt(note, { columnSpan: n, wrap: true, ...LINE })]), 22);
  const half = Math.floor(n / 2);
  rowAt([txt(`Checked By : ${spec.checkedBy}`, { columnSpan: half, fontWeight: 'bold', ...LINE }), ...blank(half - 1), txt(`Reviewed By : ${spec.reviewedBy ?? ''}`, { columnSpan: n - half, fontWeight: 'bold', ...LINE }), ...blank(n - half - 1)], 26);

  const img = await logo();
  const file = writeExcelFile(data as never, {
    columns: spec.widths.map((width) => ({ width })),
    sheet: spec.sheet.slice(0, 31),
    ...(img ? { images: [{ content: img.content, contentType: 'image/png', width: img.width, height: img.height, dpi: 96, anchor: { row: 1, column: 1 }, offsetX: 6, offsetY: 5 }] } : {}),
  } as never);
  const name = spec.filename.endsWith('.xlsx') ? spec.filename : spec.filename + '.xlsx';
  if (isNative()) await saveFile(name, await file.toBlob());
  else await file.toFile(name);
}

/** pieces shared with the other exporters that need a layout the standard form does not cover (e.g. the dimension report) */
export const sheetParts = { LINE, txt, val, logo };

export interface PageSetup {
  orientation: 'portrait' | 'landscape';
  /** the print area: A1 up to this column and row (the report only, not the blank cells around it) */
  lastColumn: string;
  lastRow: number;
}

/**
 * Print settings the Excel writer has no option for, written straight into the file: A4, fitted to ONE page, centred, with margins and a
 * print area that covers the report only.
 */
export function applyPageSetup(xlsx: Uint8Array, sheetName: string, page: PageSetup): Uint8Array {
  const files = unzipSync(xlsx);
  const sheetPath = Object.keys(files).find((k) => /^xl\/worksheets\/sheet1\.xml$/.test(k));
  const bookPath = 'xl/workbook.xml';
  if (!sheetPath || !files[bookPath]) return xlsx;
  let sheet = strFromU8(files[sheetPath]);
  const fit = '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
  const tail =
    '<printOptions horizontalCentered="1"/>' +
    '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
    `<pageSetup paperSize="9" orientation="${page.orientation}" fitToWidth="1" fitToHeight="1"/>`;
  if (!sheet.includes('<sheetPr')) sheet = sheet.replace(/(<worksheet[^>]*>)/, `$1${fit}`);
  // the writer already puts a basic page setup (paper size and orientation): replace it with the complete one
  sheet = sheet.replace(/<printOptions[^>]*\/>/g, '').replace(/<pageMargins[^>]*\/>/g, '').replace(/<pageSetup[^>]*\/>/g, '');
  sheet = sheet.includes('<drawing') ? sheet.replace('<drawing', `${tail}<drawing`) : sheet.replace('</worksheet>', `${tail}</worksheet>`);
  files[sheetPath] = strToU8(sheet);

  let book = strFromU8(files[bookPath]);
  const name = `'${sheetName.slice(0, 31).replace(/'/g, "''")}'`;
  const area = `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${name}!$A$1:$${page.lastColumn}$${page.lastRow}</definedName></definedNames>`;
  book = book.includes('<definedNames/>') ? book.replace('<definedNames/>', area) : book.includes('</definedNames>') ? book.replace('</definedNames>', `${area.slice('<definedNames>'.length, -'</definedNames>'.length)}</definedNames>`) : book.replace('</sheets>', `</sheets>${area}`);
  files[bookPath] = strToU8(book);
  return zipSync(files);
}

/** write a ready-made sheet (rows of cells) with the company logo in the top-left box */
export async function saveSheet(data: Cell[][], widths: number[], sheet: string, filename: string, logoHeight?: number, page?: PageSetup) {
  const img = await logo(logoHeight);
  const file = writeExcelFile(data as never, {
    columns: widths.map((width) => ({ width })),
    sheet: sheet.slice(0, 31),
    ...(page ? { orientation: page.orientation } : {}),
    ...(img ? { images: [{ content: img.content, contentType: 'image/png', width: img.width, height: img.height, dpi: 96, anchor: { row: 1, column: 1 }, offsetX: 6, offsetY: 5 }] } : {}),
  } as never);
  const name = filename.endsWith('.xlsx') ? filename : filename + '.xlsx';
  let blob: Blob = await file.toBlob();
  if (page) blob = new Blob([applyPageSetup(new Uint8Array(await blob.arrayBuffer()), sheet, page) as BlobPart], { type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (isNative()) return saveFile(name, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
