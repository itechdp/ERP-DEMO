// ---------------------------------------------------------------------------
// Accounting data: reads the acc_ tables (migration 79) and writes ONLY through its database functions (each one checks Write access and
// saves in one transaction). The Books are read once and shared by every accounting page; any change reloads them.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { dbMessage, supabase } from '../db/client';
import type { Account, AccountMap, Bill, BillItem, BillKind, Books, CashExchange, Denomination, Draft, DraftItem, Item, Journal, MapKind, Voucher, VoucherKind } from './types';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const nOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
const denom = (v: unknown): Denomination | null => (v && typeof v === 'object' ? (v as Denomination) : null);

const notSetUp = (m: string) => /acc_[a-z_]+|schema cache|does not exist|Could not find the function/i.test(m);
/** turns a database error into the message to show (a missing migration gets a plain hint) */
function fail(e: { message: string } | null) {
  if (e) throw new Error(notSetUp(e.message) ? 'The Accounting module is not set up in the database yet. Run migration 79 (supabase/migrations/79_accounting_module.sql) in the Supabase SQL editor.' : dbMessage(e));
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  fail(error);
  return data as T;
}

// ------------------------------------------------------------- mapping ---
export const toAccount = (r: Row): Account => ({
  id: n(r.id), name: s(r.name), group: s(r.group_name), customerId: nOrNull(r.customer_id), supplierId: nOrNull(r.supplier_id), opening: n(r.opening_balance),
  city: s(r.city), pincode: s(r.pincode), area: s(r.area), mobileNo: s(r.mobile_no), state: s(r.state), panNo: s(r.pan_no), aadharNo: s(r.aadhar_no),
  gstinNo: s(r.gstin_no), creditDays: nOrNull(r.credit_days), bankName: s(r.bank_name), bankBranch: s(r.bank_branch), ifscCode: s(r.ifsc_code),
  bankAccountNo: s(r.bank_account_no), otherDetails: s(r.other_details),
});
const toVoucher = (r: Row): Voucher => ({
  id: n(r.id), kind: s(r.kind) as VoucherKind, no: s(r.voucher_no), date: s(r.voucher_date), from: n(r.from_account_id), to: n(r.to_account_id), amount: n(r.amount),
  narration: s(r.narration), refNo: s(r.ref_no), billNo: s(r.bill_no), chequeNo: s(r.cheque_no), chequeDate: s(r.cheque_date), drawnOn: s(r.drawn_on),
  denomination: denom(r.denomination), returnDenomination: denom(r.return_denomination), changeAmount: nOrNull(r.change_amount), createdBy: s(r.created_by), createdAt: s(r.created_at),
});
const toBill = (r: Row): Bill => ({
  id: n(r.id), kind: s(r.kind) as BillKind, no: s(r.bill_no), date: s(r.bill_date), mode: s(r.payment_mode) as Bill['mode'], account: nOrNull(r.account_id), partyName: s(r.party_name),
  refNo: s(r.ref_no), taxable: n(r.taxable_amount), tax: n(r.tax_amount), discount: n(r.discount_amount), total: n(r.total_amount), creditDays: nOrNull(r.credit_days),
  dueDate: s(r.due_date), createdBy: s(r.created_by), createdAt: s(r.created_at),
});
const toExchange = (r: Row): CashExchange => ({
  id: n(r.id), no: s(r.voucher_no), date: s(r.exchange_date), cashAccount: n(r.cash_account_id), amount: n(r.amount), given: denom(r.given_denomination),
  received: denom(r.received_denomination), narration: s(r.narration), createdBy: s(r.created_by), createdAt: s(r.created_at),
});
const toItem = (r: Row): Item => ({
  id: n(r.id), name: s(r.name), hsnCode: s(r.hsn_code), unit: s(r.unit), sellRate: n(r.sell_rate), purchaseRate: n(r.purchase_rate), taxRate: n(r.tax_rate), active: r.active !== false,
});
const toDraft = (r: Row): Draft => ({
  id: n(r.id), sourceType: s(r.source_type) as Draft['sourceType'], sourceId: s(r.source_id), sourceRef: s(r.source_ref), role: s(r.role) as Draft['role'],
  voucherType: s(r.voucher_type) as Draft['voucherType'], date: s(r.voucher_date), from: nOrNull(r.from_account_id), to: nOrNull(r.to_account_id), account: nOrNull(r.account_id),
  paymentMode: (s(r.payment_mode) || 'Debit') as Draft['paymentMode'], amount: n(r.amount), discount: n(r.discount), items: Array.isArray(r.items) ? (r.items as DraftItem[]) : [],
  narration: s(r.narration), refNo: s(r.ref_no), chequeNo: s(r.cheque_no), status: s(r.status) as Draft['status'], issue: s(r.issue), rejectReason: s(r.reject_reason),
  postedId: nOrNull(r.posted_id), postedNo: s(r.posted_no), createdBy: s(r.created_by), decidedBy: s(r.decided_by), decidedAt: s(r.decided_at), createdAt: s(r.created_at),
});

// --------------------------------------------------------------- books ---
export async function fetchBooks(): Promise<Books> {
  const [acc, vou, jv, jl, bills, ex] = await Promise.all([
    supabase.from('acc_accounts').select('*').order('name'),
    supabase.from('acc_vouchers').select('*').order('voucher_date').order('id'),
    supabase.from('acc_journals').select('*').order('voucher_date').order('id'),
    supabase.from('acc_journal_lines').select('journal_id, account_id, amount, line_order').order('journal_id').order('line_order'),
    supabase.from('acc_bills').select('*').order('bill_date').order('id'),
    supabase.from('acc_cash_exchanges').select('*').order('exchange_date').order('id'),
  ]);
  for (const r of [acc, vou, jv, jl, bills, ex]) fail(r.error);
  const lines = new Map<number, { account: number; amount: number }[]>();
  for (const l of (jl.data ?? []) as Row[]) {
    const id = n(l.journal_id);
    if (!lines.has(id)) lines.set(id, []);
    lines.get(id)!.push({ account: n(l.account_id), amount: n(l.amount) });
  }
  return {
    accounts: ((acc.data ?? []) as Row[]).map(toAccount),
    vouchers: ((vou.data ?? []) as Row[]).map(toVoucher),
    journals: ((jv.data ?? []) as Row[]).map(
      (r): Journal => ({
        id: n(r.id), no: s(r.voucher_no), date: s(r.voucher_date), side: s(r.primary_side) as Journal['side'], primary: n(r.primary_account_id), amount: n(r.primary_amount),
        narration: s(r.narration), refNo: s(r.ref_no), lines: lines.get(n(r.id)) ?? [], createdBy: s(r.created_by), createdAt: s(r.created_at),
      }),
    ),
    bills: ((bills.data ?? []) as Row[]).map(toBill),
    exchanges: ((ex.data ?? []) as Row[]).map(toExchange),
  };
}

// one shared copy of the books for every accounting page — kept per signed-in user, so a new sign-in never sees the previous user's copy
type BooksState = { books: Books | null; loading: boolean; error: string | null; owner: string };
let state: BooksState = { books: null, loading: false, error: null, owner: '' };
let inflight: Promise<void> | null = null;
let generation = 0;
const subs = new Set<() => void>();
const emit = (next: Partial<BooksState>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f());
};

export function reloadBooks(): Promise<void> {
  if (inflight) return inflight;
  const gen = generation;
  emit({ loading: true });
  inflight = fetchBooks()
    .then((books) => {
      if (gen === generation) emit({ books, loading: false, error: null });
    })
    .catch((e) => {
      if (gen === generation) emit({ loading: false, error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The books, read on first use and re-read after every change (and by Refresh). `owner` = the signed-in user's e-mail. */
export function useBooks(owner = '') {
  if (state.owner !== owner) {
    // another user signed in: drop the previous copy before anything renders it
    generation++;
    inflight = null;
    state = { books: null, loading: false, error: null, owner };
  }
  const snap = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.books && !inflight && !state.error) void reloadBooks();
  }, [owner]);
  return { ...snap, reload: reloadBooks };
}

/** runs a change, then re-reads the books */
async function changed<T>(p: Promise<T>): Promise<T> {
  const r = await p;
  void reloadBooks();
  return r;
}

// ------------------------------------------------------------ accounts ---
export interface AccountInput {
  accountType: 'customer' | 'supplier' | 'other';
  customerId?: number | null;
  supplierId?: number | null;
  name: string;
  group: string;
  opening: number;
  city: string;
  pincode: string;
  area: string;
  mobileNo: string;
  state: string;
  panNo: string;
  aadharNo: string;
  gstinNo: string;
  creditDays: string;
  bankName: string;
  bankBranch: string;
  ifscCode: string;
  bankAccountNo: string;
  otherDetails: string;
}
export const saveAccount = (id: number | null, a: AccountInput) =>
  changed(
    rpc<number>('acc_save_account', {
      p_id: id,
      p: {
        account_type: a.accountType, customer_id: a.customerId ?? null, supplier_id: a.supplierId ?? null, name: a.name, group_name: a.group, opening_balance: a.opening,
        city: a.city, pincode: a.pincode, area: a.area, mobile_no: a.mobileNo, state: a.state, pan_no: a.panNo, aadhar_no: a.aadharNo, gstin_no: a.gstinNo,
        credit_days: a.creditDays, bank_name: a.bankName, bank_branch: a.bankBranch, ifsc_code: a.ifscCode, bank_account_no: a.bankAccountNo, other_details: a.otherDetails,
      },
    }),
  );
export const deleteAccount = (id: number) => changed(rpc<void>('acc_delete_account', { p_id: id }));

// ------------------------------------------------------------ vouchers ---
export interface VoucherInput {
  from: number | null;
  to: number | null;
  amount: string;
  date: string;
  narration: string;
  refNo: string;
  billNo: string;
  chequeNo: string;
  chequeDate: string;
  drawnOn: string;
  denomination: Denomination | null;
  returnDenomination: Denomination | null;
}
export const saveVoucher = (kind: VoucherKind, id: number | null, v: VoucherInput, draftId?: number | null) =>
  changed(
    rpc<{ id: number; voucher_no: string }>('acc_save_voucher', {
      p_kind: kind,
      p_id: id,
      p: {
        from_account_id: v.from, to_account_id: v.to, amount: v.amount, voucher_date: v.date || null, narration: v.narration, ref_no: v.refNo, bill_no: v.billNo,
        cheque_no: v.chequeNo, cheque_date: v.chequeDate || null, drawn_on: v.drawnOn, denomination: v.denomination, return_denomination: v.returnDenomination,
      },
      p_draft_id: draftId ?? null,
    }),
  );

export interface JournalInput {
  side: 'credit' | 'debit';
  primary: number | null;
  amount: string;
  date: string;
  narration: string;
  refNo: string;
  lines: { account: number | null; amount: string }[];
}
export const saveJournal = (id: number | null, j: JournalInput) =>
  changed(
    rpc<{ id: number; voucher_no: string }>('acc_save_journal', {
      p_id: id,
      p: {
        primary_side: j.side, primary_account_id: j.primary, primary_amount: j.amount, voucher_date: j.date || null, narration: j.narration, ref_no: j.refNo,
        lines: j.lines.map((l) => ({ account_id: l.account, amount: l.amount })),
      },
    }),
  );

export interface BillInput {
  mode: 'Cash' | 'Debit';
  account: number | null;
  date: string;
  refNo: string;
  discount: string;
  creditDays: string;
  items: { itemId: number | null; itemName: string; hsnCode: string; qty: string; rate: string; gstType: 'CGST/SGST' | 'IGST'; taxRate: string }[];
}
export const saveBill = (kind: BillKind, id: number | null, b: BillInput, draftId?: number | null) =>
  changed(
    rpc<{ id: number; voucher_no: string; total: number }>('acc_save_bill', {
      p_kind: kind,
      p_id: id,
      p: {
        payment_mode: b.mode, account_id: b.account, bill_date: b.date || null, ref_no: b.refNo, discount: b.discount, credit_days: b.creditDays,
        items: b.items.map((i) => ({ item_id: i.itemId, item_name: i.itemName, hsn_code: i.hsnCode, qty: i.qty, rate: i.rate, gst_type: i.gstType, tax_rate: i.taxRate })),
      },
      p_draft_id: draftId ?? null,
    }),
  );

export async function fetchBillItems(billId: number): Promise<BillItem[]> {
  const { data, error } = await supabase.from('acc_bill_items').select('*').eq('bill_id', billId).order('line_order');
  fail(error);
  return ((data ?? []) as Row[]).map((r) => ({
    id: n(r.id), itemId: nOrNull(r.item_id), itemName: s(r.item_name), hsnCode: s(r.hsn_code), qty: n(r.qty), rate: n(r.rate), gstType: (s(r.gst_type) || 'CGST/SGST') as BillItem['gstType'],
    taxRate: n(r.tax_rate), taxable: n(r.taxable_amount), tax: n(r.tax_amount), total: n(r.total_amount),
  }));
}

export interface ExchangeInput {
  cashAccount: number | null;
  date: string;
  narration: string;
  given: Denomination | null;
  received: Denomination | null;
}
export const saveExchange = (id: number | null, e: ExchangeInput) =>
  changed(
    rpc<{ id: number; voucher_no: string }>('acc_save_exchange', {
      p_id: id,
      p: { cash_account_id: e.cashAccount, exchange_date: e.date || null, narration: e.narration, given_denomination: e.given, received_denomination: e.received },
    }),
  );

export const deleteEntry = (type: 'voucher' | 'journal' | 'bill' | 'exchange', id: number) => changed(rpc<void>('acc_delete_entry', { p_type: type, p_id: id }));

// --------------------------------------------------------------- items ---
export async function fetchItems(): Promise<Item[]> {
  const { data, error } = await supabase.from('acc_items').select('*').order('name');
  fail(error);
  return ((data ?? []) as Row[]).map(toItem);
}
/** the bill item list (re-read after a change) */
export function useItems() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchItems());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, loading, error, reload };
}
export const saveItem = (id: number | null, i: Omit<Item, 'id'>) =>
  rpc<number>('acc_save_item', { p_id: id, p: { name: i.name, hsn_code: i.hsnCode, unit: i.unit, sell_rate: i.sellRate, purchase_rate: i.purchaseRate, tax_rate: i.taxRate, active: i.active } });
export const deleteItem = (id: number) => rpc<void>('acc_delete_item', { p_id: id });

// ----------------------------------------------------------- approvals ---
/** proposes drafts from the ERP documents (purchase invoices / payments, dispatches) and returns how many are pending */
export const syncDrafts = () => rpc<number>('acc_sync_drafts', {});

export async function fetchDrafts(): Promise<Draft[]> {
  const { data, error } = await supabase.from('acc_drafts').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
  fail(error);
  return ((data ?? []) as Row[]).map(toDraft);
}
export async function fetchDraft(id: number): Promise<Draft | null> {
  const { data, error } = await supabase.from('acc_drafts').select('*').eq('id', id).maybeSingle();
  fail(error);
  return data ? toDraft(data as Row) : null;
}
export interface DraftEdit {
  voucherType?: Draft['voucherType'];
  date?: string;
  from?: number | null;
  to?: number | null;
  account?: number | null;
  paymentMode?: 'Cash' | 'Debit';
  amount?: number;
  discount?: number;
  items?: DraftItem[];
  narration?: string;
  refNo?: string;
  chequeNo?: string;
}
export const saveDraftEdits = (id: number, d: DraftEdit) =>
  rpc<void>('acc_save_draft', {
    p_id: id,
    p: {
      voucher_type: d.voucherType, voucher_date: d.date || null, from_account_id: d.from ?? null, to_account_id: d.to ?? null, account_id: d.account ?? null,
      payment_mode: d.paymentMode, amount: d.amount, discount: d.discount, items: d.items, narration: d.narration, ref_no: d.refNo, cheque_no: d.chequeNo,
    },
  });
export const rejectDraft = (id: number, reason: string) => rpc<void>('acc_reject_draft', { p_id: id, p_reason: reason });

export async function fetchMaps(): Promise<AccountMap[]> {
  const { data, error } = await supabase.from('acc_account_map').select('kind, name, account_id').order('kind').order('name');
  fail(error);
  return ((data ?? []) as Row[]).map((r) => ({ kind: s(r.kind) as MapKind, name: s(r.name), account: n(r.account_id) }));
}
export const setMap = (kind: MapKind, name: string, account: number | null) => rpc<void>('acc_set_map', { p_kind: kind, p_name: name, p_account_id: account });

export async function fetchDraftsSince(): Promise<string> {
  const { data, error } = await supabase.from('acc_settings').select('drafts_since').eq('id', 1).maybeSingle();
  fail(error);
  return s((data as Row | null)?.drafts_since);
}
export const setDraftsSince = (date: string | null) => rpc<void>('acc_set_drafts_since', { p_date: date || null });

/** ERP suppliers with their details (an account can be linked to one) */
export async function fetchSuppliers(): Promise<{ id: number; name: string; gstin: string; pan: string; state: string; phone: string; address: string }[]> {
  const { data, error } = await supabase.from('suppliers').select('id, name, gstin, pan, state, phone, address').order('name');
  if (error) return [];
  return ((data ?? []) as Row[]).map((r) => ({ id: n(r.id), name: s(r.name), gstin: s(r.gstin), pan: s(r.pan), state: s(r.state), phone: s(r.phone), address: s(r.address) }));
}
