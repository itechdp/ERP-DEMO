export const LOST_REASONS = ['Price High', 'Delivery Time High', 'Customer Cancelled', 'Competitor Price Lower', 'Quality Issue', 'Customer Requirement Changed', 'Other'] as const;
export const UOMS = ['PCS', 'KG', 'SET', 'NOS', 'MTR', 'TON'];
export const ORDER_NEXT: Record<string, string | undefined> = { Draft: 'Confirmed', Confirmed: 'In Production', 'In Production': 'Delivered' };

export interface QuotationRow {
  id: number;
  docNo: string;
  qtNo: string | null;
  draftNo: string;
  qtDate: string;
  status: string;
  displayStatus: string;
  isExpired: boolean;
  validUntil: string | null;
  enquiryNo: string;
  salesperson: string;
  paymentTerms: string;
  deliveryTerms: string;
  remarks: string;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  sentAt: string | null;
  responseDate: string | null;
  lostReason: string | null;
  responseNote: string | null;
  legacy: boolean;
  lineCount: number;
  products: string;
  totalQty: number;
  customer: string;
  contact: string;
  phone: string;
  email: string;
  amount: number | null;
  discountValue: number | null;
  costTotal: number | null;
  profit: number | null;
  marginPct: number | null;
  belowMin: boolean | null;
  minMargin: number;
  daysPending: number | null;
  lastFollowup: string | null;
  nextFollowup: string | null;
  followupCount: number;
  orderId: number | null;
  orderNo: string | null;
  submittedAt: string | null;
}

/** One row of a line's cost sheet (the "detailed" quotation). Rows are numbered by their position, so they can be added, deleted and moved freely. */
export interface CostRow { label: string; basis: string; amount: number | null; bold?: boolean }

export interface QuotationLine {
  id?: number;
  product: string;
  grade: string;
  size: string;
  uom: string;
  qty: number | null;
  rate: number | null;
  discountPct: number | null;
  materialCost: number | null;
  processingCost: number | null;
  otherCost: number | null;
  costing?: CostRow[] | null;
  // computed by the database (view) — only for reading
  netRate?: number | null;
  amount?: number | null;
  unitCost?: number | null;
  marginPct?: number | null;
}

export interface QuotationAction { id: number; action: string; actor: string; note: string; marginPct: number | null; actedAt: string }
export interface QuotationFollowup { id: number; date: string; note: string; nextDate: string | null; by: string }

export interface QuotationHeader {
  customer: string; contact: string; phone: string; email: string; enquiryNo: string;
  paymentTerms: string; deliveryTerms: string; validUntil: string; remarks: string; qtDate: string;
}

export interface OrderRow {
  id: number; soNo: string; soDate: string; quotationId: number | null; quotationNo: string | null; extRef: string; deliveryDate: string | null;
  paymentTerms: string; deliveryTerms: string; remarks: string; status: string; cancelReason: string | null; legacy: boolean;
  customer: string; contact: string; phone: string; email: string; lineCount: number; products: string; totalQty: number; amount: number | null;
}
export interface OrderLine { product: string; grade: string; size: string; uom: string; qty: number | null; rate: number | null }

export interface PriceHistoryRow { quotationId: number; docNo: string; qtDate: string; customer: string; product: string; grade: string; size: string; uom: string; rate: number | null; previousRate: number | null }
export interface ItemRow { quotationId: number; docNo: string; status: string; qtDate: string; customer: string; salesperson: string; product: string; grade: string; size: string; qty: number; netRate: number | null; amount: number | null; unitCost: number | null; marginPct: number | null }

export interface QuotationEmail { id: number; sentTo: string; cc: string; note: string; sentBy: string; status: string; error: string; sentAt: string }
