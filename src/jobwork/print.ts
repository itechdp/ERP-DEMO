import { lineText } from './lineText';
// Job-work challans — same look as the Sales printouts and the Process Route Card (Everest Auto Forge header block, navy ruled
// tables, blue values). Customer names, rates and amounts are left out for roles that may not see them.
import { canSee, colOk } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import { SALES_CSS, detailTable, dmy, esc, inr, party, rupeesInWords, type Pair } from '../sales/print';
import { getJob, getProduct } from '../store/engine';
import type { Dispatch, ERPState, JobWork } from '../store/types';

const PROCESS_LABEL = { cutting: 'Cutting', forging: 'Forging', trimming: 'Trimming', heatTreatment: 'Heat Treatment' } as const;
const STAGES = ['cutting', 'forging', 'trimming', 'heatTreatment'] as const;

export const processText = (w: JobWork) => STAGES.filter((k) => w.processes[k]).map((k) => PROCESS_LABEL[k]).join(', ');
export const BASIS_LABEL: Record<JobWork['chargeBasis'], string> = { none: 'Not charged here', piece: 'Per piece', kg: 'Per kg', process: 'Per process' };

/** "Per piece · ₹ 5 / pc", "Per process · Heat Treatment ₹ 2.5, Trimming ₹ 1 (per piece)" — empty when the role may not see rates */
export function chargeText(w: JobWork) {
  if (!canSee('sales_rates') || w.chargeBasis === 'none') return '';
  if (w.chargeBasis === 'piece') return `Per piece · ${w.rate != null ? inr(w.rate) + ' / pc' : '—'}`;
  if (w.chargeBasis === 'kg') return `Per kg · ${w.rate != null ? inr(w.rate) + ' / kg' : '—'}`;
  const parts = STAGES.filter((k) => w.processes[k]).map((k) => `${PROCESS_LABEL[k]} ${inr(Number(w.processRates?.[k] ?? 0))}`);
  return `Per process · ${parts.join(', ')} (per piece)`;
}

const frame = (title: string, status: string, body: string, footLeft: string) => `<div class="rc sd">
  <table class="hd">
    <tr><td style="width:34%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td class="ttl">${title}</td>
        <td class="fm" style="width:24%">${esc(status)}</td></tr>
  </table>
  ${body}
  <div class="foot"><span>Everest Auto Forge Pvt. Ltd.</span><span>${esc(footLeft)} · printed ${dmy(new Date().toISOString())}</span></div>
</div>`;

const numberRow = (label: string, no: string, date: string) =>
  `<table class="no"><tr><td class="l" style="width:50%">${esc(label)} &nbsp;<span class="v">${esc(no)}</span></td><td class="l" style="text-align:right">Date : <span class="v">${dmy(date)}</span></td></tr></table>`;

const sign = (a: string, b: string) => `<table class="sign"><tr><td>${a}<small>Signature &amp; date</small></td><td>${b}<small>Signature &amp; date</small></td></tr></table>`;

/** The challan printed when the customer's parts arrive. */
export function jobWorkReceiptHtml(s: ERPState, w: JobWork) {
  const job = getJob(s, w.jobNo);
  const p = getProduct(s, job.productId);
  const pairs: Pair[] = [
    ['Customer', party(job.customer), true],
    ['Customer Challan No.', w.challanNo],
    ['Challan Date', dmy(w.challanDate)],
    ['Item', p.name],
    ['Part No.', p.code],
    ...(lineText(w) ? ([['Received', `${lineText(w)}${w.receiptNo && w.receiptNo !== w.jobNo ? ` (receipt ${w.receiptNo})` : ''}`, true]] as Pair[]) : []),
    ...(w.itemDescription ? ([['Description', w.itemDescription, true]] as Pair[]) : []),
    ['Quantity Received', `${w.receivedQty} PCS`],
    ['Weight Received', w.receivedWeight ? `${w.receivedWeight} KG` : ''],
    ['Material', w.materialSource === 'own' ? 'Our material' : "Customer's material"],
    ['Quality Check', w.qcRequired ? 'Required' : 'Not required'],
    ['Work to be done', processText(w), true],
    ...(chargeText(w) ? ([['Charges', chargeText(w), true]] as Pair[]) : []),
  ];
  return frame(
    'JOB WORK RECEIPT',
    'Parts received',
    `${numberRow('Job No.', w.jobNo, w.challanDate || w.createdAt)}
  ${detailTable(pairs)}
  <table class="rem"><tr><td class="l">Remarks : <span class="v" style="font-weight:600;font-size:13px"></span></td></tr></table>
  ${sign('Received By:', 'Customer Signature:')}`,
    w.jobNo,
  );
}

/** The challan printed when the processed parts go back to the customer. */
export function jobWorkReturnHtml(s: ERPState, d: Dispatch, w: JobWork) {
  const job = getJob(s, d.jobNo);
  const p = getProduct(s, job.productId);
  const bags = d.bags.length
    ? `<table class="pt">
    <tr><th style="width:60px">Bag</th><th>Quantity (PCS)</th><th>Weight (KG)</th></tr>
    ${d.bags.map((b, i) => `<tr><td class="n">${i + 1}</td><td>${b.qty}</td><td>${b.weight}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td>${d.qty}</td><td>${d.weight}</td></tr>
  </table>`
    : '';
  const pairs: Pair[] = [
    ['Customer', party(job.customer), true],
    ['Job No.', w.jobNo],
    ['Customer Challan No.', w.challanNo],
    ['Item', p.name],
    ['Part No.', p.code],
    ['Work done', processText(w), true],
    ['Quantity Returned', `${d.qty} PCS`],
    ['Total Weight', `${d.weight} KG`],
    ...(colOk('dispatch.vehicle') ? ([['Vehicle No.', d.vehicleNo]] as Pair[]) : []),
    ['Driver', d.driver],
  ];
  const charges =
    canSee('sales_rates') && w.chargeBasis !== 'none' && w.amount != null
      ? `<table class="pt"><tr class="tot"><td class="l" style="text-align:left">Job-work charges (${esc(chargeText(w))}) : <b>${inr(w.amount)}</b></td></tr></table>
  <table class="words"><tr><td>Amount in words : ${rupeesInWords(w.amount)}</td></tr></table>`
      : '';
  return frame(
    'JOB WORK RETURN',
    d.status === 'Dispatched' ? 'Returned' : 'Ready to return',
    `${numberRow('Return Challan No.', d.dispatchNo, d.date)}
  ${detailTable(pairs)}
  ${bags}
  ${charges}
  <table class="rem"><tr><td class="l">Remarks : <span class="v" style="font-weight:600;font-size:13px"></span></td></tr></table>
  ${sign('Dispatched By:', 'Received By (Customer):')}`,
    d.dispatchNo,
  );
}

export const printJobWorkReceipt = (s: ERPState, w: JobWork) => printHtml(`Job Work Receipt ${w.jobNo}`, jobWorkReceiptHtml(s, w), ROUTE_CARD_CSS + SALES_CSS);
export const printJobWorkReturn = (s: ERPState, d: Dispatch, w: JobWork) => printHtml(`Job Work Return Challan ${d.dispatchNo}`, jobWorkReturnHtml(s, d, w), ROUTE_CARD_CSS + SALES_CSS);
