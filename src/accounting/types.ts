// ---------------------------------------------------------------------------
// Accounting module — shared types and fixed lists (migration 79).
// ---------------------------------------------------------------------------

/** Every selectable Group Name, in the order the Account form lists them. */
export const GROUP_NAMES = [
  'Advance Receipt', 'Bank Accounts (Banks)', 'Bank OCC a/c', 'Capital Account', 'Cash-in-Hand',
  'Current Assets', 'Current Liabilities', 'Deposits (Asset)', 'Duties & Taxes', 'Expense Account',
  'Expenses (Direct)', 'Fixed Assets', 'Income', 'Income (Other Than Sales)', 'Income (Trading)',
  'Investments', 'Jobwork Expense', 'Jobwork Income (Trading)', 'Loans & Advances (Asset)',
  'Loans (Liability)', 'Misc. Expenses (Asset)', 'Partner Interest', 'Partner Remuneration',
  'Provisions', 'Purchase Account', 'Reserves & Surplus', 'Revenue Accounts', 'Sales Account',
  'Secured Loans', 'Stock-in-hand', 'Sundry Creditors', 'Sundry Debtors', 'Suspense Account',
  'Unsecured Loans',
] as const;

export type GroupNature = 'asset' | 'liability' | 'capital' | 'income' | 'expense';

/** Each group's place on the Balance Sheet / P&L (Tally-style classification). */
export const GROUP_NATURE: Record<string, GroupNature> = {
  'Advance Receipt': 'liability',
  'Bank Accounts (Banks)': 'asset',
  'Bank OCC a/c': 'liability',
  'Capital Account': 'capital',
  'Cash-in-Hand': 'asset',
  'Current Assets': 'asset',
  'Current Liabilities': 'liability',
  'Deposits (Asset)': 'asset',
  'Duties & Taxes': 'liability',
  'Expense Account': 'expense',
  'Expenses (Direct)': 'expense',
  'Fixed Assets': 'asset',
  Income: 'income',
  'Income (Other Than Sales)': 'income',
  'Income (Trading)': 'income',
  Investments: 'asset',
  'Jobwork Expense': 'expense',
  'Jobwork Income (Trading)': 'income',
  'Loans & Advances (Asset)': 'asset',
  'Loans (Liability)': 'liability',
  'Misc. Expenses (Asset)': 'asset',
  'Partner Interest': 'expense',
  'Partner Remuneration': 'expense',
  Provisions: 'liability',
  'Purchase Account': 'expense',
  'Reserves & Surplus': 'capital',
  'Revenue Accounts': 'income',
  'Sales Account': 'income',
  'Secured Loans': 'liability',
  'Stock-in-hand': 'asset',
  'Sundry Creditors': 'liability',
  'Sundry Debtors': 'asset',
  'Suspense Account': 'asset',
  'Unsecured Loans': 'liability',
};

export const CASH_GROUPS = ['Cash-in-Hand'];
export const BANK_GROUPS = ['Bank Accounts (Banks)', 'Bank OCC a/c'];
export const BANK_CASH_GROUPS = [...BANK_GROUPS, ...CASH_GROUPS];
export const RECEIVABLE_PAYABLE_GROUPS = new Set(['Sundry Debtors', 'Sundry Creditors']);

/** "Trading" (Direct) groups feed the Trading Account's Gross Profit; the rest of income / expense is Indirect. */
export const TRADING_INCOME_GROUPS = new Set(['Sales Account', 'Income (Trading)', 'Jobwork Income (Trading)']);
export const TRADING_EXPENSE_GROUPS = new Set(['Purchase Account', 'Expenses (Direct)', 'Jobwork Expense']);

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Puducherry', 'Chandigarh',
  'Lakshadweep', 'Andaman and Nicobar',
];

// ------------------------------------------------------------------ rows ---
export interface Account {
  id: number;
  name: string;
  group: string;
  customerId: number | null;
  supplierId: number | null;
  opening: number;
  city: string;
  pincode: string;
  area: string;
  mobileNo: string;
  state: string;
  panNo: string;
  aadharNo: string;
  gstinNo: string;
  creditDays: number | null;
  bankName: string;
  bankBranch: string;
  ifscCode: string;
  bankAccountNo: string;
  otherDetails: string;
}

/** The five "from account → to account" voucher types, kept in one table. */
export type VoucherKind = 'cash_receipt' | 'cash_payment' | 'bank_receipt' | 'bank_payment' | 'contra';

/** a note breakdown, e.g. { 500: 2, 100: 3 } */
export type Denomination = Record<string, number>;

export interface Voucher {
  id: number;
  kind: VoucherKind;
  no: string;
  date: string;
  from: number;
  to: number;
  amount: number;
  narration: string;
  refNo: string;
  billNo: string;
  chequeNo: string;
  chequeDate: string;
  drawnOn: string;
  denomination: Denomination | null;
  returnDenomination: Denomination | null;
  changeAmount: number | null;
  createdBy: string;
  createdAt: string;
}

export interface JournalLine {
  account: number;
  amount: number;
}
export interface Journal {
  id: number;
  no: string;
  date: string;
  side: 'credit' | 'debit';
  primary: number;
  amount: number;
  narration: string;
  refNo: string;
  lines: JournalLine[];
  createdBy: string;
  createdAt: string;
}

export type BillKind = 'sales' | 'purchase';
export interface Bill {
  id: number;
  kind: BillKind;
  no: string;
  date: string;
  mode: 'Cash' | 'Debit';
  account: number | null;
  partyName: string;
  refNo: string;
  taxable: number;
  tax: number;
  discount: number;
  total: number;
  creditDays: number | null;
  dueDate: string;
  createdBy: string;
  createdAt: string;
}

export interface BillItem {
  id?: number;
  itemId: number | null;
  itemName: string;
  hsnCode: string;
  qty: number;
  rate: number;
  gstType: 'CGST/SGST' | 'IGST';
  taxRate: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface CashExchange {
  id: number;
  no: string;
  date: string;
  cashAccount: number;
  amount: number;
  given: Denomination | null;
  received: Denomination | null;
  narration: string;
  createdBy: string;
  createdAt: string;
}

export interface Item {
  id: number;
  name: string;
  hsnCode: string;
  unit: string;
  sellRate: number;
  purchaseRate: number;
  taxRate: number;
  active: boolean;
}

/** Everything the reports are worked out from, read once and shared by every accounting page. */
export interface Books {
  accounts: Account[];
  vouchers: Voucher[];
  journals: Journal[];
  bills: Bill[];
  exchanges: CashExchange[];
}

// ----------------------------------------------------------- voucher types ---
/** Where every ledger line comes from — opens / edits / deletes the right voucher. */
export type SourceType = 'sales_bill' | 'purchase_bill' | 'bank_receipt' | 'bank_payment' | 'cash_receipt' | 'cash_payment' | 'journal_voucher' | 'contra_entry';

export const SOURCE_LABEL: Record<SourceType, string> = {
  sales_bill: 'Sales Bill',
  purchase_bill: 'Purchase Bill',
  bank_receipt: 'Bank Receipt',
  bank_payment: 'Bank Payment',
  cash_receipt: 'Cash Receipt',
  cash_payment: 'Cash Payment',
  journal_voucher: 'Journal Voucher',
  contra_entry: 'Contra Entry',
};

export const KIND_SOURCE: Record<VoucherKind, SourceType> = {
  cash_receipt: 'cash_receipt',
  cash_payment: 'cash_payment',
  bank_receipt: 'bank_receipt',
  bank_payment: 'bank_payment',
  contra: 'contra_entry',
};

/** The view (?view=…) of Account Vouchers that lists / edits each voucher type. */
export const SOURCE_VIEW: Record<SourceType, string> = {
  sales_bill: 'sales-bill',
  purchase_bill: 'purchase-bill',
  bank_receipt: 'bank-receipt',
  bank_payment: 'bank-payment',
  cash_receipt: 'cash-receipt',
  cash_payment: 'cash-payment',
  journal_voucher: 'journal-voucher',
  contra_entry: 'contra-entry',
};

/** acc_delete_entry's p_type for each source */
export const SOURCE_ENTRY: Record<SourceType, 'voucher' | 'journal' | 'bill'> = {
  sales_bill: 'bill',
  purchase_bill: 'bill',
  bank_receipt: 'voucher',
  bank_payment: 'voucher',
  cash_receipt: 'voucher',
  cash_payment: 'voucher',
  journal_voucher: 'journal',
  contra_entry: 'voucher',
};

// ------------------------------------------------------------- approvals ---
export type DraftStatus = 'pending' | 'approved' | 'rejected';
export type DraftVoucherType = 'cash_receipt' | 'bank_receipt' | 'cash_payment' | 'bank_payment' | 'sales_bill' | 'purchase_bill';
export interface DraftItem {
  itemId: string;
  itemName: string;
  hsnCode: string;
  qty: string;
  rate: string;
  gstType: 'CGST/SGST' | 'IGST';
  taxRate: string;
}
export interface Draft {
  id: number;
  sourceType: 'purchase_invoice' | 'purchase_payment' | 'dispatch';
  sourceId: string;
  sourceRef: string;
  role: 'purchase_bill' | 'supplier_payment' | 'sales_bill';
  voucherType: DraftVoucherType;
  date: string;
  from: number | null;
  to: number | null;
  account: number | null;
  paymentMode: 'Cash' | 'Debit';
  amount: number;
  discount: number;
  items: DraftItem[];
  narration: string;
  refNo: string;
  chequeNo: string;
  status: DraftStatus;
  issue: string;
  rejectReason: string;
  postedId: number | null;
  postedNo: string;
  createdBy: string;
  decidedBy: string;
  decidedAt: string;
  createdAt: string;
}

export const DRAFT_TYPE_LABEL: Record<DraftVoucherType, string> = {
  bank_receipt: 'Bank Receipt',
  cash_receipt: 'Cash Receipt',
  bank_payment: 'Bank Payment',
  cash_payment: 'Cash Payment',
  sales_bill: 'Sales Bill',
  purchase_bill: 'Purchase Bill',
};

export const DRAFT_SOURCE_LABEL: Record<Draft['sourceType'], string> = {
  purchase_invoice: 'Purchase Invoice',
  purchase_payment: 'Purchase Payment',
  dispatch: 'Dispatch / Invoice',
};

export type MapKind = 'payment_mode' | 'supplier' | 'customer';
export interface AccountMap {
  kind: MapKind;
  name: string;
  account: number;
}
