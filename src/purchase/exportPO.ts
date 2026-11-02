// The purchase order as an Excel sheet, in the company form layout (src/export/xlsxSheet.ts) — to be attached to a mail by hand.
// Same content as the printed PO: vendor, terms, lines, GST and totals. Rates and amounts only for people who may see purchase rates.
import { canSee } from '../auth/access';
import { FORM_FORMATS, downloadFormSheet, type SheetBlock } from '../export/xlsxSheet';
import { rupeesInWords } from '../sales/print';
import type { PODetail } from './types';

const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '');
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function exportPurchaseOrderXlsx(po: PODetail, user: string) {
  const rates = canSee('purchase_rates');
  const party = canSee('party_names');
  const inter = po.taxType === 'inter';
  const revTag = po.revNo > 0 ? ` (REV ${po.revNo})` : '';
  const gst = po.gstAmount || 0;

  const lines: SheetBlock = {
    headers: ['Sr. No.', 'HSN', 'Description & Specifications', 'UOM', 'Qty', 'Rate (₹)', 'GST %', 'Amount (₹)'],
    align: ['center', 'center', 'left', 'center', 'right', 'right', 'center', 'right'],
    rows: [
      ...po.items.map((it, i) => ({
        cells: [i + 1, it.hsn || '', [it.item, [it.material, it.grade, it.size].filter(Boolean).join(' · ')].filter(Boolean).join('\n'), it.uom || 'KG', it.qty, rates ? it.rate : '', it.gstPct, rates ? r2(it.qty * it.rate) : ''],
      })),
      ...(rates
        ? [
            { cells: ['', '', '', '', '', '', 'Taxable', po.taxableAmount || 0] },
            ...(inter ? [{ cells: ['', '', '', '', '', '', 'IGST', r2(gst)] }] : [{ cells: ['', '', '', '', '', '', 'CGST', r2(gst / 2)] }, { cells: ['', '', '', '', '', '', 'SGST', r2(gst / 2)] }]),
            { cells: ['', '', '', '', '', '', 'Grand Total', po.totalAmount || 0], bold: true },
          ]
        : []),
    ],
  };

  await downloadFormSheet({
    filename: `${po.poNo}${po.revNo > 0 ? `-REV${po.revNo}` : ''}`,
    sheet: po.poNo,
    form: FORM_FORMATS.purchaseOrder,
    title: 'Purchase Order',
    info: [
      [`Vendor :- ${party ? po.supplierName || '' : ''}`, `PO No :- ${po.poNo}${revTag}`],
      [`Date :- ${dmy(po.poDate)}`, `Delivery Date :- ${dmy(po.deliveryDate)}`, `Priority :- ${po.urgency}`],
      [`Payment Terms :- ${po.paymentTerms || ''}`, `Delivery Terms :- ${po.deliveryTerms || ''}`, `Tax :- ${inter ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`],
    ],
    widths: [8, 11, 38, 8, 11, 13, 9, 15],
    blocks: [lines],
    notes: [...(rates ? [`Amount in words : ${rupeesInWords(po.totalAmount || 0)}`] : []), ...(po.otherTerms ? [`Other terms : ${po.otherTerms}`] : [])],
    checkedBy: user,
    reviewedBy: po.approvedBy ?? '',
  });
}
