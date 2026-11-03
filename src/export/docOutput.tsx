// One definition, two outputs. A document is described once as a SheetSpec (src/export/xlsxSheet.ts: the company form layout — logo,
// form number, title, detail lines, tables, notes, Checked By / Reviewed By); the Excel sheet is written from it, and the PDF (the print
// dialog → "Save as PDF") is drawn from the SAME description, so the two always carry the same content.
import { useState } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { currentUserName } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import { useStore } from '../store/StoreContext';
import { dmy, esc } from '../sales/print';
import { downloadFormSheet, type SheetBlock, type SheetSpec, type SheetValue } from './xlsxSheet';

// ---------------------------------------------------------------- PDF from the same description
const SPEC_CSS = `
.sp{font-size:11px}
.sp table{width:100%;border-collapse:collapse;table-layout:fixed}
.sp .sp-info td{padding:4px 8px;text-align:left;vertical-align:top;font-size:11.5px}
.sp .sp-tbl th,.sp .sp-tbl td{border:1px solid #14284b;padding:4px 5px;vertical-align:middle;line-height:1.25;word-break:break-word}
.sp .sp-tbl th{font-weight:700;background:#eaf0f7;text-align:center}
.sp .sp-tbl tr.b td{font-weight:700;background:#f6f8fb}
.sp .sp-h{font-weight:700;padding:6px 8px;background:#f1f5f9;border:1px solid #14284b;border-bottom:0;margin-top:10px}
.sp .sp-note{border:1px solid #14284b;padding:6px 8px;margin-top:6px;font-size:11px;white-space:pre-wrap}
.sp .sp-sign td{border:1px solid #14284b;padding:10px 8px;font-weight:700;height:38px;vertical-align:bottom}
.sp .sp-foot{margin-top:6px;font-size:9.5px;color:#555;display:flex;justify-content:space-between}
`;

const money = (v: SheetValue) => {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return String(v);
};

function blockHtml(b: SheetBlock, widths: number[]) {
  const spans = b.spans ?? Array(b.headers.length).fill(1);
  const total = widths.reduce((t, w) => t + w, 0);
  let at = 0;
  const cols = spans.map((sp) => {
    const w = widths.slice(at, at + sp).reduce((t, x) => t + x, 0);
    at += sp;
    return `<col style="width:${((w / total) * 100).toFixed(2)}%"/>`;
  });
  const al = (i: number, v: SheetValue) => b.align?.[i] ?? (typeof v === 'number' ? 'right' : 'left');
  return `${b.heading ? `<div class="sp-h">${esc(b.heading)}</div>` : ''}<table class="sp-tbl"><colgroup>${cols.join('')}</colgroup>
  <thead><tr>${b.headers.map((h, i) => `<th colspan="${spans[i]}">${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${b.rows.map((r) => `<tr class="${r.bold ? 'b' : ''}">${b.headers.map((_, i) => `<td colspan="${spans[i]}" style="text-align:${al(i, r.cells[i])};white-space:pre-line">${esc(money(r.cells[i]))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function specHtml(spec: SheetSpec) {
  const info = (spec.info ?? [])
    .map((line) => {
      const parts = line.filter(Boolean);
      return parts.length ? `<tr>${parts.map((p) => `<td colspan="${Math.floor(12 / parts.length)}">${esc(p)}</td>`).join('')}</tr>` : '';
    })
    .join('');
  return `<div class="rc sd sp">
  <table class="hd">
    <tr><td style="width:34%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td class="ttl">${esc(spec.title.toUpperCase())}</td>
        <td class="fm" style="width:24%">Form No. : ${esc(spec.form.formNo)}<br/>Rev. No. &amp; Date : ${esc(spec.form.revision)}</td></tr>
  </table>
  ${info ? `<table class="sp-info"><colgroup>${Array.from({ length: 12 }, () => '<col/>').join('')}</colgroup>${info}</table>` : ''}
  ${spec.blocks.map((b) => blockHtml(b, spec.widths)).join('')}
  ${(spec.notes ?? []).map((n) => `<div class="sp-note">${esc(n)}</div>`).join('')}
  <table class="sp-sign" style="margin-top:10px"><tr><td>Checked By : ${esc(spec.checkedBy)}</td><td>Reviewed By : ${esc(spec.reviewedBy ?? '')}</td></tr></table>
  <div class="sp-foot"><span>Everest Auto Forge Pvt. Ltd.</span><span>${esc(spec.title)} · printed ${dmy(new Date().toISOString())}</span></div>
</div>`;
}

export const printSpec = (spec: SheetSpec) => printHtml(spec.title, specHtml(spec), ROUTE_CARD_CSS + SPEC_CSS);

// ---------------------------------------------------------------- the buttons
type Build = (user: string) => SheetSpec | Promise<SheetSpec>;

/** Excel + PDF for one document. `compact` gives two small icons for a table row. */
export function DocButtons({ build, compact = false, only }: { build: Build; compact?: boolean; only?: 'excel' | 'pdf' }) {
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const go = async (kind: 'excel' | 'pdf') => {
    if (busy) return; // a second push while it is being made does nothing
    setBusy(true);
    try {
      const spec = await build(currentUserName());
      if (kind === 'excel') await downloadFormSheet(spec);
      else printSpec(spec);
    } catch (e) {
      toast({ kind: 'error', title: kind === 'excel' ? 'Could not create the Excel sheet' : 'Could not create the PDF', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const btn = (kind: 'excel' | 'pdf') =>
    compact ? (
      <button key={kind} className="icon-btn" disabled={busy} title={kind === 'excel' ? 'Download Excel' : 'Download PDF'} aria-label={kind === 'excel' ? 'Download Excel' : 'Download PDF'} onClick={(e) => { e.stopPropagation(); void go(kind); }}>
        {kind === 'excel' ? <FileSpreadsheet size={16} /> : <FileText size={16} />}
      </button>
    ) : (
      <button key={kind} className="btn btn-subtle" disabled={busy} onClick={() => void go(kind)}>
        {kind === 'excel' ? <FileSpreadsheet size={15} /> : <FileText size={15} />} {kind === 'excel' ? 'Excel' : 'PDF'}
      </button>
    );
  return <>{(!only || only === 'excel') && btn('excel')}{(!only || only === 'pdf') && btn('pdf')}</>;
}

// ---------------------------------------------------------------- a table (a list page) as a document
export interface ListCol {
  label: string;
  key: string;
  kind?: 'text' | 'num' | 'money' | 'date';
  /** characters wide in the sheet */
  width?: number;
}
export interface ListDoc {
  filename: string;
  title: string;
  form: SheetSpec['form'];
  cols: ListCol[];
  rows: Record<string, unknown>[];
  info?: string[][];
  notes?: string[];
  /** a bold last row with the sums of these keys */
  totals?: string[];
}

const val = (v: unknown, kind?: string): SheetValue => {
  if (v == null || v === '') return null;
  if (kind === 'num' || kind === 'money') {
    const x = Number(v);
    return Number.isNaN(x) ? String(v) : Math.round(x * 1000) / 1000;
  }
  if (kind === 'date') return String(v).slice(0, 10).split('-').reverse().join('-');
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/** a list page → the same SheetSpec (so the same Excel layout and the same PDF) */
export function listSpec(d: ListDoc, user: string): SheetSpec {
  const rows = d.rows.map((r, i) => ({ cells: [i + 1, ...d.cols.map((c) => val(r[c.key], c.kind))] as SheetValue[] }));
  if (d.totals?.length) rows.push({ cells: ['', 'Total', ...d.cols.slice(1).map((c) => (d.totals!.includes(c.key) ? d.rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0) : null))] as SheetValue[], bold: true } as never);
  return {
    filename: d.filename,
    sheet: d.title,
    form: d.form,
    title: d.title,
    info: [[`Report :- ${d.title}`, `Date :- ${dmy(new Date().toISOString())}`, `Rows :- ${d.rows.length}`], ...(d.info ?? [])],
    widths: [7, ...d.cols.map((c) => c.width ?? Math.max(12, Math.min(34, c.label.length + 4)))],
    blocks: [{ headers: ['Sr. No.', ...d.cols.map((c) => c.label)], align: ['center', ...d.cols.map((c) => (c.kind === 'num' || c.kind === 'money' ? ('right' as const) : ('left' as const)))], rows }],
    notes: d.notes,
    checkedBy: user,
  };
}

/** Excel + PDF of a list page (the rows as they are filtered on screen) */
export function ListButtons({ doc, compact }: { doc: () => ListDoc; compact?: boolean }) {
  return <DocButtons compact={compact} build={(u) => listSpec(doc(), u)} />;
}
