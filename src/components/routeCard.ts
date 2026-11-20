// Process Route Card (client form F PD 03) — printed from Dispatch, filled from the job's real records.
import { canSee, colOk } from '../auth/access';
import { getJob, getProduct, round3, STAGE_LABEL } from '../store/engine';
import type { ERPState, ProcessStage } from '../store/types';
import { printHtml } from './printHtml';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dmy = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
};
const kg = (n: number) => n.toFixed(3);

const CSS = `
@page{size:A4 portrait;margin:10mm}
body{margin:0;font-family:-apple-system,'Segoe UI','Noto Sans Gujarati','Shruti',Roboto,sans-serif;color:#111}
.rc{width:100%;color:#1f3a5f}.rc table{border-collapse:collapse;width:100%}
.rc td,.rc th{border:1.5px solid #1f3a5f;padding:5px 8px;font-size:12.5px;vertical-align:middle}
.rc .brand{display:flex;align-items:center;justify-content:flex-start}.rc .logo-img{height:50px;max-width:220px;width:auto;object-fit:contain;display:block}
.rc .ttl{text-align:center;font-size:18px;font-weight:800}.rc .fm{font-size:11px;font-weight:700;text-align:center}
.rc .l{font-weight:700;white-space:nowrap}.rc .v{font-weight:700;color:#12338f;font-size:14px}
.rc .pt th{font-weight:700;font-size:11.5px;text-align:center}.rc .pt td{height:30px;text-align:center;font-weight:700;color:#12338f}.rc .pt td.n{width:34px;color:#1f3a5f}.rc .pt td.p{text-align:center;color:#1f3a5f}
.rc .bg td{height:25px;text-align:center;font-weight:700;color:#12338f}.rc .bg td.n{width:34px;color:#1f3a5f}.rc .bg th{font-size:11px}.rc .bg tr.tot td{font-weight:800;border-top:2.5px solid #1f3a5f}
.rc .sign td{height:46px;font-weight:700;vertical-align:top}.rc .skip{font-size:11px;color:#555;font-weight:600}
`;

/** the Process Route Card stylesheet — the Sales printouts reuse it so every printed form looks the same */
export const ROUTE_CARD_CSS = CSS;

export function routeCardHtml(s: ERPState, jobNo: string) {
  const job = getJob(s, jobNo);
  const p = getProduct(s, job.productId);
  const lot = s.rawMaterials.find((l) => l.id === job.issues[0]?.lotId);
  const rec = (st: ProcessStage) => (s[st] as ERPState['cutting']).find((r) => r.jobNo === jobNo);
  const qc = s.qc.find((r) => r.jobNo === jobNo);
  const fg = s.finishedGoods.filter((f) => f.jobNo === jobNo);
  const dispatches = s.dispatches.filter((d) => d.jobNo === jobNo).sort((a, b) => a.date.localeCompare(b.date) || a.dispatchNo.localeCompare(b.dispatchNo));
  const cut = rec('cutting');
  const bags = dispatches.flatMap((d) => d.bags);
  const finalQty = fg.reduce((t, f) => t + f.qty, 0);
  const lastDate = dispatches.length ? dispatches[dispatches.length - 1].date : '';

  // ---- process table
  const stageRow = (i: number, label: string, st: ProcessStage) => {
    const r = rec(st);
    const done = r?.status === 'Completed';
    if (r?.params.skipped) return `<tr><td class="n">${i}</td><td class="p">${label}</td><td>${dmy(r.receivedAt)}</td><td colspan="4" class="skip">Not required — skipped</td></tr>`;
    return `<tr><td class="n">${i}</td><td class="p">${label}</td><td>${dmy(r?.receivedAt)}</td><td>${r ? r.input : ''}</td><td>${done ? r!.output : ''}</td><td>${done ? r!.loss : ''}</td><td>${done && colOk('stage.operator') ? esc(r!.operator) : ''}</td></tr>`;
  };
  const qcDone = qc && qc.status !== 'QC Pending';
  const qcRow = `<tr><td class="n">7</td><td class="p">QC Inspection</td><td>${dmy(qc?.receivedAt)}</td><td>${qc ? qc.input : ''}</td><td>${qcDone ? qc!.accepted : ''}</td><td>${qcDone ? qc!.rejected : ''}</td><td>${qcDone && colOk('qc.inspector') ? esc(qc!.inspector) : ''}</td></tr>`;

  // ---- bag weights: two columns of bags, as on the paper card (bags 1-12 | 13-24 …)
  const perCol = Math.max(12, Math.ceil(bags.length / 2));
  const colA = bags.slice(0, perCol);
  const colB = bags.slice(perCol);
  const sumA = round3(colA.reduce((t, b) => t + b.weight, 0));
  const sumB = round3(colB.reduce((t, b) => t + b.weight, 0));
  const totalQty = bags.reduce((t, b) => t + b.qty, 0);
  const totalKg = round3(sumA + sumB);
  const vehicles = colOk('dispatch.vehicle') ? [...new Set(dispatches.map((d) => d.vehicleNo).filter(Boolean))].join(', ') : '';
  const bagRows = Array.from({ length: perCol }, (_, i) => {
    const extra =
      i === 0
        ? `<td rowspan="${perCol}" style="vertical-align:top;text-align:left;font-size:12px"><div class="l">Vehicle No.</div><div class="v">${esc(vehicles) || '&nbsp;'}</div><div class="l" style="margin-top:14px">Total Qty</div><div class="v">${totalQty || ''}</div><div class="l" style="margin-top:14px">Total Weight</div><div class="v">${totalKg ? kg(totalKg) + ' KG' : ''}</div></td>`
        : '';
    return `<tr><td class="n">${i + 1}</td><td>${colA[i] ? kg(colA[i].weight) : ''}</td><td>${colB[i] ? kg(colB[i].weight) : ''}</td>${extra}</tr>`;
  }).join('');

  return `<div class="rc">
  <table>
    <tr><td style="width:34%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td class="ttl">PROCESS ROUTE CARD</td>
        <td class="fm" style="width:24%">Form No. : F PD 03<br/>Rev. No. &amp; Date : 00 / 01.10.25</td></tr>
  </table>
  <table>
    <tr><td class="l" style="width:38%">Job Card No. &nbsp;<span class="v">${esc(job.jobNo)}</span></td><td class="l" style="text-align:right">Date : <span class="v">${dmy(job.createdAt)}</span></td></tr>
  </table>
  <table>
    <tr><td class="l" style="width:50%">Item Name (આઇટમ નામ) : <span class="v">${esc(p.name)}</span></td><td class="l">Product Code : <span class="v">${esc(p.code)}</span></td></tr>
  </table>
  <table>
    <tr><td class="l">Length (લંબાઈ) : <span class="v">${p.cuttingLength} MM</span></td><td class="l">Weight (વજન) : <span class="v">${job.pieceWeightG ?? ''}${job.pieceWeightG ? ' g' : ''}</span></td><td class="l">Bar OD (સળીયાનો OD) : <span class="v">${p.od} Ø</span></td></tr>
    <tr><td class="l">To cut (કાપવાના નંગ) : <span class="v">${job.plannedQty}</span></td><td class="l">Die No. : <span class="v">${esc(job.dieNo || p.dieNo)}</span></td><td class="l">Material : <span class="v">${esc(lot?.materialType || p.material)}</span></td></tr>
    <tr><td class="l" colspan="2">Machine No. : <span class="v">${esc(job.machineNo)}</span></td>${canSee('party_names') ? `<td class="l">Customer : <span class="v">${esc(job.customer)}</span></td>` : '<td class="l">&nbsp;</td>'}</tr>
    <tr><td class="l">Cut (કાપેલા નંગ) : <span class="v">${cut && cut.status === 'Completed' ? cut.output : ''}</span></td><td class="l">Final (ફાઈનલ નંગ) : <span class="v">${finalQty || ''}</span></td><td class="l">Bags (દાગીના) : <span class="v">${bags.length || ''}</span></td></tr>
    <tr><td class="l" colspan="2">&nbsp;</td><td class="l">Date (તારીખ) : <span class="v">${dmy(lastDate)}</span></td></tr>
  </table>
  <table class="pt">
    <tr><th style="width:34px">Sr. No.</th><th>Process</th><th>Inward Date</th><th>Received Qty.</th><th>OK Qty.</th><th>Rejection Qty.</th><th>Checked By</th></tr>
    ${stageRow(1, STAGE_LABEL.cutting, 'cutting')}${stageRow(2, STAGE_LABEL.forging, 'forging')}${stageRow(3, STAGE_LABEL.trimming, 'trimming')}${stageRow(4, STAGE_LABEL.heatTreatment, 'heatTreatment')}${stageRow(5, STAGE_LABEL.cnc, 'cnc')}${stageRow(6, STAGE_LABEL.vmc, 'vmc')}${qcRow}
  </table>
  <table class="bg">
    <tr><th>Sr.</th><th>Bag Weight (KG)</th><th>Bag Weight (KG)</th><th style="width:30%">Packing / Dispatch</th></tr>
    ${bagRows}
    <tr class="tot"><td class="n">${perCol + 1}</td><td>${sumA ? kg(sumA) : ''}</td><td>${sumB ? kg(sumB) : ''}</td><td style="font-size:11px">Column totals</td></tr>
  </table>
  <table class="sign"><tr><td>Verified By:</td><td>Approved By:</td></tr></table>
</div>`;
}

export const printRouteCard = (s: ERPState, jobNo: string) => printHtml(`Process Route Card ${jobNo}`, routeCardHtml(s, jobNo), CSS);
