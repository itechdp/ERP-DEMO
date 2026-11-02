import { dbMessage, supabase } from '../db/client';
import { functionError } from '../purchase/services/poService';
import { openUrl } from '../native/native';
import type { CostRow, ItemRow, OrderLine, OrderRow, PriceHistoryRow, QuotationAction, QuotationFollowup, QuotationHeader, QuotationLine, QuotationRow } from './types';

type R = Record<string, any>;
const s = (v: unknown) => (v == null ? '' : String(v));
const nn = (v: unknown) => (v == null || v === '' ? null : Number(v));
const num = (v: unknown) => Number(v ?? 0);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(dbMessage(e as never));
};

const mapQ = (r: R): QuotationRow => ({
  id: num(r.id), docNo: s(r.doc_no), qtNo: r.qt_no ?? null, draftNo: s(r.draft_no), qtDate: s(r.qt_date), status: s(r.status), displayStatus: s(r.display_status),
  isExpired: !!r.is_expired, validUntil: r.valid_until ?? null, enquiryNo: s(r.enquiry_no), salesperson: s(r.salesperson), paymentTerms: s(r.payment_terms),
  deliveryTerms: s(r.delivery_terms), remarks: s(r.remarks), approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null, decisionNote: r.decision_note ?? null,
  sentAt: r.sent_at ?? null, responseDate: r.response_date ?? null, lostReason: r.lost_reason ?? null, responseNote: r.response_note ?? null, legacy: !!r.legacy,
  lineCount: num(r.line_count), products: s(r.products), totalQty: num(r.total_qty), customer: s(r.customer), contact: s(r.contact), phone: s(r.phone), email: s(r.email),
  amount: nn(r.amount), discountValue: nn(r.discount_value), costTotal: nn(r.cost_total), profit: nn(r.profit), marginPct: nn(r.margin_pct),
  belowMin: r.below_min_margin ?? null, minMargin: num(r.min_margin_pct), daysPending: nn(r.days_pending), lastFollowup: r.last_followup_date ?? null,
  nextFollowup: r.next_followup_date ?? null, followupCount: num(r.followup_count), orderId: nn(r.order_id), orderNo: r.order_no ?? null, submittedAt: r.submitted_at ?? null,
});

const mapLine = (r: R): QuotationLine => ({
  id: num(r.id), product: s(r.product), grade: s(r.grade), size: s(r.size), uom: s(r.uom) || 'PCS', qty: nn(r.qty), rate: nn(r.rate), discountPct: nn(r.discount_pct) ?? 0,
  materialCost: nn(r.material_cost), processingCost: nn(r.processing_cost), otherCost: nn(r.other_cost),
  netRate: nn(r.net_rate), amount: nn(r.amount), unitCost: nn(r.unit_cost), marginPct: nn(r.margin_pct),
  costing: Array.isArray(r.costing) ? (r.costing as R[]).map((c): CostRow => ({ label: s(c.label), basis: s(c.basis), amount: nn(c.amount), bold: !!c.bold })) : null,
});

export async function fetchQuotations(): Promise<QuotationRow[]> {
  const { data, error } = await supabase.from('v_sales_quotations').select('*').order('created_at', { ascending: false });
  fail(error);
  return ((data ?? []) as R[]).map(mapQ);
}

export async function fetchQuotation(id: number) {
  const [h, i, a, f] = await Promise.all([
    supabase.from('v_sales_quotations').select('*').eq('id', id).single(),
    supabase.from('v_sales_quotation_items').select('*').eq('quotation_id', id).order('line_no', { ascending: true }),
    supabase.from('v_sales_quotation_actions').select('*').eq('quotation_id', id).order('acted_at', { ascending: true }),
    supabase.from('v_sales_quotation_followups').select('*').eq('quotation_id', id).order('followup_date', { ascending: true }),
  ]);
  fail(h.error);
  fail(i.error);
  fail(a.error);
  fail(f.error);
  return {
    q: mapQ(h.data as R),
    lines: ((i.data ?? []) as R[]).map(mapLine),
    actions: ((a.data ?? []) as R[]).map((r): QuotationAction => ({ id: num(r.id), action: s(r.action), actor: s(r.actor), note: s(r.note), marginPct: nn(r.margin_pct), actedAt: s(r.acted_at) })),
    followups: ((f.data ?? []) as R[]).map((r): QuotationFollowup => ({ id: num(r.id), date: s(r.followup_date), note: s(r.note), nextDate: r.next_date ?? null, by: s(r.by_name) })),
  };
}

export async function fetchItems(): Promise<ItemRow[]> {
  const { data, error } = await supabase.from('v_sales_quotation_items').select('*');
  fail(error);
  return ((data ?? []) as R[]).map((r) => ({
    quotationId: num(r.quotation_id), docNo: s(r.doc_no), status: s(r.status), qtDate: s(r.qt_date), customer: s(r.customer), salesperson: s(r.salesperson),
    product: s(r.product), grade: s(r.grade), size: s(r.size), qty: num(r.qty), netRate: nn(r.net_rate), amount: nn(r.amount), unitCost: nn(r.unit_cost), marginPct: nn(r.margin_pct),
  }));
}

export async function fetchPriceHistory(): Promise<PriceHistoryRow[]> {
  const { data, error } = await supabase.from('v_customer_price_history').select('*').order('qt_date', { ascending: false });
  fail(error);
  return ((data ?? []) as R[]).map((r) => ({
    quotationId: num(r.quotation_id), docNo: s(r.doc_no), qtDate: s(r.qt_date), customer: s(r.customer), product: s(r.product), grade: s(r.grade), size: s(r.size),
    uom: s(r.uom), rate: nn(r.rate), previousRate: nn(r.previous_rate),
  }));
}

const headerJson = (h: QuotationHeader) => ({
  customer: h.customer, contact: h.contact, phone: h.phone, email: h.email, enquiry_no: h.enquiryNo, payment_terms: h.paymentTerms,
  delivery_terms: h.deliveryTerms, valid_until: h.validUntil || null, remarks: h.remarks, qt_date: h.qtDate || null,
});
const lineJson = (l: QuotationLine) => ({
  product: l.product, grade: l.grade, size: l.size, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discountPct ?? 0,
  material_cost: l.materialCost, processing_cost: l.processingCost, other_cost: l.otherCost,
  // sent only when there is a cost sheet, so saving keeps working before migration 38 is installed
  ...(l.costing?.length ? { costing: l.costing } : {}),
});

export async function saveQuotation(id: number | null, h: QuotationHeader, lines: QuotationLine[], user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_sales_quotation', { p_id: id, p_header: headerJson(h), p_items: lines.map(lineJson), p_user: user });
  fail(error);
  return Number(data);
}
const rpc = async (fn: string, args: R) => fail((await supabase.rpc(fn, args)).error);
export const submitQuotation = (id: number, user: string) => rpc('submit_sales_quotation', { p_id: id, p_user: user });
export const decideQuotation = (id: number, decision: 'approve' | 'reject' | 'revise', note: string, user: string) => rpc('decide_sales_quotation', { p_id: id, p_decision: decision, p_note: note, p_user: user });
export const sendQuotation = (id: number, user: string, nextDate = '') => rpc('send_sales_quotation', { p_id: id, p_user: user, p_next_date: nextDate || null });
export const respondQuotation = (id: number, response: 'Won' | 'Lost', reason: string, note: string, date: string, user: string) =>
  rpc('respond_sales_quotation', { p_id: id, p_response: response, p_reason: reason || null, p_note: note, p_date: date || null, p_user: user });
export const addFollowup = (id: number, date: string, note: string, next: string, user: string) =>
  rpc('add_quotation_followup', { p_id: id, p_date: date || null, p_note: note, p_next_date: next || null, p_user: user });
export const setMinMargin = (pct: number) => rpc('set_min_margin', { p_pct: pct });

export async function fetchMinMargin(): Promise<number> {
  const { data, error } = await supabase.from('v_sales_settings').select('min_margin_pct').maybeSingle();
  fail(error);
  return num((data as R | null)?.min_margin_pct ?? 15);
}

// ------------------------------------------------------------------ orders
const mapO = (r: R): OrderRow => ({
  id: num(r.id), soNo: s(r.so_no), soDate: s(r.so_date), quotationId: nn(r.quotation_id), quotationNo: r.quotation_no ?? null, extRef: s(r.ext_ref), deliveryDate: r.delivery_date ?? null,
  paymentTerms: s(r.payment_terms), deliveryTerms: s(r.delivery_terms), remarks: s(r.remarks), status: s(r.status), cancelReason: r.cancel_reason ?? null, legacy: !!r.legacy,
  customer: s(r.customer), contact: s(r.contact), phone: s(r.phone), email: s(r.email), lineCount: num(r.line_count), products: s(r.products), totalQty: num(r.total_qty), amount: nn(r.amount),
});
export async function fetchOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabase.from('v_sales_orders').select('*').order('created_at', { ascending: false });
  fail(error);
  return ((data ?? []) as R[]).map(mapO);
}
export async function fetchOrder(id: number) {
  const [h, i] = await Promise.all([
    supabase.from('v_sales_orders').select('*').eq('id', id).single(),
    supabase.from('v_sales_order_items').select('*').eq('order_id', id).order('line_no', { ascending: true }),
  ]);
  fail(h.error);
  fail(i.error);
  return { o: mapO(h.data as R), lines: ((i.data ?? []) as R[]).map((r): OrderLine => ({ product: s(r.product), grade: s(r.grade), size: s(r.size), uom: s(r.uom) || 'PCS', qty: nn(r.qty), rate: nn(r.rate) })) };
}
export interface OrderHeaderInput { customer: string; contact: string; phone: string; email: string; extRef: string; deliveryDate: string; paymentTerms: string; deliveryTerms: string; remarks: string; soDate: string }
export async function saveOrder(id: number | null, h: OrderHeaderInput, lines: OrderLine[], user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_sales_order', {
    p_id: id,
    p_header: { customer: h.customer, contact: h.contact, phone: h.phone, email: h.email, ext_ref: h.extRef, delivery_date: h.deliveryDate || null, payment_terms: h.paymentTerms, delivery_terms: h.deliveryTerms, remarks: h.remarks, so_date: h.soDate || null },
    p_items: lines.map((l) => ({ product: l.product, grade: l.grade, size: l.size, uom: l.uom, qty: l.qty, rate: l.rate })),
    p_user: user,
  });
  fail(error);
  return Number(data);
}
export async function createOrderFromQuotation(qid: number, extRef: string, deliveryDate: string, remarks: string, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('create_sales_order_from_quotation', { p_quotation_id: qid, p_header: { ext_ref: extRef, delivery_date: deliveryDate || null, remarks }, p_user: user });
  fail(error);
  return Number(data);
}
export const setOrderStatus = (id: number, status: string, note: string, user: string) => rpc('set_sales_order_status', { p_id: id, p_status: status, p_note: note, p_user: user });

// ---------------------------------------------------------------- the customer's PDF (Edge Function quotation-pdf)
/** the customer's PDF of an approved quotation: opens in a new tab (Edge Function quotation-pdf) */
export async function openQuotationPdf(id: number): Promise<void> {
  const { data, error } = await supabase.functions.invoke('quotation-pdf', { body: { quotationId: id } });
  if (error) throw new Error(await functionError(error, 'The PDF could not be created. Please try again.', 'quotation-pdf'));
  if (!data?.ok || !data?.url) throw new Error(String(data?.error ?? 'The PDF could not be created.'));
  await openUrl(String(data.url));
}
