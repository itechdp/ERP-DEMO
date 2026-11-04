// Every document of the system as a SheetSpec (see docOutput.tsx): the same description gives the Excel sheet in the company layout and the PDF.
// Confidential figures follow the signed-in person's access, exactly as on the printouts: customer / supplier names (party names),
// sales rates, purchase rates.
import { canSee } from '../auth/access';
import { dmy } from '../sales/print';
import { getJob, getProduct, hardnessVerdict, jobSummary, readingResult, requiredText, STAGE_LABEL, PROCESS_STAGES } from '../store/engine';
import type { Dispatch, ERPState, HardnessReport, JobWork, QCRecord, RawMaterialLot } from '../store/types';
import type { InvoiceDetail, PRDetail, PurchasePayment, RFQDetail, SQDetail, ComparisonMatrix, SupplierPayable } from '../purchase/types';
import type { OrderLine, OrderRow } from '../salesmod/types';
import type { JobWorkOut } from '../jobworkout/service';
import { stepLines, type Instruction } from '../instructions/service';
import { FORM_FORMATS, type SheetSpec, type SheetValue } from './xlsxSheet';

const d = (iso?: string | null) => (iso ? dmy(iso) : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
const party = (v?: string | null) => (canSee('party_names') ? v || '' : '');
const rate = (v: number | null | undefined) => (canSee('sales_rates') && v != null ? v : '');
const spec = (v: number | null | undefined) => (canSee('purchase_rates') && v != null ? v : '');
const specLine = (o: { material?: string; grade?: string; size?: string }) => [o.material, o.grade, o.size].filter(Boolean).join(' · ');
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

// ---------------------------------------------------------------- sales
export function salesOrderSpec(o: OrderRow, lines: OrderLine[], user: string): SheetSpec {
  const money = canSee('sales_rates');
  const total = lines.reduce((t, l) => t + (l.qty ?? 0) * (l.rate ?? 0), 0);
  return {
    filename: o.soNo,
    sheet: o.soNo,
    form: FORM_FORMATS.salesOrder,
    title: 'Sales Order',
    info: [
      [`Customer :- ${party(o.customer)}`, `Order No :- ${o.soNo}`, `Order Date :- ${d(o.soDate)}`],
      [`Contact :- ${[party(o.contact), o.phone].filter(Boolean).join(' · ')}`, `Customer PO No :- ${o.extRef || ''}`, `Delivery Date :- ${d(o.deliveryDate)}`],
      [`Payment Terms :- ${o.paymentTerms || ''}`, `Delivery Terms :- ${o.deliveryTerms || ''}`, `Status :- ${o.status}${o.quotationNo ? ` · Quotation ${o.quotationNo}` : ''}`],
    ],
    widths: [7, 30, 14, 14, 8, 11, 13, 15],
    blocks: [
      {
        headers: ['Sr. No.', 'Product', 'Grade', 'Size', 'UOM', 'Qty', 'Rate (₹)', 'Amount (₹)'],
        align: ['center', 'left', 'left', 'left', 'center', 'right', 'right', 'right'],
        rows: [
          ...lines.map((l, i) => ({ cells: [i + 1, l.product, l.grade, l.size, l.uom, l.qty, rate(l.rate), money ? r2((l.qty ?? 0) * (l.rate ?? 0)) : ''] as SheetValue[] })),
          ...(money ? [{ cells: ['', '', '', '', '', '', 'Total', r2(total)] as SheetValue[], bold: true }] : []),
        ],
      },
    ],
    notes: [...(o.remarks ? [`Remarks : ${o.remarks}`] : [])],
    checkedBy: user,
  };
}

// ---------------------------------------------------------------- purchase
export function purchaseRequisitionSpec(pr: PRDetail, user: string): SheetSpec {
  return {
    filename: pr.prNo,
    sheet: pr.prNo,
    form: FORM_FORMATS.purchaseRequisition,
    title: 'Purchase Requisition',
    info: [
      [`Requisition No :- ${pr.prNo}`, `Date :- ${d(pr.prDate)}`, `Priority :- ${pr.urgency}`],
      [`Requested By :- ${pr.requestedBy || ''}`, `Department :- ${pr.department || ''}`, `Status :- ${pr.status}`],
    ],
    widths: [7, 28, 26, 12, 8, 11, 14, 12],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'Material / Grade / Size', 'UOM', 'Qty', 'Ordered', 'Required By', 'Remaining'],
        align: ['center', 'left', 'left', 'center', 'right', 'right', 'center', 'right'],
        rows: pr.items.map((it) => ({ cells: [it.lineNo, it.item, specLine(it), it.uom, it.qty, it.orderedQty, d(it.requiredDate), it.remainingQty ?? Math.max(0, it.qty - it.orderedQty)] as SheetValue[] })),
      },
    ],
    notes: [...(pr.remarks ? [`Remarks : ${pr.remarks}`] : []), ...(pr.approvedBy ? [`Approved by ${pr.approvedBy}${pr.approvedAt ? ` on ${d(pr.approvedAt)}` : ''}`] : [])],
    checkedBy: user,
    reviewedBy: pr.approvedBy ?? '',
  };
}

export function procurementRequestSpec(rfq: RFQDetail, user: string): SheetSpec {
  const items = rfq.pr?.items ?? [];
  return {
    filename: rfq.rfqNo,
    sheet: rfq.rfqNo,
    form: FORM_FORMATS.procurementRequest,
    title: 'Procurement of Material',
    info: [
      [`Request No :- ${rfq.rfqNo}`, `Date :- ${d(rfq.rfqDate)}`, `Quotation Due :- ${d(rfq.dueDate)}`],
      [`Requisition :- ${rfq.prNo || ''}`, `Status :- ${rfq.status}`, `Suppliers :- ${rfq.suppliers.length}`],
    ],
    widths: [7, 30, 28, 10, 11, 14],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'Material / Grade / Size', 'UOM', 'Qty', 'Required By'],
        align: ['center', 'left', 'left', 'center', 'right', 'center'],
        rows: items.map((it) => ({ cells: [it.lineNo, it.item, specLine(it), it.uom, it.qty, d(it.requiredDate)] as SheetValue[] })),
      },
      ...(canSee('party_names') && rfq.suppliers.length
        ? [{ heading: 'Sent to', headers: ['Sr. No.', 'Supplier', 'Phone', 'E-mail', 'Sent', 'Replied'], align: ['center', 'left', 'left', 'left', 'center', 'center'] as ('left' | 'center' | 'right')[], rows: rfq.suppliers.map((s, i) => ({ cells: [i + 1, s.supplierName ?? '', s.supplierPhone ?? '', s.supplierEmail ?? '', d(s.sentAt), d(s.respondedAt)] as SheetValue[] })) }]
        : []),
    ],
    checkedBy: user,
  };
}

export function supplierQuotationSpec(sq: SQDetail, user: string): SheetSpec {
  const money = canSee('purchase_rates');
  const total = sq.items.reduce((t, it) => t + it.qty * it.rate, 0);
  return {
    filename: sq.sqNo,
    sheet: sq.sqNo,
    form: FORM_FORMATS.supplierQuotation,
    title: 'Supplier Quotation',
    info: [
      [`Quotation No :- ${sq.sqNo}`, `Date :- ${d(sq.sqDate)}`, `Valid Till :- ${d(sq.validTill)}`],
      [`Supplier :- ${party(sq.supplierName)}`, `Request :- ${sq.rfqNo || ''}`, `Requisition :- ${sq.prNo || ''}`],
      [`Payment Terms :- ${sq.paymentTerms || ''}`, `Delivery Terms :- ${sq.deliveryTerms || ''}`, `Lead Time :- ${sq.leadDays != null ? `${sq.leadDays} days` : ''} · ${sq.status}`],
    ],
    widths: [7, 28, 26, 8, 11, 13, 15],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'Material / Grade / Size', 'UOM', 'Qty', 'Rate (₹)', 'Amount (₹)'],
        align: ['center', 'left', 'left', 'center', 'right', 'right', 'right'],
        rows: [
          ...sq.items.map((it, i) => ({ cells: [i + 1, it.item, specLine(it), it.uom, it.qty, spec(it.rate), money ? r2(it.qty * it.rate) : ''] as SheetValue[] })),
          ...(money ? [{ cells: ['', '', '', '', '', 'Total', r2(total)] as SheetValue[], bold: true }] : []),
        ],
      },
    ],
    checkedBy: user,
  };
}

export function comparisonSpec(m: ComparisonMatrix, user: string): SheetSpec {
  const money = canSee('purchase_rates');
  const sup = m.suppliers;
  return {
    filename: `Quotation-Comparison-${safe(m.prNo ?? m.rfqNo ?? 'PR')}`,
    sheet: 'Comparison',
    form: FORM_FORMATS.quotationComparison,
    title: 'Quotation Comparison',
    info: [[`Requisition :- ${m.prNo || ''}`, `Request :- ${m.rfqNo || ''}`, `Suppliers :- ${sup.length}`]],
    widths: [7, 28, 20, 11, ...sup.map(() => 18)],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'Grade / Size', 'Required', ...sup.map((s) => (canSee('party_names') ? s.supplierName : s.sqNo))],
        align: ['center', 'left', 'left', 'right', ...sup.map(() => 'right' as const)],
        rows: [
          ...m.items.map((it, i) => ({ cells: [i + 1, it.item, [it.grade, it.size].filter(Boolean).join(' · '), it.requiredQty, ...sup.map((s) => (money ? it.quotes[s.sqId]?.rate ?? '' : ''))] as SheetValue[] })),
          ...(money ? [{ cells: ['', 'Total', '', '', ...sup.map((s) => r2(s.totalAmount))] as SheetValue[], bold: true }] : []),
          { cells: ['', 'Lead time (days)', '', '', ...sup.map((s) => s.leadDays ?? '')] as SheetValue[] },
          { cells: ['', 'Payment terms', '', '', ...sup.map((s) => s.paymentTerms ?? '')] as SheetValue[] },
        ],
      },
    ],
    checkedBy: user,
  };
}

/** goods receipt note for one raw-material inward lot */
export function goodsReceiptSpec(l: RawMaterialLot, user: string): SheetSpec {
  return {
    filename: `GRN-${l.id}`,
    sheet: l.id,
    form: FORM_FORMATS.goodsReceipt,
    title: 'Goods Receipt Note',
    info: [
      [`Lot No :- ${l.id}`, `Inward Date :- ${d(l.inwardDate)}`, `PO No :- ${l.poNo || ''}`],
      [`Supplier :- ${party(l.supplier)}`, `Invoice No :- ${l.invoiceNo || ''}`, `Heat No :- ${l.heatNo || ''}`],
    ],
    widths: [7, 28, 18, 12, 12, 14, 14, 14],
    blocks: [
      {
        headers: ['Sr. No.', 'Material', 'Grade', 'OD (mm)', 'Qty (PCS)', 'Weight (KG)', 'Accepted (KG)', 'Rate (₹/KG)'],
        align: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
        rows: [{ cells: [1, l.material, l.materialType, l.od, l.inwardQty, l.inwardWeight, l.acceptedWeight ?? '', spec(l.purchaseRate)] as SheetValue[] }],
      },
    ],
    notes: [`Incoming QC : ${l.qcStatus ?? 'Not recorded'}${l.blockedQty ? ` · ${l.blockedQty} PCS rejected` : ''}`],
    checkedBy: user,
  };
}

export function purchaseInvoiceSpec(inv: InvoiceDetail, user: string): SheetSpec {
  const money = canSee('purchase_rates');
  const inter = inv.taxType === 'inter';
  return {
    filename: inv.pinvNo,
    sheet: inv.pinvNo,
    form: FORM_FORMATS.purchaseInvoice,
    title: 'Purchase Invoice',
    info: [
      [`Our Ref :- ${inv.pinvNo}`, `Supplier Invoice :- ${inv.supplierInvNo}`, `Invoice Date :- ${d(inv.invDate)}`],
      [`Supplier :- ${party(inv.supplierName)}`, `PO No :- ${inv.poNo || ''}`, `Due Date :- ${d(inv.dueDate)}`],
      [`Tax :- ${inter ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`, `Status :- ${inv.status}`, `Payment :- ${inv.payStatus}`],
    ],
    widths: [7, 34, 11, 13, 9, 15],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'Qty', 'Rate (₹)', 'GST %', 'Amount (₹)'],
        align: ['center', 'left', 'right', 'right', 'center', 'right'],
        rows: [
          ...inv.items.map((it) => ({ cells: [it.lineNo, it.item, it.qty, spec(it.rate), it.gstPct, money ? r2(it.amount) : ''] as SheetValue[] })),
          ...(money
            ? [
                { cells: ['', '', '', '', 'Taxable', r2(inv.taxableAmount)] as SheetValue[] },
                ...(inter ? [{ cells: ['', '', '', '', 'IGST', r2(inv.gstAmount)] as SheetValue[] }] : [{ cells: ['', '', '', '', 'CGST', r2(inv.gstAmount / 2)] as SheetValue[] }, { cells: ['', '', '', '', 'SGST', r2(inv.gstAmount / 2)] as SheetValue[] }]),
                { cells: ['', '', '', '', 'Total', r2(inv.totalAmount)] as SheetValue[], bold: true },
                { cells: ['', '', '', '', 'Paid', r2(inv.paidAmount)] as SheetValue[] },
                { cells: ['', '', '', '', 'Balance', r2(inv.balance)] as SheetValue[], bold: true },
              ]
            : []),
        ],
      },
      ...(money && inv.payments.length
        ? [{ heading: 'Payments', headers: ['Sr. No.', 'Payment No.', 'Date', 'Mode', 'Reference', 'Amount (₹)'], align: ['center', 'left', 'center', 'left', 'left', 'right'] as ('left' | 'center' | 'right')[], rows: inv.payments.map((p, i) => ({ cells: [i + 1, p.payNo, d(p.payDate), p.mode, p.reference ?? '', r2(p.amount)] as SheetValue[] })) }]
        : []),
    ],
    notes: [...(inv.varianceNote ? [`Variance : ${inv.varianceNote}`] : []), ...(inv.cancelReason ? [`Cancelled : ${inv.cancelReason}`] : [])],
    checkedBy: user,
    reviewedBy: inv.postedBy ?? '',
  };
}

export function paymentVoucherSpec(p: PurchasePayment, user: string): SheetSpec {
  const money = canSee('purchase_rates');
  return {
    filename: p.payNo,
    sheet: p.payNo,
    form: FORM_FORMATS.paymentVoucher,
    title: 'Payment Voucher',
    info: [
      [`Voucher No :- ${p.payNo}`, `Date :- ${d(p.payDate)}`, `Mode :- ${p.mode}`],
      [`Paid To :- ${party(p.supplierName)}`, `Against Invoice :- ${p.pinvNo} (${p.supplierInvNo})`, `PO No :- ${p.poNo || ''}`],
    ],
    widths: [7, 40, 26, 18],
    blocks: [{ headers: ['Sr. No.', 'Particulars', 'Reference', 'Amount (₹)'], align: ['center', 'left', 'left', 'right'], rows: [{ cells: [1, `Payment against invoice ${p.pinvNo}`, p.reference ?? '', money ? r2(p.amount) : ''] as SheetValue[] }] }],
    notes: [...(p.notes ? [`Notes : ${p.notes}`] : [])],
    checkedBy: user,
    reviewedBy: p.createdBy ?? '',
  };
}

export function payablesSpec(rows: SupplierPayable[], user: string): SheetSpec {
  const n = (v: number) => r2(v);
  return {
    filename: 'Supplier-Payables',
    sheet: 'Supplier Payables',
    form: FORM_FORMATS.payables,
    title: 'Supplier Payables Statement',
    info: [[`Date :- ${dmy(new Date().toISOString())}`, `Suppliers :- ${rows.length}`, `Outstanding :- ${n(rows.reduce((t, r) => t + r.outstanding, 0))}`]],
    widths: [7, 28, 10, 10, 14, 14, 14, 14, 12, 12, 12, 12],
    blocks: [
      {
        headers: ['Sr. No.', 'Supplier', 'Code', 'Open Inv.', 'Invoiced (₹)', 'Paid (₹)', 'Outstanding (₹)', 'Overdue (₹)', '0–30', '31–60', '61–90', '90+'],
        align: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        rows: [
          ...rows.map((r, i) => ({ cells: [i + 1, party(r.supplierName), r.supplierCode, r.openInvoices, n(r.totalInvoiced), n(r.totalPaid), n(r.outstanding), n(r.overdueAmount), n(r.b0to30), n(r.b31to60), n(r.b61to90), n(r.b90plus)] as SheetValue[] })),
          { cells: ['', 'Total', '', '', n(rows.reduce((t, r) => t + r.totalInvoiced, 0)), n(rows.reduce((t, r) => t + r.totalPaid, 0)), n(rows.reduce((t, r) => t + r.outstanding, 0)), n(rows.reduce((t, r) => t + r.overdueAmount, 0)), n(rows.reduce((t, r) => t + r.b0to30, 0)), n(rows.reduce((t, r) => t + r.b31to60, 0)), n(rows.reduce((t, r) => t + r.b61to90, 0)), n(rows.reduce((t, r) => t + r.b90plus, 0))] as SheetValue[], bold: true },
        ],
      },
    ],
    checkedBy: user,
  };
}

// ---------------------------------------------------------------- workflow
export function jobWorkOutSpec(j: JobWorkOut, user: string): SheetSpec {
  return {
    filename: j.outNo,
    sheet: j.outNo,
    form: FORM_FORMATS.jobWorkOut,
    title: 'Job Work Out Challan',
    info: [
      [`Challan No :- ${j.outNo}`, `Date :- ${d(j.outDate)}`, `Our Challan Ref :- ${j.challanNo || ''}`],
      [`Given To :- ${party(j.vendor)}`, `Contact :- ${[j.contact, j.phone].filter(Boolean).join(' · ')}`, `Job Card :- ${j.jobNo || ''}`],
      [`Due Date :- ${d(j.dueDate)}`, `Status :- ${j.status === 'Sent' ? 'With others' : j.status}`, `Received On :- ${d(j.receivedOn)}`],
    ],
    widths: [7, 30, 24, 14, 10],
    blocks: [{ headers: ['Sr. No.', 'Item', 'Work to be done', 'Qty', 'UOM'], align: ['center', 'left', 'left', 'right', 'center'], rows: [{ cells: [1, j.item, j.process, j.qty, j.uom] as SheetValue[] }] }],
    notes: [...(j.remarks ? [`Remarks : ${j.remarks}`] : []), 'Goods received by the party above in good condition; to be returned on or before the due date.'],
    checkedBy: user,
  };
}

export function hardnessReportSpec(r: HardnessReport, user: string): SheetSpec {
  const verdict = hardnessVerdict(r);
  return {
    filename: r.id,
    sheet: r.id,
    form: FORM_FORMATS.hardnessReport,
    title: 'Hardness Inspection Report',
    info: [
      [`Report No :- ${r.id}`, `Date :- ${d(r.date)}`, `Job Card :- ${r.jobNo || ''}`],
      [`Component :- ${r.component}`, `Material :- ${r.material}${r.grade ? ` · ${r.grade}` : ''}`, `Supplier :- ${party(r.supplier)}`],
      [`Inward Qty :- ${r.inwardQty || ''}`, `Inspected Qty :- ${r.inspectedQty}`, `Cycle No :- ${r.cycleNo || ''}`],
      [`Required Hardness :- ${requiredText(r)}`, `Drawing No :- ${r.drawingNo || ''}`, `Result :- ${verdict}`],
    ],
    widths: [8, 22, 22, 16],
    blocks: [
      {
        headers: ['Sr. No.', 'Required', 'Hardness', 'Result'],
        align: ['center', 'center', 'center', 'center'],
        rows: r.readings.map((v, i) => ({ cells: [i + 1, requiredText(r), v ?? '', v == null ? '' : readingResult(r, v) === 'OK' ? 'OK' : 'NOT OK'] as SheetValue[] })),
      },
    ],
    notes: [...(r.remarks ? [`Remarks : ${r.remarks}`] : [])],
    checkedBy: user,
    reviewedBy: r.checkedBy,
  };
}

export function qcRecordSpec(s: ERPState, q: QCRecord, user: string): SheetSpec {
  const job = getJob(s, q.jobNo);
  const p = getProduct(s, job.productId);
  return {
    filename: `QC-${q.jobNo}`,
    sheet: q.jobNo,
    form: FORM_FORMATS.qcRecord,
    title: 'QC Inspection Record',
    info: [
      [`Job Card :- ${q.jobNo}`, `Item :- ${p.name}`, `Customer :- ${party(job.customer)}`],
      [`Received :- ${d(q.receivedAt)}`, `Inspected :- ${d(q.inspectedAt)}`, `Inspector :- ${q.inspector || ''}`],
    ],
    widths: [7, 30, 18, 18, 18],
    blocks: [{ headers: ['Sr. No.', 'Item', 'Received Qty', 'Accepted Qty', 'Rejected Qty'], align: ['center', 'left', 'right', 'right', 'right'], rows: [{ cells: [1, p.name, q.input, q.accepted, q.rejected] as SheetValue[] }] }],
    notes: [`Result : ${q.status}`, ...(q.rejectionReason ? [`Reason for rejection : ${q.rejectionReason}`] : []), ...(q.remarks ? [`Remarks : ${q.remarks}`] : [])],
    checkedBy: user,
    reviewedBy: q.inspector,
  };
}

/** the Process Route Card as a sheet */
export function routeCardSpec(s: ERPState, jobNo: string, user: string): SheetSpec {
  const j = jobSummary(s, jobNo);
  const job = j.job;
  const bags = j.dispatches.flatMap((x) => x.bags.map((b) => ({ x, b })));
  return {
    filename: `Route-Card-${jobNo}`,
    sheet: jobNo,
    form: FORM_FORMATS.routeCard,
    title: 'Process Route Card',
    info: [
      [`Job Card No :- ${jobNo}`, `Date :- ${d(job.createdAt)}`, `Customer :- ${party(job.customer)}`],
      [`Item Name :- ${j.product.name}`, `Product Code :- ${j.product.code}`, `Material :- ${j.product.material}`],
      [`Length :- ${j.records.cutting?.params.cuttingLength ?? j.product.cuttingLength} mm`, `Bar OD :- ${j.product.od} mm`, `Die No :- ${job.dieNo || ''}`],
      [`To Cut :- ${job.plannedQty}`, `Machine No :- ${job.machineNo || ''}`, `Final :- ${j.qc && j.qc.status !== 'QC Pending' ? j.qc.accepted : ''}`],
    ],
    widths: [7, 22, 16, 16, 14, 16, 22],
    blocks: [
      {
        headers: ['Sr. No.', 'Process', 'Inward Date', 'Received Qty', 'OK Qty', 'Rejection Qty', 'Checked By'],
        align: ['center', 'left', 'center', 'right', 'right', 'right', 'left'],
        rows: [
          ...PROCESS_STAGES.map((st, i) => {
            const r = j.records[st];
            const skipped = !!r?.params.skipped;
            return { cells: [i + 1, STAGE_LABEL[st], r ? d(r.receivedAt) : '', skipped ? 'Not required — skipped' : r?.input ?? '', skipped ? '' : r?.status === 'Completed' ? r.output : '', skipped ? '' : r?.status === 'Completed' ? r.loss : '', r?.operator ?? ''] as SheetValue[] };
          }),
          { cells: [PROCESS_STAGES.length + 1, 'QC Inspection', j.qc ? d(j.qc.receivedAt) : '', j.qc?.input ?? '', j.qc && j.qc.status !== 'QC Pending' ? j.qc.accepted : '', j.qc && j.qc.status !== 'QC Pending' ? j.qc.rejected : '', j.qc?.inspector ?? ''] as SheetValue[] },
        ],
      },
      ...(bags.length
        ? [{ heading: 'Packing / Dispatch', headers: ['Sr. No.', 'Dispatch', 'Vehicle', 'Bag', 'Qty (PCS)', 'Weight (KG)', ''], align: ['center', 'left', 'left', 'center', 'right', 'right', 'left'] as ('left' | 'center' | 'right')[], rows: bags.map(({ x, b }, i) => ({ cells: [i + 1, x.dispatchNo, canSee('party_names') ? x.vehicleNo : '', b.no, b.qty, b.weight, ''] as SheetValue[] })) }]
        : []),
    ],
    checkedBy: user,
  };
}

/** the challan printed when a customer's parts arrive (Job Work In) */
export function jobWorkReceiptSpec(s: ERPState, w: JobWork, user: string): SheetSpec {
  const job = getJob(s, w.jobNo);
  const p = getProduct(s, job.productId);
  const procs = (['cutting', 'forging', 'trimming', 'heatTreatment'] as const).filter((k) => w.processes[k]).map((k) => STAGE_LABEL[k]).join(', ');
  return {
    filename: `Job-Work-Receipt-${w.jobNo}`,
    sheet: w.jobNo,
    form: FORM_FORMATS.jobWorkIn,
    title: 'Job Work Receipt',
    info: [
      [`Job No :- ${w.jobNo}`, `Date :- ${d(w.challanDate || w.createdAt)}`, `Customer :- ${party(job.customer)}`],
      [`Customer Challan :- ${w.challanNo || ''}`, `Challan Date :- ${d(w.challanDate)}`, `Material :- ${w.materialSource === 'own' ? 'Our material' : "Customer's material"}`],
      [`Quality Check :- ${w.qcRequired ? 'Required' : 'Not required'}`, `Work :- ${procs}`, `Weight :- ${w.receivedWeight ? `${w.receivedWeight} KG` : ''}`],
    ],
    widths: [7, 26, 14, 36, 12],
    blocks: [{ headers: ['Sr. No.', 'Item', 'Part No.', 'Description', 'Qty (PCS)'], align: ['center', 'left', 'left', 'left', 'right'], rows: [{ cells: [1, p.name, p.code, w.itemDescription, w.receivedQty] as SheetValue[] }] }],
    checkedBy: user,
  };
}

/** the challan printed when the processed parts go back to the customer (Job Work In) */
export function jobWorkReturnSpec(s: ERPState, dsp: Dispatch, w: JobWork, user: string): SheetSpec {
  const job = getJob(s, dsp.jobNo);
  const p = getProduct(s, job.productId);
  return {
    filename: `Job-Work-Return-${dsp.dispatchNo}`,
    sheet: dsp.dispatchNo,
    form: FORM_FORMATS.jobWorkIn,
    title: 'Job Work Return Challan',
    info: [
      [`Return Challan :- ${dsp.dispatchNo}`, `Date :- ${d(dsp.date)}`, `Customer :- ${party(job.customer)}`],
      [`Job No :- ${w.jobNo}`, `Customer Challan :- ${w.challanNo || ''}`, `Vehicle :- ${canSee('party_names') ? dsp.vehicleNo : ''}`],
    ],
    widths: [8, 28, 16, 16],
    blocks: [
      { headers: ['Bag', 'Item', 'Qty (PCS)', 'Weight (KG)'], align: ['center', 'left', 'right', 'right'], rows: [...dsp.bags.map((b) => ({ cells: [b.no, p.name, b.qty, b.weight] as SheetValue[] })), { cells: ['', 'Total', dsp.qty, dsp.weight] as SheetValue[], bold: true }] },
    ],
    checkedBy: user,
  };
}

// ---------------------------------------------------------------- work instruction
export function workInstructionSpec(w: Instruction, user: string): SheetSpec {
  const steps = stepLines(w.steps);
  const params = w.parameters.filter((p) => p.name.trim());
  const checks = stepLines(w.checks);
  const blocks: SheetSpec['blocks'] = [];
  if (steps.length) blocks.push({ heading: 'Steps', headers: ['Step', 'Instruction'], spans: [1, 2], align: ['center', 'left'], rows: steps.map((t, i) => ({ cells: [i + 1, t] as SheetValue[] })) });
  if (params.length) blocks.push({ heading: 'Settings / parameters', headers: ['Parameter', 'Value'], spans: [2, 1], align: ['left', 'left'], rows: params.map((p) => ({ cells: [p.name, p.value] as SheetValue[] })) });
  if (checks.length) blocks.push({ heading: 'What to check', headers: ['Sr. No.', 'Check'], spans: [1, 2], align: ['center', 'left'], rows: checks.map((t, i) => ({ cells: [i + 1, t] as SheetValue[] })) });
  if (!blocks.length) blocks.push({ headers: ['Instruction'], spans: [3], rows: [{ cells: [w.title] as SheetValue[] }] });
  return {
    filename: safe(w.docNo),
    sheet: safe(w.docNo).slice(0, 31),
    form: FORM_FORMATS.workInstruction,
    title: 'Work Instruction',
    info: [
      [`Instruction No :- ${w.docNo}`, `Revision :- ${w.revNo}`, `Effective From :- ${d(w.effectiveDate)}`],
      [`Title :- ${w.title}`, `Process :- ${w.process}`, `Status :- ${w.status}`],
      ...(w.productName ? [[`Product :- ${w.productName}`]] : []),
    ],
    widths: [8, 44, 44],
    blocks,
    notes: [...(w.tools ? [`Tools / equipment : ${w.tools}`] : []), ...(w.safety ? [`Safety : ${w.safety}`] : []), ...(w.remarks ? [`Remarks : ${w.remarks}`] : [])],
    checkedBy: user,
  };
}
