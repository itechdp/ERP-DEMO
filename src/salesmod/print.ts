// The customer's copy of a quotation, in the same look as the Purchase Order. It never shows cost, profit or margin.
import { printHtml } from '../components/printHtml';
import { PO_UFLOW_CSS, esc, dmy, rupeesInWords } from '../sales/print';
import { inr } from './calc';
import type { CostRow, OrderLine, OrderRow, QuotationLine, QuotationRow } from './types';

export interface QuotationOutput {
  /** also print each line's cost sheet (input weight → final cost) */
  detailed?: boolean;
}

export const costAmount = (r: CostRow) => (r.amount == null ? '' : r.amount.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(r.amount) ? 0 : 2 }));

const costSheetHtml = (lines: QuotationLine[]) =>
  lines
    .filter((l) => l.costing?.length)
    .map(
      (l, n) => `<div class="qt-cost"><div class="qt-cost-h">Cost sheet ${lines.filter((x) => x.costing?.length).length > 1 ? n + 1 + ' · ' : '· '}${esc(l.product)}${[l.grade, l.size].filter(Boolean).length ? ' (' + esc([l.grade, l.size].filter(Boolean).join(' • ')) + ')' : ''}</div>
        <table class="qt-table"><thead><tr><th style="width:34px">Sr.</th><th>Description</th><th>Calculation</th><th class="r" style="width:90px">Amount</th></tr></thead><tbody>${(l.costing ?? [])
          .map((r, i) => `<tr${r.bold ? ' class="b"' : ''}><td>${i + 1}</td><td>${esc(r.label)}</td><td>${esc(r.basis)}</td><td class="r">${costAmount(r)}</td></tr>`)
          .join('')}</tbody></table></div>`,
    )
    .join('');

const CSS = `
@page { size: A4; margin: 10mm 12mm 14mm 12mm; }
.po-doc { max-width: none; }
.qt-title { margin: 6px 0 12px; border: 1px solid #bce8e7; border-radius: 4px; overflow: hidden; display: flex; align-items: center; gap: 10px; }
.qt-title .band { background: #e6f6f6 !important; color: #166564 !important; font-weight: 700; font-size: 10.5px; padding: 9px 14px; letter-spacing: 0.06em; text-transform: uppercase; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.qt-title .name { font-size: 15px; font-weight: 800; color: #0f172a; }
.qt-cust { border: 1px solid #e2e8f0; border-radius: 4px; padding: 9px 12px; margin-bottom: 12px; font-size: 11px; line-height: 1.6; }
.qt-cust b { color: #0f172a; }
.qt-table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; margin-bottom: 10px; }
.qt-table th { background: #f8fafc !important; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; padding: 7px 6px; border-bottom: 2px solid #259392; border-right: 1px solid #e2e8f0; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.qt-table td { padding: 6px; font-size: 10.5px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: top; }
.qt-table .r { text-align: right; }
.qt-table .tot td { background: #1a3c61 !important; color: #fff !important; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.qt-words { font-size: 10.5px; margin-bottom: 12px; }
.qt-terms { border: 1px solid #e2e8f0; border-radius: 4px; padding: 9px 12px; font-size: 10.5px; line-height: 1.7; margin-bottom: 18px; }
.qt-cost { margin: 0 0 12px; page-break-inside: avoid; }
.qt-cost-h { font-size: 10.5px; font-weight: 700; margin: 4px 0; color: #166564; }
.qt-table tr.b td { font-weight: 700; background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.qt-sign { display: flex; justify-content: space-between; margin-top: 46px; font-size: 10.5px; }
.qt-sign div { width: 40%; border-top: 1px solid #475569; padding-top: 4px; }
`;

export function printQuotation(q: QuotationRow, lines: QuotationLine[], opts: QuotationOutput = {}) {
  const rows = lines
    .map((l, i) => {
      const spec = [l.grade, l.size].filter(Boolean).join(' • ');
      return `<tr><td>${i + 1}</td><td><b>${esc(l.product)}</b>${spec ? `<div>${esc(spec)}</div>` : ''}</td><td class="r">${l.qty ?? ''}</td><td>${esc(l.uom)}</td>
      <td class="r">${l.rate == null ? '' : inr(l.rate)}</td><td class="r">${l.discountPct ? l.discountPct + '%' : '—'}</td>
      <td class="r">${l.netRate == null ? '' : inr(l.netRate)}</td><td class="r">${l.amount == null ? '' : inr(l.amount)}</td></tr>`;
    })
    .join('');
  const total = q.amount ?? lines.reduce((a, l) => a + (l.amount ?? 0), 0);
  const html = `
<div class="po-doc">
  <table class="po-top-table"><tr>
    <td style="width:62%"><div class="po-header-left"><img src="/everest-logo.png" alt="Everest Auto Forge" class="po-logo" onerror="this.style.display='none'" /></div></td>
    <td style="width:38%;text-align:right"><div class="po-meta-card"><div class="po-meta-title">SALES QUOTATION</div>
      <table class="po-meta-table">
        <tr><td class="po-meta-label">Quotation No.</td><td class="po-meta-val">${esc(q.docNo)}</td></tr>
        <tr><td class="po-meta-label">Date</td><td class="po-meta-val">${esc(dmy(q.qtDate))}</td></tr>
        <tr><td class="po-meta-label">Valid Until</td><td class="po-meta-val">${esc(dmy(q.validUntil))}</td></tr>
        ${q.enquiryNo ? `<tr><td class="po-meta-label">Enquiry Ref.</td><td class="po-meta-val">${esc(q.enquiryNo)}</td></tr>` : ''}
      </table></div></td>
  </tr></table>
  <div class="qt-title"><div class="band">To</div><div class="name">${esc(q.customer)}</div></div>
  <div class="qt-cust">${[q.contact && `Attention: <b>${esc(q.contact)}</b>`, q.phone && `Phone: <b>${esc(q.phone)}</b>`, q.email && `Email: <b>${esc(q.email)}</b>`].filter(Boolean).join(' &nbsp;·&nbsp; ') || '&nbsp;'}</div>
  <table class="qt-table"><thead><tr><th style="width:28px">#</th><th>Product</th><th class="r">Qty</th><th>UOM</th><th class="r">Rate</th><th class="r">Disc.</th><th class="r">Net Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}<tr class="tot"><td colspan="7" class="r">Total</td><td class="r">${inr(total)}</td></tr></tbody></table>
  <div class="qt-words"><b>Amount in words:</b> ${esc(rupeesInWords(total))}</div>
  ${opts.detailed ? costSheetHtml(lines) : ''}
  <div class="qt-terms">
    <div><b>Payment terms:</b> ${esc(q.paymentTerms || '—')}</div>
    <div><b>Delivery terms:</b> ${esc(q.deliveryTerms || '—')}</div>
    <div><b>Validity:</b> this quotation is valid until ${esc(dmy(q.validUntil))}.</div>
    ${q.remarks ? `<div><b>Remarks:</b> ${esc(q.remarks)}</div>` : ''}
  </div>
  <div class="qt-sign"><div>Customer acceptance (signature &amp; date)</div><div>For Everest Auto Forge Pvt. Ltd.</div></div>
  <div class="po-foot-meta"><span>This is a computer-generated quotation. &nbsp;·&nbsp; E.&amp;O.E.</span><span>${esc(q.docNo)}</span></div>
</div>`;
  printHtml(`Quotation ${q.docNo}${opts.detailed ? ' (detailed)' : ''}`, html, PO_UFLOW_CSS + CSS);
}

export function printSalesOrder(o: OrderRow, lines: OrderLine[]) {
  const rows = lines
    .map((l, i) => {
      const spec = [l.grade, l.size].filter(Boolean).join(' • ');
      const amt = l.rate == null ? null : (l.qty ?? 0) * l.rate;
      return `<tr><td>${i + 1}</td><td><b>${esc(l.product)}</b>${spec ? `<div>${esc(spec)}</div>` : ''}</td><td class="r">${l.qty ?? ''}</td><td>${esc(l.uom)}</td>
      <td class="r">${l.rate == null ? '' : inr(l.rate)}</td><td class="r">${amt == null ? '' : inr(amt)}</td></tr>`;
    })
    .join('');
  const total = o.amount ?? lines.reduce((a, l) => a + (l.qty ?? 0) * (l.rate ?? 0), 0);
  const html = `
<div class="po-doc">
  <table class="po-top-table"><tr>
    <td style="width:62%"><div class="po-header-left"><img src="/everest-logo.png" alt="Everest Auto Forge" class="po-logo" onerror="this.style.display='none'" /></div></td>
    <td style="width:38%;text-align:right"><div class="po-meta-card"><div class="po-meta-title">SALES ORDER</div>
      <table class="po-meta-table">
        <tr><td class="po-meta-label">Order No.</td><td class="po-meta-val">${esc(o.soNo)}</td></tr>
        <tr><td class="po-meta-label">Date</td><td class="po-meta-val">${esc(dmy(o.soDate))}</td></tr>
        <tr><td class="po-meta-label">Delivery Date</td><td class="po-meta-val">${esc(dmy(o.deliveryDate))}</td></tr>
        ${o.extRef ? `<tr><td class="po-meta-label">Customer PO</td><td class="po-meta-val">${esc(o.extRef)}</td></tr>` : ''}
        ${o.quotationNo ? `<tr><td class="po-meta-label">Quotation</td><td class="po-meta-val">${esc(o.quotationNo)}</td></tr>` : ''}
      </table></div></td>
  </tr></table>
  <div class="qt-title"><div class="band">Customer</div><div class="name">${esc(o.customer)}</div></div>
  <div class="qt-cust">${[o.contact && `Attention: <b>${esc(o.contact)}</b>`, o.phone && `Phone: <b>${esc(o.phone)}</b>`, o.email && `Email: <b>${esc(o.email)}</b>`].filter(Boolean).join(' &nbsp;·&nbsp; ') || '&nbsp;'}</div>
  <table class="qt-table"><thead><tr><th style="width:28px">#</th><th>Product</th><th class="r">Qty</th><th>UOM</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
    <tbody>${rows}<tr class="tot"><td colspan="5" class="r">Total</td><td class="r">${inr(total)}</td></tr></tbody></table>
  <div class="qt-words"><b>Amount in words:</b> ${esc(rupeesInWords(total))}</div>
  <div class="qt-terms">
    <div><b>Payment terms:</b> ${esc(o.paymentTerms || '—')}</div>
    <div><b>Delivery terms:</b> ${esc(o.deliveryTerms || '—')}</div>
    ${o.remarks ? `<div><b>Remarks:</b> ${esc(o.remarks)}</div>` : ''}
  </div>
  <div class="qt-sign"><div>Prepared by</div><div>For Everest Auto Forge Pvt. Ltd.</div></div>
  <div class="po-foot-meta"><span>This is a computer-generated sales order. &nbsp;·&nbsp; E.&amp;O.E.</span><span>${esc(o.soNo)}</span></div>
</div>`;
  printHtml(`Sales Order ${o.soNo}`, html, PO_UFLOW_CSS + CSS);
}
