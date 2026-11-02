import { canSee, currentUserName } from '../auth/access';
import { printHtml } from '../components/printHtml';
import { PO_UFLOW_CSS, rupeesInWords } from '../sales/print';
import type { PODetail } from './types';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const dmy = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;
};

export function printPurchaseOrder(po: PODetail) {
  const showRates = canSee('purchase_rates');
  const showParty = canSee('party_names');

  const isInter = po.taxType === 'inter';
  const totalTaxable = po.taxableAmount || 0;
  const totalGst = po.gstAmount || 0;
  const halfGst = Math.round((totalGst / 2) * 100) / 100;
  const grandTotal = po.totalAmount || 0;

  const revTag = po.revNo > 0 ? ` (REV ${po.revNo})` : '';

  const taxableFmt = totalTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalGstFmt = totalGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const halfGstFmt = halfGst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grandTotalFmt = grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const vendorParty = showParty ? (po.supplierName || '—') : '—';
  const docDate = dmy(po.poDate);
  const deliveryDate = dmy(po.deliveryDate);
  const poNumber = po.poNo || '';

  const html = `
<div class="po-doc">
  <!-- Top Header Table -->
  <table class="po-top-table">
    <tr>
      <td style="width: 68%;">
        <div class="po-header-left">
          <img src="/everest-logo.png" alt="Everest Auto Forge" class="po-logo" onerror="this.style.display='none'" />
        </div>
      </td>
      <td style="width: 32%; text-align: right;">
        <div class="po-meta-card">
          <div class="po-meta-title">PURCHASE ORDER</div>
          <table class="po-meta-table">
            <tr>
              <td class="po-meta-label">PO No.</td>
              <td class="po-meta-val">${esc(poNumber)}${esc(revTag)}</td>
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
            <div class="po-addr-company">${esc(vendorParty)}</div>
            ${showParty && po.supplierEmail ? `<div>Email: ${esc(po.supplierEmail)}</div>` : ''}
            <div>Priority: <b>${esc(po.urgency)}</b></div>
            <div>Payment Terms: <b>${esc(po.paymentTerms || '30 Days')}</b></div>
          </div>
        </div>
      </td>
      <td>
        <div class="po-addr-box">
          <div class="po-addr-head">DELIVERY ADDRESS / TERMS</div>
          <div class="po-addr-body">
            <div class="po-addr-company">Everest Auto Forge Pvt. Ltd.</div>
            <div>Plot No. 12, Industrial Area, Sector 5</div>
            <div>Delivery Terms: <b>${esc(po.deliveryTerms || 'Door Delivery')}</b></div>
            <div>Tax Type: <b>${isInter ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}</b></div>
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
        <th style="width: 65px; text-align: center;">HSN</th>
        <th style="text-align: left;">DESCRIPTION &amp; SPECIFICATIONS</th>
        <th style="width: 50px; text-align: center;">UOM</th>
        <th style="width: 65px; text-align: right;">QTY</th>
        <th style="width: 75px; text-align: right;">RATE<br/><small style="font-weight:400;text-transform:none;">Rs.</small></th>
        <th style="width: 50px; text-align: center;">GST</th>
        <th style="width: 100px; text-align: right;">AMOUNT<br/><small style="font-weight:400;text-transform:none;">Rs.</small></th>
      </tr>
    </thead>
    <tbody>
      ${po.items.map((it, idx) => {
        const lineTaxable = it.qty * it.rate;
        const lineTaxableFmt = lineTaxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const rateFmt = it.rate.toFixed(2);
        const specs = [it.material, it.grade, it.size].filter(Boolean).join(' · ');
        return `
        <tr>
          <td style="text-align: center; color: #64748b;">${idx + 1}</td>
          <td style="text-align: center; font-weight: 600; color: #334155;">${esc(it.hsn || '—')}</td>
          <td>
            <div style="font-weight: 700; color: #0f172a;">${esc(it.item)}</div>
            ${specs ? `<div style="font-size: 9.5px; color: #64748b; margin-top: 1px;">${esc(specs)}</div>` : ''}
          </td>
          <td style="text-align: center; color: #334155;">${esc(it.uom || 'KG')}</td>
          <td style="text-align: right; font-weight: 700; color: #0f172a;">${it.qty.toLocaleString('en-IN')}</td>
          <td style="text-align: right; font-weight: 700; color: #0f172a;">${showRates ? rateFmt : '—'}</td>
          <td style="text-align: center; color: #334155;">${it.gstPct}%</td>
          <td style="text-align: right; font-weight: 800; color: #0f172a;">${showRates ? lineTaxableFmt : '—'}</td>
        </tr>`;
      }).join('')}
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
            ${isInter ? `
            <tr>
              <td>Integrated GST (IGST)</td>
              <td style="text-align: right;">${showRates ? taxableFmt : '—'}</td>
              <td style="text-align: center;">18%</td>
              <td style="text-align: right; font-weight: 700;">${showRates ? totalGstFmt : '—'}</td>
            </tr>` : `
            <tr>
              <td>Central GST (CGST)</td>
              <td style="text-align: right;">${showRates ? taxableFmt : '—'}</td>
              <td style="text-align: center;">9%</td>
              <td style="text-align: right; font-weight: 700;">${showRates ? halfGstFmt : '—'}</td>
            </tr>
            <tr>
              <td>State GST (SGST)</td>
              <td style="text-align: right;">${showRates ? taxableFmt : '—'}</td>
              <td style="text-align: center;">9%</td>
              <td style="text-align: right; font-weight: 700;">${showRates ? halfGstFmt : '—'}</td>
            </tr>`}
          </tbody>
        </table>

        <div class="po-words-card">
          <div class="po-words-label">AMOUNT IN WORDS</div>
          <div class="po-words-val">${showRates ? rupeesInWords(grandTotal) : '—'}</div>
        </div>
      </td>
      <td style="width: 45%;">
        <table class="po-calc-table">
          <tr>
            <td class="po-calc-lbl">Taxable Amount</td>
            <td class="po-calc-val">${showRates ? `Rs. ${taxableFmt}` : '—'}</td>
          </tr>
          ${isInter ? `
          <tr>
            <td class="po-calc-lbl">IGST</td>
            <td class="po-calc-val">${showRates ? `Rs. ${totalGstFmt}` : '—'}</td>
          </tr>` : `
          <tr>
            <td class="po-calc-lbl">CGST</td>
            <td class="po-calc-val">${showRates ? `Rs. ${halfGstFmt}` : '—'}</td>
          </tr>
          <tr>
            <td class="po-calc-lbl">SGST</td>
            <td class="po-calc-val">${showRates ? `Rs. ${halfGstFmt}` : '—'}</td>
          </tr>`}
          <tr class="po-grand-row">
            <td class="po-grand-lbl">GRAND TOTAL</td>
            <td class="po-grand-val">${showRates ? `Rs. ${grandTotalFmt}` : '—'}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- Terms & Conditions -->
  <div class="po-terms-box">
    <div class="po-terms-title">TERMS &amp; CONDITIONS</div>
    <ol class="po-terms-list">
      <li>Payment as per agreed terms: ${esc(po.paymentTerms || '30 Days')}.</li>
      <li>Material must match the approved drawing / specification / grade in all respects.</li>
      <li>Quote this PO number on all invoices, delivery challans and correspondence.</li>
      <li>Goods rejected on inspection are to be replaced at supplier’s cost.</li>
      ${po.otherTerms ? `<li><b>Special Note:</b> ${esc(po.otherTerms)}</li>` : ''}
    </ol>
  </div>

  <!-- Signatures Section -->
  <div class="po-sig-sec">
    <table class="po-sig-table">
      <tr>
        <td>
          <div class="po-sig-space"><span class="po-sig-name">${esc(po.createdBy || currentUserName())}</span></div>
          <div class="po-sig-line">PREPARED BY<div class="po-sig-sub">${esc(dmy(po.createdAt))}</div></div>
        </td>
        <td>
          <div class="po-sig-space"><span class="po-sig-name">${esc(po.approvedBy || '')}</span></div>
          <div class="po-sig-line">APPROVED BY<div class="po-sig-sub">${po.approvedBy ? esc(dmy(po.approvedAt)) : 'Pending'}</div></div>
        </td>
        <td>
          <div class="po-sig-space"><span class="po-sig-name">${esc(po.releasedBy || '')}</span></div>
          <div class="po-sig-line">AUTHORISED SIGNATORY<div class="po-sig-sub">For Everest Auto Forge Pvt. Ltd.</div></div>
        </td>
      </tr>
    </table>
  </div>

  <!-- Footer Meta -->
  <div class="po-foot-meta">
    <span>This is a computer-generated purchase order. &nbsp;·&nbsp; Subject to Rajkot Jurisdiction. E.&amp;O.E.</span>
    <span>${esc(poNumber)} &nbsp;•&nbsp; Page 1 of 1</span>
  </div>
</div>`;

  printHtml(`Purchase Order ${po.poNo}${revTag}`, html, PO_UFLOW_CSS);
}
