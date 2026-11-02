// The 17 purchase reports as data: each is a source view, its columns, which filters make sense, and an optional row filter / aggregation.
// The hub page (PurchaseReportsPage) renders any of them; nothing here knows about the screen.
import type { FieldGroup } from '../../auth/access';

type Row = Record<string, unknown>;

export type ColKind = 'text' | 'num' | 'money' | 'date' | 'pct' | 'badge';

export interface ReportCol {
  key: string;
  label: string;
  kind?: ColKind;
  /** the column is dropped for people who may not see this kind of information */
  secret?: FieldGroup;
  /** the total row sums this column */
  total?: boolean;
}

export interface ReportDef {
  id: string;
  title: string;
  group: string;
  view: string;
  cols: ReportCol[];
  /** which row keys the shared filters apply to; a filter whose key is missing is not offered */
  dateKey?: string;
  supplierKey?: string;
  materialKey?: string;
  gradeKey?: string;
  statusKey?: string;
  urgencyKey?: string;
  /** keep only some rows of the view */
  where?: (r: Row) => boolean;
  /** reshape the rows (aggregation, derived columns) after loading */
  transform?: (rows: Row[]) => Row[];
  /** sort key, descending unless asc */
  sort?: { key: string; asc?: boolean };
  note?: string;
  /** the report is offered only to roles that may open this page (a page of its own in Access Control) */
  resource?: string;
}

const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const s = (v: unknown) => (v == null ? '' : String(v));

const OPEN_STATUSES = ['Released', 'Sent to Supplier', 'Partially Received'];

/** Whole days between an ISO date and today (positive = in the past). */
export const daysSince = (iso: unknown): number => {
  if (!iso) return 0;
  const d = new Date(s(iso).slice(0, 10) + 'T00:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - d.getTime()) / 86400000);
};

/** Groups the PO-line register by one key and adds up quantities and value. */
const groupLines =
  (keyOf: (r: Row) => string, labelKey: string) =>
  (rows: Row[]): Row[] => {
    const g = new Map<string, { label: string; pos: Set<unknown>; lines: number; ordered: number; received: number; pending: number; value: number }>();
    for (const r of rows) {
      if (['Draft', 'Cancelled', 'Approval Pending', 'Approved'].includes(s(r.status))) continue; // only orders that were actually released
      const k = keyOf(r) || '—';
      const x = g.get(k) ?? { label: k, pos: new Set(), lines: 0, ordered: 0, received: 0, pending: 0, value: 0 };
      x.pos.add(r.po_id);
      x.lines += 1;
      x.ordered += n(r.qty);
      x.received += n(r.received_qty);
      x.pending += n(r.pending_qty);
      x.value += n(r.amount);
      g.set(k, x);
    }
    return [...g.values()]
      .map((x) => ({ [labelKey]: x.label, po_count: x.pos.size, lines: x.lines, ordered_qty: x.ordered, received_qty: x.received, pending_qty: x.pending, value: x.value, avg_rate: x.ordered ? x.value / x.ordered : 0 }))
      .sort((a, b) => n(b.value) - n(a.value));
  };

const groupCols = (label: string, key: string): ReportCol[] => [
  { key, label },
  { key: 'po_count', label: 'POs', kind: 'num', total: true },
  { key: 'lines', label: 'Lines', kind: 'num', total: true },
  { key: 'ordered_qty', label: 'Ordered Qty', kind: 'num', total: true },
  { key: 'received_qty', label: 'Received Qty', kind: 'num', total: true },
  { key: 'pending_qty', label: 'Pending Qty', kind: 'num', total: true },
  { key: 'value', label: 'Purchase Value (₹)', kind: 'money', secret: 'purchase_rates', total: true },
  { key: 'avg_rate', label: 'Avg Rate (₹)', kind: 'money', secret: 'purchase_rates' },
];

const poCols: ReportCol[] = [
  { key: 'po_no', label: 'PO No.' },
  { key: 'po_date', label: 'PO Date', kind: 'date' },
  { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
  { key: 'urgency', label: 'Urgency' },
  { key: 'delivery_date', label: 'Delivery Date', kind: 'date' },
  { key: 'ordered_qty', label: 'Ordered Qty', kind: 'num', total: true },
  { key: 'received_qty', label: 'Received Qty', kind: 'num', total: true },
  { key: 'pending_qty', label: 'Pending Qty', kind: 'num', total: true },
  { key: 'total_amount', label: 'Total (₹)', kind: 'money', secret: 'purchase_rates', total: true },
  { key: 'status', label: 'Status', kind: 'badge' },
];

const poFilters = { dateKey: 'po_date', supplierKey: 'supplier_name', statusKey: 'status', urgencyKey: 'urgency' } as const;

export const REPORTS: ReportDef[] = [
  // ---- upstream
  {
    id: 'pr',
    title: 'Purchase Requisition Report',
    group: 'Requisitions & Quotations',
    view: 'v_pr_status',
    cols: [
      { key: 'pr_no', label: 'PR No.' },
      { key: 'pr_date', label: 'PR Date', kind: 'date' },
      { key: 'department', label: 'Department' },
      { key: 'requested_by', label: 'Requested By' },
      { key: 'urgency', label: 'Urgency' },
      { key: 'item', label: 'Item' },
      { key: 'grade', label: 'Grade' },
      { key: 'size', label: 'Size' },
      { key: 'uom', label: 'UOM' },
      { key: 'qty', label: 'Required', kind: 'num', total: true },
      { key: 'ordered_qty', label: 'Ordered', kind: 'num', total: true },
      { key: 'remaining_qty', label: 'Remaining', kind: 'num', total: true },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
    dateKey: 'pr_date',
    gradeKey: 'grade',
    statusKey: 'status',
    urgencyKey: 'urgency',
    sort: { key: 'pr_date' },
    note: 'Totals add up different units; read them per unit of measure.',
  },
  {
    id: 'rfq',
    title: 'Procurement Report',
    group: 'Requisitions & Quotations',
    view: 'v_rfq_status',
    cols: [
      { key: 'rfq_no', label: 'Procurement No.' },
      { key: 'rfq_date', label: 'Procurement Date', kind: 'date' },
      { key: 'pr_no', label: 'PR No.' },
      { key: 'due_date', label: 'Reply Due', kind: 'date' },
      { key: 'suppliers_invited', label: 'Invited', kind: 'num', total: true },
      { key: 'sent_count', label: 'Sent', kind: 'num', total: true },
      { key: 'responded_count', label: 'Responded', kind: 'num', total: true },
      { key: 'quotation_count', label: 'Quotations', kind: 'num', total: true },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
    dateKey: 'rfq_date',
    statusKey: 'status',
    sort: { key: 'rfq_date' },
  },
  {
    id: 'sq',
    title: 'Supplier Quotation Report',
    group: 'Requisitions & Quotations',
    view: 'v_sq_register',
    cols: [
      { key: 'sq_no', label: 'Quotation No.' },
      { key: 'sq_date', label: 'Date', kind: 'date' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'rfq_no', label: 'Procurement No.' },
      { key: 'pr_no', label: 'PR No.' },
      { key: 'valid_till', label: 'Valid Till', kind: 'date' },
      { key: 'lead_days', label: 'Lead (days)', kind: 'num' },
      { key: 'payment_terms', label: 'Payment Terms' },
      { key: 'item_count', label: 'Items', kind: 'num' },
      { key: 'total_amount', label: 'Total (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'status', label: 'Status', kind: 'badge' },
    ],
    dateKey: 'sq_date',
    supplierKey: 'supplier_name',
    statusKey: 'status',
    sort: { key: 'sq_date' },
  },
  {
    id: 'comparison',
    title: 'Supplier Comparison Report',
    group: 'Requisitions & Quotations',
    view: 'v_comparison_report',
    cols: [
      { key: 'pr_no', label: 'PR No.' },
      { key: 'item', label: 'Item' },
      { key: 'grade', label: 'Grade' },
      { key: 'size', label: 'Size' },
      { key: 'required_qty', label: 'Required Qty', kind: 'num' },
      { key: 'supplier', label: 'Supplier', secret: 'party_names' },
      { key: 'sq_no', label: 'Quotation' },
      { key: 'rate', label: 'Rate (₹)', kind: 'money', secret: 'purchase_rates' },
      { key: 'rate_rank', label: 'Rank (1 = lowest)', kind: 'num' },
      { key: 'lead_days', label: 'Lead (days)', kind: 'num' },
      { key: 'payment_terms', label: 'Payment Terms' },
    ],
    supplierKey: 'supplier',
    gradeKey: 'grade',
    sort: { key: 'pr_no' },
  },
  // ---- orders
  { id: 'po-register', title: 'PO Register', group: 'Purchase Orders', view: 'v_po_register', cols: poCols, ...poFilters, sort: { key: 'po_date' } },
  {
    id: 'open-po',
    title: 'Open PO Report',
    group: 'Purchase Orders',
    view: 'v_po_register',
    cols: poCols,
    ...poFilters,
    where: (r) => OPEN_STATUSES.includes(s(r.status)),
    sort: { key: 'delivery_date', asc: true },
    note: 'Released orders that still have material to receive.',
  },
  {
    id: 'pending-po',
    title: 'Pending PO Report',
    group: 'Purchase Orders',
    view: 'v_po_register',
    cols: poCols.filter((c) => !['received_qty', 'pending_qty'].includes(c.key)),
    ...poFilters,
    where: (r) => ['Approval Pending', 'Approved'].includes(s(r.status)),
    sort: { key: 'po_date' },
    note: 'Orders waiting for approval or for release to the supplier.',
  },
  {
    id: 'urgent-po',
    title: 'Urgent PO Report',
    group: 'Purchase Orders',
    view: 'v_po_urgent',
    cols: poCols,
    ...poFilters,
    sort: { key: 'delivery_date', asc: true },
  },
  {
    id: 'overdue-po',
    title: 'Overdue PO Report',
    group: 'Purchase Orders',
    view: 'v_po_register',
    cols: [...poCols.slice(0, 5), { key: 'days_overdue', label: 'Days Overdue', kind: 'num' }, ...poCols.slice(5)],
    ...poFilters,
    where: (r) => r.is_overdue === true,
    transform: (rows) => rows.map((r) => ({ ...r, days_overdue: daysSince(r.delivery_date) })),
    sort: { key: 'days_overdue' },
  },
  {
    id: 'delivery-schedule',
    title: 'PO Delivery Schedule',
    group: 'Purchase Orders',
    view: 'v_po_delivery_schedule',
    cols: [
      { key: 'po_no', label: 'PO No.' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'item', label: 'Item' },
      { key: 'grade', label: 'Grade' },
      { key: 'size', label: 'Size' },
      { key: 'delivery_date', label: 'Delivery Date', kind: 'date' },
      { key: 'qty', label: 'Ordered', kind: 'num', total: true },
      { key: 'received_qty', label: 'Received', kind: 'num', total: true },
      { key: 'pending_qty', label: 'Pending', kind: 'num', total: true },
      { key: 'last_receipt_date', label: 'Last Receipt', kind: 'date' },
      { key: 'days_overdue', label: 'Days Late', kind: 'num' },
      { key: 'schedule_status', label: 'Schedule', kind: 'badge' },
    ],
    dateKey: 'delivery_date',
    supplierKey: 'supplier_name',
    gradeKey: 'grade',
    statusKey: 'schedule_status',
    urgencyKey: 'urgency',
    sort: { key: 'delivery_date', asc: true },
  },
  // ---- suppliers & materials
  {
    id: 'supplier-wise',
    title: 'Supplier-wise Purchase Report',
    group: 'Suppliers & Materials',
    view: 'v_po_item_register',
    cols: groupCols('Supplier', 'supplier_name').map((c) => (c.key === 'supplier_name' ? { ...c, secret: 'party_names' as const } : c)),
    dateKey: 'po_date',
    supplierKey: 'supplier_name',
    materialKey: 'material',
    gradeKey: 'grade',
    transform: groupLines((r) => s(r.supplier_name), 'supplier_name'),
    note: 'Released orders only. Filters apply to the order lines before they are added up.',
  },
  {
    id: 'material-wise',
    title: 'Material-wise Purchase Report',
    group: 'Suppliers & Materials',
    view: 'v_po_item_register',
    cols: groupCols('Material', 'material'),
    dateKey: 'po_date',
    supplierKey: 'supplier_name',
    materialKey: 'material',
    gradeKey: 'grade',
    transform: groupLines((r) => s(r.material) || s(r.item), 'material'),
    note: 'Released orders only. Lines with no material set are grouped by item name.',
  },
  {
    id: 'grade-wise',
    title: 'Grade-wise Purchase Report',
    group: 'Suppliers & Materials',
    view: 'v_po_item_register',
    cols: groupCols('Grade', 'grade'),
    dateKey: 'po_date',
    supplierKey: 'supplier_name',
    materialKey: 'material',
    gradeKey: 'grade',
    transform: groupLines((r) => s(r.grade), 'grade'),
    note: 'Released orders only.',
  },
  {
    id: 'rate-history',
    title: 'Purchase Rate History',
    group: 'Suppliers & Materials',
    view: 'v_purchase_rate_history',
    cols: [
      { key: 'po_date', label: 'PO Date', kind: 'date' },
      { key: 'po_no', label: 'PO No.' },
      { key: 'item', label: 'Item' },
      { key: 'material', label: 'Material' },
      { key: 'grade', label: 'Grade' },
      { key: 'size', label: 'Size' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'uom', label: 'UOM' },
      { key: 'qty', label: 'Qty', kind: 'num' },
      { key: 'rate', label: 'Rate (₹)', kind: 'money', secret: 'purchase_rates' },
    ],
    dateKey: 'po_date',
    supplierKey: 'supplier_name',
    materialKey: 'material',
    gradeKey: 'grade',
    sort: { key: 'po_date' },
  },
  {
    id: 'supplier-performance',
    title: 'Supplier Performance Report',
    group: 'Suppliers & Materials',
    resource: 'supplier_performance',
    view: 'v_supplier_performance',
    cols: [
      { key: 'name', label: 'Supplier', secret: 'party_names' },
      { key: 'po_count', label: 'POs', kind: 'num', total: true },
      { key: 'total_purchase_value', label: 'Purchase Value (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'on_time_delivery_pct', label: 'On-time %', kind: 'pct' },
      { key: 'quality_acceptance_pct', label: 'Accepted %', kind: 'pct' },
      { key: 'rejection_pct', label: 'Rejected %', kind: 'pct' },
      { key: 'price_index', label: 'Price Index', kind: 'num' },
      { key: 'quantity_shortage', label: 'Shortage (KG)', kind: 'num', total: true },
      { key: 'avg_response_hrs', label: 'Response (hrs)', kind: 'num' },
      { key: 'payment_terms', label: 'Payment Terms' },
    ],
    supplierKey: 'name',
    sort: { key: 'total_purchase_value' },
  },
  // ---- money and changes
  {
    id: 'outstanding',
    title: 'Purchase Outstanding Report',
    group: 'Money & Changes',
    view: 'v_po_pending_balance',
    cols: [
      { key: 'po_no', label: 'PO No.' },
      { key: 'supplier', label: 'Supplier', secret: 'party_names' },
      { key: 'total_amount', label: 'PO Value (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'invoiced', label: 'Invoiced (₹)', kind: 'money', secret: 'invoices', total: true },
      { key: 'paid', label: 'Paid (₹)', kind: 'money', secret: 'invoices', total: true },
      { key: 'balance_to_invoice', label: 'Not Yet Invoiced (₹)', kind: 'money', secret: 'invoices', total: true },
      { key: 'payable', label: 'Outstanding (₹)', kind: 'money', secret: 'invoices', total: true },
    ],
    supplierKey: 'supplier',
    sort: { key: 'payable' },
    note: 'Invoiced and Paid come from posted purchase invoices and their payments. Outstanding = invoiced − paid.',
  },
  {
    id: 'invoice-register',
    title: 'Purchase Invoice Register',
    group: 'Money & Changes',
    resource: 'purchase_invoices',
    view: 'v_purchase_invoice_register',
    cols: [
      { key: 'pinv_no', label: 'Invoice' },
      { key: 'supplier_inv_no', label: "Supplier's Inv. No.", secret: 'invoices' },
      { key: 'inv_date', label: 'Date', kind: 'date' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'po_no', label: 'PO No.' },
      { key: 'due_date', label: 'Due', kind: 'date' },
      { key: 'total_amount', label: 'Total (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'paid_amount', label: 'Paid (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'balance', label: 'Balance (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'days_overdue', label: 'Days Overdue', kind: 'num' },
      { key: 'status', label: 'Status', kind: 'badge' },
      { key: 'pay_status', label: 'Payment', kind: 'badge' },
    ],
    dateKey: 'inv_date',
    supplierKey: 'supplier_name',
    statusKey: 'status',
    sort: { key: 'inv_date' },
  },
  {
    id: 'payment-register',
    title: 'Purchase Payment Register',
    group: 'Money & Changes',
    resource: 'purchase_payments',
    view: 'v_purchase_payment_register',
    cols: [
      { key: 'pay_no', label: 'Payment' },
      { key: 'pay_date', label: 'Date', kind: 'date' },
      { key: 'pinv_no', label: 'Invoice' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'po_no', label: 'PO No.' },
      { key: 'mode', label: 'Mode' },
      { key: 'reference', label: 'Reference' },
      { key: 'amount', label: 'Amount (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'created_by', label: 'Recorded By' },
    ],
    dateKey: 'pay_date',
    supplierKey: 'supplier_name',
    sort: { key: 'pay_date' },
  },
  {
    id: 'payables-ageing',
    title: 'Supplier Payables Ageing',
    group: 'Money & Changes',
    resource: 'supplier_payables',
    view: 'v_supplier_payables',
    cols: [
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'open_invoices', label: 'Open Invoices', kind: 'num', total: true },
      { key: 'outstanding', label: 'Outstanding (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'overdue_amount', label: 'Overdue (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'bucket_0_30', label: '0–30 days (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'bucket_31_60', label: '31–60 days (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'bucket_61_90', label: '61–90 days (₹)', kind: 'money', secret: 'purchase_rates', total: true },
      { key: 'bucket_90_plus', label: '90+ days (₹)', kind: 'money', secret: 'purchase_rates', total: true },
    ],
    supplierKey: 'supplier_name',
    sort: { key: 'outstanding' },
    note: 'Aged by invoice date. Overdue = past the due date.',
  },
  {
    id: 'amendments',
    title: 'PO Amendment Report',
    group: 'Money & Changes',
    view: 'v_po_amendments',
    cols: [
      { key: 'po_no', label: 'PO No.' },
      { key: 'supplier_name', label: 'Supplier', secret: 'party_names' },
      { key: 'replaced_rev', label: 'Replaced Rev.', kind: 'num' },
      { key: 'new_rev', label: 'New Rev.', kind: 'num' },
      { key: 'reason', label: 'Reason' },
      { key: 'amended_by', label: 'Amended By' },
      { key: 'amended_at', label: 'Amended On', kind: 'date' },
      { key: 'old_total', label: 'Old Total (₹)', kind: 'money', secret: 'purchase_rates' },
      { key: 'new_total', label: 'New Total (₹)', kind: 'money', secret: 'purchase_rates' },
    ],
    dateKey: 'amended_at',
    supplierKey: 'supplier_name',
    sort: { key: 'amended_at' },
  },
];

export const REPORT_BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r])) as Record<string, ReportDef>;
export const REPORT_GROUPS = [...new Set(REPORTS.map((r) => r.group))];
