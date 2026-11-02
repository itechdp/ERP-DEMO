// Printouts for the Sales & Orders pages. Same family as the Process Route Card and the Hardness Report (Everest Auto Forge
// header block, navy ruled tables, blue values) — only the content changes. Customer names and rates are left out for roles
// that may not see them.
import { canSee } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { ROUTE_CARD_CSS } from '../components/routeCard';
import type { SalesKind, SalesRecord } from './config';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const dmy = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
};
export const inr = (n: number) => `₹ ${n.toLocaleString('en-IN')}`;

// ---- amount in words: one copy, shared with the po-pdf Edge Function (supabase/functions/_shared/format.ts)
import { rupeesInWords } from '../../supabase/functions/_shared/format';
export { rupeesInWords };

const TITLE: Record<SalesKind, string> = {
  quotation: 'SALES QUOTATION',
  inquiry: 'INQUIRY',
  purchase_order: 'PURCHASE ORDER',
  sales_order: 'SALES ORDER',
  final_order: 'FINAL ORDER',
  task: 'TASK ASSIGNMENT',
};
const NO_LABEL: Record<SalesKind, string> = {
  quotation: 'Quotation No.',
  inquiry: 'Inquiry No.',
  purchase_order: 'PO No.',
  sales_order: 'Sales Order No.',
  final_order: 'Order No.',
  task: 'Task No.',
};
const DUE_LABEL: Record<SalesKind, string> = {
  quotation: 'Valid Until',
  inquiry: 'Required By',
  purchase_order: 'Delivery Date',
  sales_order: 'Delivery Date',
  final_order: 'Delivery Date',
  task: 'Due Date',
};
const REF_LABEL: Record<SalesKind, string> = {
  quotation: 'Inquiry No.',
  inquiry: 'Lead No.',
  purchase_order: 'Quotation No.',
  sales_order: 'Quotation No.',
  final_order: 'PO No.',
  task: 'Related To',
};

/** label, value (undefined = hidden for this role, the pair is dropped), full width? */
export type Pair = [label: string, value: string | undefined, full?: boolean];
/** a value only for roles that may see it */
export const party = (v: string): string | undefined => (canSee('party_names') ? v : undefined);

/** the ruled detail table: two fields per line, full-width ones on their own line */
export function detailTable(pairs: Pair[]) {
  const list = pairs.filter((p) => p[1] !== undefined);
  const lines: Pair[][] = [];
  let open: Pair[] = [];
  for (const p of list) {
    if (p[2]) {
      if (open.length) lines.push(open);
      lines.push([p]);
      open = [];
    } else {
      open.push(p);
      if (open.length === 2) {
        lines.push(open);
        open = [];
      }
    }
  }
  if (open.length) lines.push(open);
  // each field reads "Label : value" in one cell — the value sits right after its label, no divider between them
  const cell = ([label, value]: Pair, span = '') => `<td class="l dc"${span}>${esc(label)} : <span class="v">${esc(value)}</span></td>`;
  const line = (l: Pair[]) => {
    if (l.length === 2) return `<tr>${cell(l[0])}${cell(l[1])}</tr>`;
    return `<tr>${cell(l[0], ' colspan="2"')}</tr>`; // a lone pair (full-width, or the odd one out) fills its line
  };
  return `<table class="dt">${lines.map(line).join('')}</table>`;
}

export const SALES_CSS = `
.rc .hd td{border-left:0;border-right:0}.rc .hd td:first-child{border-left:1.5px solid #1f3a5f}.rc .hd td:last-child{border-right:1.5px solid #1f3a5f}
.rc.sd td,.rc.sd th{padding:9px 13px;font-size:13px}
.rc.sd .hd td{padding:16px 16px;border-bottom:2.5px solid #1f3a5f}
.rc.sd .ttl{font-size:23px;letter-spacing:.05em}
.rc.sd .fm{font-size:12.5px}
.rc.sd .no td{font-size:14.5px;padding:11px 14px}
.rc.sd .dt{table-layout:fixed}
.rc.sd .dt td.dc{width:50%;padding:12px 14px;font-size:13.5px}
.rc.sd .dt .v{font-size:14.5px}
.rc.sd .pt th{background:#eef3fb;padding:11px 8px;font-size:12px;letter-spacing:.02em}
.rc.sd .pt td{height:44px;font-size:13.5px}
.rc.sd .pt tr.tot td{background:#eef3fb;font-weight:800;font-size:14px}
.rc.sd .words td{background:#f8faff;font-size:12.5px;font-weight:700;color:#1f3a5f}
.rc.sd .rem td{height:120px;vertical-align:top}
.rc.sd .sign td{height:104px;vertical-align:top;position:relative}
.rc.sd .sign small{position:absolute;left:13px;bottom:9px;font-weight:600;color:#6b7a99;font-size:10.5px}
.rc.sd .brand{display:flex;align-items:center;justify-content:flex-start}
.logo-img{height:52px;max-width:220px;width:auto;object-fit:contain;display:block}
`;

export const PO_UFLOW_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
@page { size: A4 portrait; margin: 10mm 15mm 15mm 15mm; }
body { margin: 0 !important; padding: 0 !important; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important; color: #1e293b; font-size: 11px; line-height: 1.45; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; letter-spacing: -0.01em; }
.po-doc { width: 100%; max-width: 820px; margin: 0 auto; color: #1e293b; box-sizing: border-box; }
.po-top-table { width: 100%; border-collapse: collapse; margin-top: 0; margin-bottom: 16px; }
.po-top-table td { vertical-align: top; padding: 0; }
.po-header-left { display: flex; align-items: flex-start; }
.po-logo { height: 60px; max-width: 250px; width: auto; object-fit: contain; display: block; margin: 0; }

.po-meta-card { width: 220px; border: 1.5px solid #1a3c61; border-radius: 4px; overflow: hidden; margin-left: auto; margin-top: 0; }
.po-meta-title { background: #1a3c61 !important; color: #ffffff !important; text-align: center; font-weight: 700; font-size: 13px; padding: 8px 4px; letter-spacing: 0.08em; line-height: 1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.po-meta-table { width: 100%; border-collapse: collapse; background: #fff; }
.po-meta-table td { padding: 5px 10px; font-size: 10.5px; border-bottom: 1px solid #e2e8f0; }
.po-meta-table tr:last-child td { border-bottom: none; }
.po-meta-label { font-weight: 600; color: #64748b; width: 44%; text-align: left; }
.po-meta-val { font-weight: 700; color: #0f172a; text-align: right; }

.po-addresses-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.po-addresses-table td { width: 50%; vertical-align: top; padding: 0; }
.po-addresses-table td:first-child { padding-right: 10px; }
.po-addresses-table td:last-child { padding-left: 10px; }
.po-addr-box { border: 1px solid #bce8e7; border-radius: 4px; overflow: hidden; height: 100%; min-height: 120px; background: #fff; }
.po-addr-head { background: #e6f6f6 !important; color: #166564 !important; font-weight: 700; font-size: 10.5px; padding: 7px 12px; letter-spacing: 0.06em; border-bottom: 1px solid #bce8e7; text-transform: uppercase; line-height: 1.2; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.po-addr-body { padding: 10px 12px; font-size: 10.5px; line-height: 1.5; color: #334155; }
.po-addr-company { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 4px; }

.po-items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; border: 1px solid #e2e8f0; }
.po-items-table th { background: #f8fafc; color: #0f172a; font-size: 9.5px; font-weight: 700; padding: 8px 6px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #259392; border-right: 1px solid #e2e8f0; }
.po-items-table th:last-child { border-right: none; }
.po-items-table td { padding: 9px 6px; font-size: 10.5px; border-bottom: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; vertical-align: middle; }
.po-items-table td:last-child { border-right: none; }

.po-totals-grid { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
.po-totals-grid td { vertical-align: top; padding: 0; }
.po-tax-table { width: 95%; border-collapse: collapse; border: 1px solid #e2e8f0; }
.po-tax-table th { background: #f8fafc; font-size: 9.5px; font-weight: 700; color: #475569; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; letter-spacing: 0.04em; }
.po-tax-table td { padding: 6px 8px; font-size: 10.5px; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
.po-tax-table tr:last-child td { border-bottom: none; }

.po-words-card { background: #e6f6f6; border-left: 4px solid #259392; border: 1px solid #bce8e7; border-left-width: 4px; padding: 8px 12px; margin-top: 14px; width: 92%; box-sizing: border-box; border-radius: 3px; }
.po-words-label { font-size: 9px; font-weight: 700; color: #166564; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
.po-words-val { font-size: 11px; font-weight: 600; color: #0f172a; line-height: 1.4; }

.po-calc-table { width: 100%; border-collapse: collapse; margin-left: auto; }
.po-calc-table td { padding: 5px 10px; font-size: 11px; }
.po-calc-lbl { color: #475569; font-weight: 500; text-align: left; }
.po-calc-val { text-align: right; font-weight: 700; color: #0f172a; }
.po-grand-row td { background: #1a3c61; color: #fff !important; font-size: 13px; font-weight: 700; padding: 9px 12px; }
.po-grand-lbl { letter-spacing: 0.06em; text-transform: uppercase; }
.po-grand-val { text-align: right; letter-spacing: 0.02em; }

.po-terms-box { border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 14px; margin-bottom: 22px; background: #fff; }
.po-terms-title { font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
.po-terms-list { margin: 0; padding-left: 16px; font-size: 10px; color: #475569; line-height: 1.6; }
.po-terms-list li { margin-bottom: 3px; }

.po-sig-sec { margin-top: 24px; }
.po-sig-table { width: 100%; border-collapse: collapse; }
.po-sig-table td { width: 50%; text-align: center; vertical-align: bottom; padding: 0 25px; }
.po-sig-space { height: 48px; }
.po-sig-line { border-top: 1px solid #cbd5e1; padding-top: 6px; font-size: 9.5px; font-weight: 600; color: #64748b; letter-spacing: 0.08em; text-transform: uppercase; }

.po-foot-meta { border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 8px; display: flex; justify-content: space-between; font-size: 8.5px; color: #94a3b8; }
`;

export function purchaseOrderUflowHtml(r: SalesRecord): string {
  const amount = r.amount ?? (r.qty != null && r.rate != null ? r.qty * r.rate : 0);
  const taxRate = 0.18;
  const taxAmount = Math.round(amount * taxRate);
  const halfTax = Math.round(taxAmount / 2);
  const grandTotal = amount + taxAmount;
  const qtyFormatted = r.qty != null ? r.qty.toLocaleString('en-IN') : '—';
  const rateFormatted = r.rate != null ? r.rate.toFixed(2) : '—';
  const amtFormatted = amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const taxAmtFormatted = taxAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const halfTaxFormatted = halfTax.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grandTotalFormatted = grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const vendorParty = r.party || '';
  const docDate = dmy(r.docDate);
  const deliveryDate = dmy(r.dueDate);
  const poNumber = r.docNo || '';

  return `
<div class="po-doc">
  <!-- Top Header Table -->
  <table class="po-top-table">
    <tr>
      <td style="width: 68%;">
        <div class="po-header-left">
          <img src="/everest-logo.png" alt="Everest Auto Forge" class="po-logo" />
        </div>
      </td>
      <td style="width: 32%; text-align: right;">
        <div class="po-meta-card">
          <div class="po-meta-title">PURCHASE ORDER</div>
          <table class="po-meta-table">
            <tr>
              <td class="po-meta-label">PO No.</td>
              <td class="po-meta-val">${esc(poNumber)}</td>
            </tr>
            <tr>
              <td class="po-meta-label">Date</td>
              <td class="po-meta-val">${esc(docDate)}</td>
            </tr>
            <tr>
              <td class="po-meta-label">Delivery Dt.</td>
              <td class="po-meta-val">${esc(deliveryDate)}</td>
            </tr>
          </table>
        </div>
      </td>
    </tr>
  </table>

  <!-- Vendor & Delivery Address Table -->
  <table class="po-addresses-table">
    <tr>
      <td>
        <div class="po-addr-box">
          <div class="po-addr-head">VENDOR / SUPPLIER</div>
          <div class="po-addr-body">
            ${vendorParty ? `<div class="po-addr-company">${esc(vendorParty)}</div>` : ''}
            ${r.contact ? `<div>Contact: ${esc(r.contact)}</div>` : ''}
            ${r.phone ? `<div>Phone: ${esc(r.phone)}</div>` : ''}
            ${r.email ? `<div>Email: ${esc(r.email)}</div>` : ''}
          </div>
        </div>
      </td>
      <td>
        <div class="po-addr-box">
          <div class="po-addr-head">DELIVERY ADDRESS</div>
          <div class="po-addr-body">
          </div>
        </div>
      </td>
    </tr>
  </table>

  <!-- Items Table -->
  <table class="po-items-table">
    <thead>
      <tr>
        <th style="width: 28px; text-align: center;">#</th>
        <th style="width: 85px; text-align: center;">CODE</th>
        <th style="text-align: left;">DESCRIPTION</th>
        <th style="width: 75px; text-align: center;">MATERIAL</th>
        <th style="width: 65px; text-align: center;">DIE NO.</th>
        <th style="width: 65px; text-align: right;">QTY</th>
        <th style="width: 75px; text-align: right;">RATE<br/><small style="font-weight:400;text-transform:none;">Rs.</small></th>
        <th style="width: 50px; text-align: center;">GST</th>
        <th style="width: 100px; text-align: right;">AMOUNT<br/><small style="font-weight:400;text-transform:none;">Rs.</small></th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="text-align: center; color: #64748b;">1</td>
        <td style="text-align: center; font-weight: 700; color: #0f172a;">${esc(r.refNo || '—')}</td>
        <td style="font-weight: 700; color: #0f172a;">${esc(r.product || '—')}</td>
        <td style="text-align: center; color: #334155;">—</td>
        <td style="text-align: center; color: #94a3b8;">—</td>
        <td style="text-align: right; font-weight: 700; color: #0f172a;">${qtyFormatted}</td>
        <td style="text-align: right; font-weight: 700; color: #0f172a;">${rateFormatted}</td>
        <td style="text-align: center; color: #334155;">18%</td>
        <td style="text-align: right; font-weight: 800; color: #0f172a;">${amtFormatted}</td>
      </tr>
    </tbody>
  </table>

  <!-- Totals & Taxes Grid -->
  <table class="po-totals-grid">
    <tr>
      <td style="width: 55%;">
        <table class="po-tax-table">
          <thead>
            <tr>
              <th>TAX SUMMARY</th>
              <th style="text-align: right;">TAXABLE VALUE</th>
              <th style="text-align: center;">RATE</th>
              <th style="text-align: right;">TAX AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CGST + SGST</td>
              <td style="text-align: right;">${amtFormatted}</td>
              <td style="text-align: center;">18%</td>
              <td style="text-align: right; font-weight: 700;">${taxAmtFormatted}</td>
            </tr>
          </tbody>
        </table>

        <div class="po-words-card">
          <div class="po-words-label">AMOUNT IN WORDS</div>
          <div class="po-words-val">${rupeesInWords(grandTotal)}</div>
        </div>
      </td>
      <td style="width: 45%;">
        <table class="po-calc-table">
          <tr>
            <td class="po-calc-lbl">Taxable Amount</td>
            <td class="po-calc-val">${amtFormatted}</td>
          </tr>
          <tr>
            <td class="po-calc-lbl">CGST</td>
            <td class="po-calc-val">${halfTaxFormatted}</td>
          </tr>
          <tr>
            <td class="po-calc-lbl">SGST</td>
            <td class="po-calc-val">${halfTaxFormatted}</td>
          </tr>
          <tr class="po-grand-row">
            <td class="po-grand-lbl">GRAND TOTAL</td>
            <td class="po-grand-val">Rs. ${grandTotalFormatted}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Terms & Conditions -->
  <div class="po-terms-box">
    <div class="po-terms-title">TERMS &amp; CONDITIONS</div>
    <ol class="po-terms-list">
      <li>Against Proforma Invoice.</li>
      <li>Material must match the approved drawing / sample in all respects.</li>
      <li>Quote this PO number on all invoices, challans and correspondence.</li>
      <li>Goods rejected on inspection are to be replaced at supplier’s cost.</li>
    </ol>
  </div>

  <!-- Signatures Section -->
  <div class="po-sig-sec">
    <table class="po-sig-table">
      <tr>
        <td>
          <div class="po-sig-space"></div>
          <div class="po-sig-line">APPROVED BY</div>
        </td>
        <td>
          <div class="po-sig-space"></div>
          <div class="po-sig-line">PREPARED BY</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Footer Meta -->
  <div class="po-foot-meta">
    <span>This is a computer-generated purchase order. &nbsp;·&nbsp; Subject to Rajkot Jurisdiction. E.&amp;O.E.</span>
    <span>${esc(poNumber)} &nbsp;•&nbsp; Page 1 of 1</span>
  </div>
</div>
`;
}

export function salesRecordHtml(r: SalesRecord) {
  if (r.kind === 'purchase_order') {
    return purchaseOrderUflowHtml(r);
  }

  const k = r.kind;
  const rates = canSee('sales_rates');
  const hasItem = k === 'quotation' || k === 'sales_order' || k === 'final_order';

  // ---- the detail lines, per kind
  let pairs: Pair[];
  if (k === 'task') {
    pairs = [['Task', r.title, true], ['Assigned To', r.assignee], ['Priority', r.priority], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo], ['Status', r.status]];
  } else if (k === 'inquiry') {
    pairs = [['Customer', party(r.party), true], ['Contact Person', party(r.contact)], ['Phone', party(r.phone)], ['Product', r.product], ['Quantity', r.qty == null ? '' : `${r.qty} PCS`], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo]];
  } else {
    pairs = [['Customer', party(r.party), true], [DUE_LABEL[k], dmy(r.dueDate)], [REF_LABEL[k], r.refNo]];
    if (k === 'sales_order') pairs.push(['Customer PO No.', r.extRef]);
  }

  // ---- the item table (Quotation / Sales Order / Final Order)
  const item = hasItem
    ? `<table class="pt">
    <tr><th style="width:34px">Sr. No.</th><th>Product</th><th>Quantity (PCS)</th>${rates ? '<th>Rate (₹ / pc)</th><th>Amount (₹)</th>' : ''}</tr>
    <tr><td class="n">1</td><td class="p">${esc(r.product)}</td><td>${r.qty ?? ''}</td>${rates ? `<td>${r.rate == null ? '' : inr(r.rate)}</td><td>${r.amount == null ? '' : inr(r.amount)}</td>` : ''}</tr>
    ${rates ? `<tr class="tot"><td colspan="4" style="text-align:right">Total</td><td>${r.amount == null ? '' : inr(r.amount)}</td></tr>` : ''}
  </table>
  ${rates && r.amount != null ? `<table class="words"><tr><td>Amount in words : ${rupeesInWords(r.amount)}</td></tr></table>` : ''}`
    : '';

  const now = new Date();
  const stamp = `${dmy(now.toISOString())} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return `<div class="rc sd">
  <table class="hd">
    <tr><td style="width:34%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td class="ttl">${TITLE[k]}</td>
        <td class="fm" style="width:24%">${k === 'task' ? '' : `Status : ${esc(r.status)}`}</td></tr>
  </table>
  <table class="no">
    <tr><td class="l" style="width:50%">${NO_LABEL[k]} &nbsp;<span class="v">${esc(r.docNo)}</span></td><td class="l" style="text-align:right">Date : <span class="v">${dmy(r.docDate)}</span></td></tr>
  </table>
  ${detailTable(pairs)}
  ${item}
  <table class="rem">
    <tr><td class="l">Remarks : <span class="v" style="font-weight:600;font-size:13px">${esc(r.remarks)}</span></td></tr>
  </table>
  <table class="sign"><tr><td>Prepared By:<small>Signature &amp; date</small></td><td>Approved By:<small>Signature &amp; date</small></td></tr></table>
  <div class="foot"><span>Everest Auto Forge Pvt. Ltd.</span><span>${esc(r.docNo)} · printed ${stamp}</span></div>
</div>`;
}

export const printSalesRecord = (r: SalesRecord) => {
  if (r.kind === 'purchase_order') {
    printHtml(`Purchase Order ${r.docNo}`, salesRecordHtml(r), PO_UFLOW_CSS);
  } else {
    printHtml(`${TITLE[r.kind]} ${r.docNo}`, salesRecordHtml(r), ROUTE_CARD_CSS + SALES_CSS);
  }
};

