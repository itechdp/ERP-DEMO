// The quotation as an Excel sheet, in the company form layout (src/export/xlsxSheet.ts).
// Standard = the same columns as the printed quotation; detailed = the same plus each line's cost sheet.
import { FORM_FORMATS, downloadFormSheet, type SheetBlock } from '../export/xlsxSheet';
import { dmy, rupeesInWords } from '../sales/print';
import type { QuotationLine, QuotationRow } from './types';
import type { QuotationOutput } from './print';

export async function exportQuotationXlsx(q: QuotationRow, lines: QuotationLine[], user: string, opts: QuotationOutput = {}) {
  const total = q.amount ?? lines.reduce((a, l) => a + (l.amount ?? 0), 0);
  const blocks: SheetBlock[] = [
    {
      headers: ['Sr. No.', 'Product', 'Qty', 'UOM', 'Rate (₹)', 'Disc. %', 'Net Rate (₹)', 'Amount (₹)'],
      align: ['center', 'left', 'right', 'center', 'right', 'right', 'right', 'right'],
      rows: [
        ...lines.map((l, i) => ({
          cells: [i + 1, [l.product, [l.grade, l.size].filter(Boolean).join(' • ')].filter(Boolean).join('\n'), l.qty, l.uom, l.rate, l.discountPct || 0, l.netRate, l.amount],
        })),
        { cells: ['', 'Total', '', '', '', '', '', total], bold: true },
      ],
    },
  ];

  if (opts.detailed) {
    const sheets = lines.filter((l) => l.costing?.length);
    for (const l of sheets) {
      blocks.push({
        heading: `Cost sheet — ${l.product}${[l.grade, l.size].filter(Boolean).length ? ` (${[l.grade, l.size].filter(Boolean).join(' • ')})` : ''}`,
        headers: ['Sr. No.', 'Description', 'Calculation', 'Amount (₹)'],
        spans: [1, 3, 3, 1],
        align: ['center', 'left', 'left', 'right'],
        rows: (l.costing ?? []).map((r, i) => ({ cells: [i + 1, r.label, r.basis, r.amount], bold: r.bold })),
      });
    }
  }

  await downloadFormSheet({
    filename: `Quotation-${q.docNo}${opts.detailed ? '-detailed' : ''}`,
    sheet: q.docNo,
    form: FORM_FORMATS.quotation,
    title: 'Sales Quotation',
    info: [
      [`Customer :- ${q.customer}`, `Quotation No :- ${q.docNo}`],
      [`Attention :- ${q.contact || ''}`, `Date :- ${dmy(q.qtDate)}`, `Valid Until :- ${dmy(q.validUntil)}`],
      [`Phone :- ${q.phone || ''}`, `Email :- ${q.email || ''}`, `Enquiry Ref. :- ${q.enquiryNo || ''}`],
    ],
    widths: [8, 34, 9, 8, 13, 9, 13, 15],
    blocks,
    notes: [
      `Amount in words : ${rupeesInWords(total)}`,
      `Payment terms : ${q.paymentTerms || '—'}      Delivery terms : ${q.deliveryTerms || '—'}`,
      ...(q.remarks ? [`Remarks : ${q.remarks}`] : []),
    ],
    checkedBy: user,
    reviewedBy: q.approvedBy ?? '',
  });
}
