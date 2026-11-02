// Table exports (the report pages). Numbers stay numbers so a sheet can add them up.
// The sheet itself — logo, form number, title, "Checked By" — comes from the shared company layout in xlsxSheet.ts.
import { FORM_FORMATS, downloadFormSheet, type SheetValue } from './xlsxSheet';

export interface XlsxCol {
  key: string;
  label: string;
  kind?: 'text' | 'num' | 'money' | 'pct' | 'date' | 'badge' | string;
  total?: boolean;
}
type Row = Record<string, unknown>;

const cell = (v: unknown, kind?: string): SheetValue => {
  if (v == null || v === '') return null;
  if (kind === 'num' || kind === 'money' || kind === 'pct') {
    const x = Number(v);
    return Number.isNaN(x) ? String(v) : Math.round(x * 1000) / 1000;
  }
  if (kind === 'date') return String(v).slice(0, 10);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

/** `user` is the signed-in person; it is printed as "Checked By". */
export async function downloadXlsx(filename: string, sheet: string, cols: XlsxCol[], rows: Row[], totals?: Row | null, user = '') {
  const body = rows.map((r, i) => ({ cells: [i + 1, ...cols.map((c) => cell(r[c.key], c.kind))] as SheetValue[] }));
  if (totals) body.push({ cells: ['', 'Total', ...cols.slice(1).map((c) => (c.total ? cell(totals[c.key], c.kind) : null))] as SheetValue[], bold: true } as never);
  await downloadFormSheet({
    filename,
    sheet,
    form: FORM_FORMATS.report,
    title: sheet,
    info: [[`Report :- ${sheet}`, `Date :- ${today()}`, `Rows :- ${rows.length}`]],
    widths: [8, ...cols.map((c) => Math.max(12, Math.min(34, c.label.length + 4)))],
    blocks: [{ headers: ['Sr. No.', ...cols.map((c) => c.label)], align: ['center'], rows: body }],
    checkedBy: user,
  });
}
