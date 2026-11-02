// Packing list of a dispatch — printed in the company layout (logo header, ruled tables, signatures) and as an Excel form.
// Customer, vehicle, invoice and amount are left out for roles that may not see them.
import { canSee, colOk, currentUserName } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import { FORM_FORMATS, downloadFormSheet } from '../export/xlsxSheet';
import { SALES_CSS, detailTable, dmy, esc, inr, party, type Pair } from '../sales/print';
import { getJob, getProduct } from '../store/engine';
import type { Dispatch, ERPState } from '../store/types';

const bagNo = (d: Dispatch, n: number) => `${d.dispatchNo}/B${String(n).padStart(2, '0')}`;
const kg = (n: number) => n.toFixed(3);

function pairs(s: ERPState, d: Dispatch): Pair[] {
  const job = getJob(s, d.jobNo);
  const p = getProduct(s, d.productId);
  return [
    ['Customer', party(d.customer || job.customer), true],
    ['Job No.', d.jobNo],
    ['Product', p.name],
    ['Part No.', p.code],
    ...(colOk('dispatch.vehicle') ? ([['Vehicle No.', d.vehicleNo], ['Driver', d.driver]] as Pair[]) : []),
    ...(canSee('invoices') && d.invoiceNo ? ([['Invoice No.', d.invoiceNo]] as Pair[]) : []),
    ['Total Quantity', `${d.qty} PCS`],
    ['Total Weight', `${kg(d.weight)} KG`],
    ['Bags', String(d.bags.length)],
    ['Status', d.status],
  ];
}

export function packingListHtml(s: ERPState, d: Dispatch) {
  const p = getProduct(s, d.productId);
  const rows = d.bags.map((b) => `<tr><td class="n">${b.no}</td><td>${esc(bagNo(d, b.no))}</td><td>${esc(p.name)}</td><td>${b.qty}</td><td>${kg(b.weight)}</td></tr>`).join('');
  return `<div class="rc sd">
  <table class="hd">
    <tr><td style="width:34%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td class="ttl">PACKING LIST</td>
        <td class="fm" style="width:24%">Form No. : ${FORM_FORMATS.packingList.formNo}<br/>Rev. No. &amp; Date : ${FORM_FORMATS.packingList.revision}</td></tr>
  </table>
  <table class="no"><tr><td class="l" style="width:50%">Dispatch No. &nbsp;<span class="v">${esc(d.dispatchNo)}</span></td><td class="l" style="text-align:right">Date : <span class="v">${dmy(d.date)}</span></td></tr></table>
  ${detailTable(pairs(s, d))}
  <table class="pt">
    <tr><th style="width:50px">Sr.</th><th>Bag No.</th><th>Product</th><th>Quantity (PCS)</th><th>Weight (KG)</th></tr>
    ${rows}
    <tr class="tot"><td colspan="3" style="text-align:right">Total</td><td>${d.qty}</td><td>${kg(d.weight)}</td></tr>
  </table>
  ${canSee('sales_rates') && d.salesRate ? `<table class="pt"><tr class="tot"><td class="l" style="text-align:left">Invoice value : <b>${inr(d.qty * d.salesRate)}</b></td></tr></table>` : ''}
  <table class="rem"><tr><td class="l">Remarks : <span class="v" style="font-weight:600;font-size:13px"></span></td></tr></table>
  <table class="sign"><tr><td>Packed By:<small>Signature &amp; date</small></td><td>Checked By: ${esc(currentUserName())}<small>Signature &amp; date</small></td><td>Received By:<small>Signature &amp; date</small></td></tr></table>
  <div class="foot"><span>Everest Auto Forge Pvt. Ltd.</span><span>${esc(d.dispatchNo)} · printed ${dmy(new Date().toISOString())}</span></div>
</div>`;
}

export const printPackingList = (s: ERPState, d: Dispatch) => printHtml(`Packing List ${d.dispatchNo}`, packingListHtml(s, d), ROUTE_CARD_CSS + SALES_CSS);

export async function exportPackingListXlsx(s: ERPState, d: Dispatch, user: string) {
  const p = getProduct(s, d.productId);
  const job = getJob(s, d.jobNo);
  await downloadFormSheet({
    filename: `Packing-List-${d.dispatchNo}`,
    sheet: d.dispatchNo,
    form: FORM_FORMATS.packingList,
    title: 'Packing List',
    info: [
      [`Dispatch No :- ${d.dispatchNo}`, `Date :- ${dmy(d.date)}`, `Job No :- ${d.jobNo}`],
      [`Customer :- ${canSee('party_names') ? d.customer || job.customer || '' : ''}`, `Product :- ${p.name}`, `Part No :- ${p.code}`],
      ...(colOk('dispatch.vehicle') ? [[`Vehicle No :- ${d.vehicleNo || ''}`, `Driver :- ${d.driver || ''}`, ...(canSee('invoices') ? [`Invoice No :- ${d.invoiceNo || ''}`] : [])]] : []),
    ],
    widths: [8, 22, 34, 16, 16],
    blocks: [
      {
        headers: ['Sr. No.', 'Bag No.', 'Product', 'Quantity (PCS)', 'Weight (KG)'],
        align: ['center', 'left', 'left', 'right', 'right'],
        rows: [
          ...d.bags.map((b) => ({ cells: [b.no, bagNo(d, b.no), p.name, b.qty, Math.round(b.weight * 1000) / 1000] })),
          { cells: ['', '', 'Total', d.qty, Math.round(d.weight * 1000) / 1000], bold: true },
        ],
      },
    ],
    checkedBy: user,
  });
}
