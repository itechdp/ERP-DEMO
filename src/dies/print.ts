import { canSee, colOk } from '../auth/access';
import { saveFile } from '../native/native';
import { printHtml as printCommon } from '../components/printHtml';
import { fmtDate } from '../components/format';
import { KIND_LABEL, type Die, type DieData, type Dims, type MainDie } from './types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export const fmtDims = (d: Dims) => (d.w == null && d.h == null ? (d.l ? `Length ${d.l} mm` : '—') : `${d.l ?? '—'} × ${d.w ?? '—'} × ${d.h ?? '—'} mm`);
export const fmtWt = (n?: number) => (n === undefined ? '—' : `${n} kg`);

const DIE_PRINT_CSS = `
    h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #333;padding-bottom:3px}
    .sub{color:#555;margin:2px 0 14px}table{border-collapse:collapse;width:100%;margin-bottom:6px}
    th,td{border:1px solid #bbb;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1;width:22%}
    .imgs{display:flex;gap:10px;margin:8px 0}.imgs figure{margin:0;text-align:center;font-size:10px;color:#555}
    .imgs img{width:170px;height:115px;object-fit:cover;border:1px solid #bbb;display:block}
    .die{page-break-inside:avoid;margin-bottom:14px}.demo{font-size:10px;color:#a60}
  `;
const printHtml = (title: string, body: string) => printCommon(title, body, DIE_PRINT_CSS);

function dieBlock(die: Die, data: DieData) {
  const img = (id?: string, cap = '') => (id && data.images[id] ? `<figure><img src="${data.images[id]}"/>${cap}</figure>` : '');
  const hist = data.history.filter((h) => h.dieCode === die.code && h.kind === die.kind);
  return `<div class="die"><h2>${KIND_LABEL[die.kind]} Die — ${esc(die.code)} ${die.demo ? '<span class="demo">(demo data)</span>' : ''}</h2>
  <table>
    <tr><th>Status</th><td>${esc(die.status)}</td><th>Material / Grade</th><td>${esc(die.material)}</td></tr>
    <tr><th>Making date</th><td>${fmtDate(die.makingDate)}</td>${canSee('party_names') ? `<th>Die maker</th><td>${esc(die.maker)}</td>` : '<th></th><td></td>'}</tr>
    <tr><th>Top die</th><td>${fmtDims(die.top)} · ${fmtWt(die.topWeight)}</td><th>Bottom die</th><td>${fmtDims(die.bottom)} · ${fmtWt(die.bottomWeight)}</td></tr>
    <tr><th>Revision</th><td>${esc(die.revision) || '—'}</td>${colOk('die.location') ? `<th>Location</th><td>${esc(die.location) || '—'}</td>` : '<th></th><td></td>'}</tr>
    <tr>${colOk('die.pieces') ? `<th>Pieces produced</th><td>${die.pieces.toLocaleString('en-IN')}</td>` : '<th></th><td></td>'}${canSee('die_cost') ? `<th>Cost</th><td>${die.cost === undefined ? '—' : '₹ ' + die.cost.toLocaleString('en-IN')}</td>` : '<th></th><td></td>'}</tr>
    <tr><th>Last maintenance</th><td>${die.lastMaintDate ? fmtDate(die.lastMaintDate) : '—'}</td><th>Maintenance remarks</th><td>${esc(die.maintRemarks) || '—'}</td></tr>
    ${die.replacesCode || die.replacedByCode ? `<tr><th>Replaces</th><td>${esc(die.replacesCode) || '—'}</td><th>Replaced by</th><td>${esc(die.replacedByCode) || '—'}</td></tr>` : ''}
    <tr><th>Remarks</th><td colspan="3">${esc(die.remarks) || '—'}</td></tr>
  </table>
  <div class="imgs">${img(die.topImg, 'Top die')}${img(die.bottomImg, 'Bottom die')}</div>
  ${hist.length ? `<table><tr><th style="width:90px">Date</th><th style="width:160px">Event</th><th>Remarks</th></tr>${hist.map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${esc(h.event)}</td><td>${esc(h.remarks)}</td></tr>`).join('')}</table>` : ''}</div>`;
}

export function printDieCard(main: MainDie, data: DieData, only?: Die) {
  const dies = only ? [only] : [...data.forgingDies, ...data.trimmingDies].filter((d) => d.mainCode === main.code);
  printHtml(
    `Die Card ${only?.code ?? main.code}`,
    `<h1>Die Card — ${esc(main.code)}</h1><div class="sub">${esc(main.name)} · Printed ${fmtDate(new Date().toISOString())}</div>
    <table>
      <tr><th>Component</th><td>${esc(main.name)}</td><th>Part code</th><td>${esc(main.partCode)}</td></tr>
      <tr>${canSee('party_names') ? `<th>Customer</th><td>${esc(main.customer) || '—'}</td>` : '<th></th><td></td>'}<th>Metal</th><td>${esc(main.metal)}</td></tr>
      <tr><th>Description</th><td colspan="3">${esc(main.description) || '—'}</td></tr>
      <tr><th>Created</th><td>${fmtDate(main.createdOn)}</td><th>Status</th><td>${esc(main.status)}</td></tr>
    </table>${dies.map((d) => dieBlock(d, data)).join('') || '<p>No dies linked yet.</p>'}`,
  );
}

function download(name: string, text: string) {
  void saveFile(name, new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

/** CSV opens directly in Excel — enough for the demo without an xlsx dependency. */
export function exportMainDies(mains: MainDie[], data: DieData) {
  download(
    'die-master.csv',
    csv([
      ['Sr. No.', 'Main Die Code', 'Die Name', 'Part Code', ...(canSee('party_names') ? ['Customer'] : []), 'Metal', 'Forging Dies', 'Trimming Dies', 'Status', 'Created On'],
      ...mains.map((m, i) => [i + 1, m.code, m.name, m.partCode, ...(canSee('party_names') ? [m.customer] : []), m.metal, data.forgingDies.filter((d) => d.mainCode === m.code).length, data.trimmingDies.filter((d) => d.mainCode === m.code).length, m.status, m.createdOn]),
    ]),
  );
}

export function exportDies(kind: 'forging' | 'trimming', dies: Die[], data: DieData) {
  download(
    `${kind}-die-master.csv`,
    csv([
      ['Die Code', 'Main Die', 'Component', 'Material', 'Making Date', ...(canSee('party_names') ? ['Maker'] : []), 'Revision', 'Status', ...(colOk('die.location') ? ['Location'] : []), ...(colOk('die.pieces') ? ['Pieces Produced'] : []), ...(canSee('die_cost') ? ['Cost'] : [])],
      ...dies.map((d) => [d.code, d.mainCode, data.mainDies.find((m) => m.code === d.mainCode)?.name, d.material, d.makingDate, ...(canSee('party_names') ? [d.maker] : []), d.revision, d.status, ...(colOk('die.location') ? [d.location] : []), ...(colOk('die.pieces') ? [d.pieces] : []), ...(canSee('die_cost') ? [d.cost] : [])]),
    ]),
  );
}
