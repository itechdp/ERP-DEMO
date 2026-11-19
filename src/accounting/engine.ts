// ---------------------------------------------------------------------------
// The accounting calculations. Pure functions over the Books (no database calls), so every report on every page is worked out the
// same way and can be tested (scripts/accounting-test.ts). The sign rules are those of the reference module:
//   · Sales Bill in Debit mode → its account is DEBITED (+); Purchase Bill in Debit mode → its account is CREDITED (−).
//     Cash-mode bills are recorded and printed but do not reach the books (no ledger, report or P&L figure), as in the reference.
//   · Cash / Bank Receipt, Cash / Bank Payment, Contra: the FROM account is credited (−), the TO account debited (+).
//   · Journal Voucher: the primary account posts on primary_side, every line on the opposite side.
// A positive balance is a Debit (Dr) balance, a negative one a Credit (Cr) balance.
// ---------------------------------------------------------------------------
import { dateOf, inFy, splitByFy, type FyRange } from './fy';
import {
  GROUP_NATURE,
  KIND_SOURCE,
  SOURCE_LABEL,
  TRADING_EXPENSE_GROUPS,
  TRADING_INCOME_GROUPS,
  type Account,
  type BillItem,
  type Books,
  type Denomination,
  type GroupNature,
  type SourceType,
  type Voucher,
} from './types';

// ------------------------------------------------------------- numbers ---
/** Rounds to paise the way the database does (half away from zero), without binary floating-point slips: 2500.825 → 2500.83. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = Math.sign(n) || 1;
  return (s * Math.round(Number(`${Math.abs(n).toFixed(8)}e2`))) / 100;
}

export const num = (v: string | number | null | undefined) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) ? x : 0;
};

/** ₹ 1,23,456.00 */
export const inr = (n: number, digits = 2) => `₹ ${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/** ₹1,23,456 (whole rupees) */
export const inr0 = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

/** A positive net balance is a Debit balance (Dr); negative is a Credit balance (Cr). */
export function describeBalance(balance: number): { abs: number; type: 'Dr' | 'Cr' } {
  return { abs: Math.abs(balance), type: balance < 0 ? 'Cr' : 'Dr' };
}

export const natureOf = (group: string): GroupNature | undefined => GROUP_NATURE[group];
const isNominalGroup = (group: string) => {
  const n = GROUP_NATURE[group];
  return n === 'income' || n === 'expense';
};

// ------------------------------------------------------- amount in words ---
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n: number) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = (n: number) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));
/** Indian numbering (lakh / crore): 125000 → "One Lakh Twenty Five Thousand" */
export function numberToWordsIndian(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(three(lakh) + ' Lakh');
  if (thousand) parts.push(three(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  return parts.join(' ');
}
export const amountInWords = (v: number) => `${numberToWordsIndian(v)} Rupees Only`;

// -------------------------------------------------------- denominations ---
export const NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1];
/** the text boxes of a note breakdown: { '500': '2', … } */
export type DenomInput = Record<string, string>;

export const denominationTotal = (v: DenomInput | Denomination | null | undefined) =>
  NOTES.reduce((s, note) => s + note * (parseInt(String(v?.[note] ?? ''), 10) || 0), 0);

/** only the notes with a count, or null when nothing was entered (so an untouched form saves null) */
export function denominationPayload(v: DenomInput): Denomination | null {
  const entries = NOTES.map((note) => [String(note), parseInt(v[note] ?? '', 10) || 0] as const).filter(([, q]) => q > 0);
  return entries.length ? Object.fromEntries(entries) : null;
}

export function denominationFromPayload(p: unknown): DenomInput {
  if (!p || typeof p !== 'object') return {};
  const out: DenomInput = {};
  for (const note of NOTES) {
    const q = (p as Record<string, number>)[String(note)];
    if (q) out[note] = String(q);
  }
  return out;
}

/** "2×₹500, 1×₹100" — largest note first; "—" when empty */
export function summarizeDenomination(p: unknown): string {
  const map = denominationFromPayload(p);
  const parts = Object.entries(map)
    .map(([note, q]) => [Number(note), parseInt(q, 10) || 0] as const)
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([note, q]) => `${q}×₹${note}`);
  return parts.length ? parts.join(', ') : '—';
}

// --------------------------------------------------------------- bills ---
export interface BillLineInput {
  qty: string | number;
  rate: string | number;
  taxRate: string | number;
}
/** taxable value of a line: qty × rate, rounded to paise */
export const lineExclTax = (r: BillLineInput) => round2(num(r.qty) * num(r.rate));
export const lineTax = (r: BillLineInput) => round2(lineExclTax(r) * (num(r.taxRate) / 100));
export const lineInclTax = (r: BillLineInput) => round2(lineExclTax(r) + lineTax(r));

/** The bill footer, exactly as the database works it out (acc_save_bill): the discount can not exceed the bill. */
export function billTotals(rows: BillLineInput[], discount: string | number) {
  const taxable = round2(rows.reduce((s, r) => s + lineExclTax(r), 0));
  const tax = round2(rows.reduce((s, r) => s + lineTax(r), 0));
  const disc = round2(Math.min(Math.max(num(discount), 0), taxable + tax));
  return { taxable, tax, discount: disc, total: round2(taxable + tax - disc) };
}

/** Typing the tax-inclusive amount backs out the unit price (excl. tax): rate = incl ÷ (qty × (1 + tax%)). */
export function rateFromInclTax(incl: string | number, qty: string | number, taxRate: string | number): string | null {
  const divisor = num(qty) * (1 + num(taxRate) / 100);
  if (divisor <= 0) return null;
  return (num(incl) / divisor).toFixed(2);
}

export const lineFromItem = (i: BillItem) => ({ qty: i.qty, rate: i.rate, taxRate: i.taxRate });

// ------------------------------------------------------------ balances ---
/**
 * Every account's balance in one pass.
 * With a `range`, asset / liability / capital accounts carry forward (opening balance + every movement up to range.end) while income /
 * expense accounts start the year at 0; movements after range.end are left out (balances as of the end of the range).
 * Without a range: the all-time balance.
 */
export function computeBalances(books: Books, range?: FyRange): Record<number, number> {
  const balances: Record<number, number> = {};
  const nominal: Record<number, boolean> = {};
  for (const a of books.accounts) {
    nominal[a.id] = isNominalGroup(a.group);
    balances[a.id] = nominal[a.id] ? 0 : a.opening || 0;
  }
  // all-time balances keep the opening of nominal accounts too (same as the per-account formula with no range)
  if (!range) for (const a of books.accounts) balances[a.id] = a.opening || 0;

  const add = (id: number | null | undefined, delta: number, date: string) => {
    if (id == null || !(id in balances)) return;
    if (range) {
      if (date > range.end) return;
      if (nominal[id] && date < range.start) return;
    }
    balances[id] += delta;
  };

  for (const b of books.bills) {
    if (b.mode !== 'Debit') continue;
    add(b.account, b.kind === 'sales' ? b.total || 0 : -(b.total || 0), dateOf(b.date, b.createdAt));
  }
  for (const v of books.vouchers) {
    const date = dateOf(v.date, v.createdAt);
    add(v.from, -(v.amount || 0), date);
    add(v.to, v.amount || 0, date);
  }
  for (const j of books.journals) {
    const date = dateOf(j.date, j.createdAt);
    add(j.primary, j.side === 'credit' ? -(j.amount || 0) : j.amount || 0, date);
    for (const l of j.lines) add(l.account, j.side === 'credit' ? l.amount || 0 : -(l.amount || 0), date);
  }
  for (const id of Object.keys(balances)) balances[Number(id)] = round2(balances[Number(id)]);
  return balances;
}

/** one account's current (all-time) balance — the voucher forms' "Current" figure, leaving out the voucher being edited */
export function accountBalance(books: Books, accountId: number, exclude?: { source: SourceType; id: number }): number {
  const skip = (source: SourceType, id: number) => !!exclude && exclude.source === source && exclude.id === id;
  const filtered: Books = {
    ...books,
    vouchers: books.vouchers.filter((v) => !skip(KIND_SOURCE[v.kind], v.id)),
    journals: books.journals.filter((j) => !skip('journal_voucher', j.id)),
    bills: books.bills.filter((b) => !skip(b.kind === 'sales' ? 'sales_bill' : 'purchase_bill', b.id)),
  };
  return computeBalances(filtered)[accountId] ?? 0;
}

// -------------------------------------------------------------- ledger ---
export interface LedgerEntry {
  date: string;
  particulars: string;
  narration: string;
  refNo: string;
  debit: number;
  credit: number;
  sourceType: SourceType;
  sourceId: number;
  voucherNo: string;
}

const nameMap = (books: Books) => {
  const m: Record<number, string> = {};
  for (const a of books.accounts) m[a.id] = a.name;
  return m;
};

/** every movement of one account, oldest first — the rows of its ledger */
export function ledgerEntries(books: Books, accountId: number): LedgerEntry[] {
  const names = nameMap(books);
  const out: LedgerEntry[] = [];
  for (const b of books.bills) {
    if (b.mode !== 'Debit' || b.account !== accountId) continue;
    const sales = b.kind === 'sales';
    out.push({
      date: dateOf(b.date, b.createdAt), particulars: `${sales ? 'Sales' : 'Purchase'} Bill ${b.no}`, narration: '', refNo: b.refNo,
      debit: sales ? b.total : 0, credit: sales ? 0 : b.total, sourceType: sales ? 'sales_bill' : 'purchase_bill', sourceId: b.id, voucherNo: b.no,
    });
  }
  for (const v of books.vouchers) {
    const label = SOURCE_LABEL[KIND_SOURCE[v.kind]];
    const date = dateOf(v.date, v.createdAt);
    const base = { date, narration: v.narration, refNo: v.refNo, sourceType: KIND_SOURCE[v.kind], sourceId: v.id, voucherNo: v.no };
    if (v.from === accountId) out.push({ ...base, particulars: `${label} ${v.no} → ${names[v.to] ?? ''}`.trim(), debit: 0, credit: v.amount });
    if (v.to === accountId) out.push({ ...base, particulars: `${label} ${v.no} ← ${names[v.from] ?? ''}`.trim(), debit: v.amount, credit: 0 });
  }
  for (const j of books.journals) {
    const date = dateOf(j.date, j.createdAt);
    const base = { date, narration: j.narration, refNo: j.refNo, sourceType: 'journal_voucher' as const, sourceId: j.id, voucherNo: j.no };
    if (j.primary === accountId) {
      out.push({ ...base, particulars: `Journal Voucher ${j.no}`.trim(), debit: j.side === 'credit' ? 0 : j.amount, credit: j.side === 'credit' ? j.amount : 0 });
    }
    for (const l of j.lines) {
      if (l.account !== accountId) continue;
      out.push({ ...base, particulars: `Journal Voucher ${j.no} ↔ ${names[j.primary] ?? ''}`.trim(), debit: j.side === 'credit' ? l.amount : 0, credit: j.side === 'credit' ? 0 : l.amount });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface LedgerStatement {
  opening: number;
  rows: (LedgerEntry & { balance: number })[];
  totalDebit: number;
  totalCredit: number;
  closing: number;
}

/** An account's statement for a range: opening (income / expense accounts open at 0), each entry with a running balance, closing. */
export function ledgerStatement(account: Account, entries: LedgerEntry[], range: FyRange): LedgerStatement {
  const { before, within } = splitByFy(entries, range);
  const nominal = isNominalGroup(account.group);
  const opening = round2(nominal ? 0 : (account.opening || 0) + before.reduce((s, e) => s + e.debit - e.credit, 0));
  let running = opening;
  const rows = within.map((e) => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });
  const totalDebit = round2(within.reduce((s, e) => s + e.debit, 0));
  const totalCredit = round2(within.reduce((s, e) => s + e.credit, 0));
  return { opening, rows, totalDebit, totalCredit, closing: round2(opening + totalDebit - totalCredit) };
}

/** account id → every narration and reference no. posted against it (the Ledger list's search finds an account by them) */
export function narrationsByAccount(books: Books): Record<number, string[]> {
  const map: Record<number, string[]> = {};
  const add = (id: number | null | undefined, text: string | null | undefined) => {
    if (id == null || !text) return;
    (map[id] ??= []).push(text);
  };
  for (const b of books.bills) add(b.account, b.refNo);
  for (const v of books.vouchers) {
    add(v.from, v.narration);
    add(v.to, v.narration);
    add(v.from, v.refNo);
    add(v.to, v.refNo);
  }
  for (const j of books.journals) {
    add(j.primary, j.narration);
    add(j.primary, j.refNo);
    for (const l of j.lines) {
      add(l.account, j.narration);
      add(l.account, j.refNo);
    }
  }
  return map;
}

// ------------------------------------------------------------ day book ---
export interface DayBookEntry {
  date: string;
  voucherType: string;
  voucherNo: string;
  debitLabel: string;
  creditLabel: string;
  amount: number;
  sourceType: SourceType;
  sourceId: number;
}

/** Every voucher, one row per voucher: which account is debited, which credited, and the amount. */
export function dayBookEntries(books: Books): DayBookEntry[] {
  const names = nameMap(books);
  const out: DayBookEntry[] = [];
  for (const b of books.bills) {
    if (b.mode !== 'Debit') continue;
    const sales = b.kind === 'sales';
    const party = (b.account != null ? names[b.account] : '') || b.partyName || '—';
    out.push({
      date: dateOf(b.date, b.createdAt), voucherType: sales ? 'Sales Bill' : 'Purchase Bill', voucherNo: b.no,
      debitLabel: sales ? party : 'Purchase', creditLabel: sales ? 'Sales' : party, amount: b.total, sourceType: sales ? 'sales_bill' : 'purchase_bill', sourceId: b.id,
    });
  }
  for (const v of books.vouchers) {
    out.push({
      date: dateOf(v.date, v.createdAt), voucherType: SOURCE_LABEL[KIND_SOURCE[v.kind]], voucherNo: v.no,
      debitLabel: names[v.to] || '—', creditLabel: names[v.from] || '—', amount: v.amount, sourceType: KIND_SOURCE[v.kind], sourceId: v.id,
    });
  }
  for (const j of books.journals) {
    const lineNames = j.lines.map((l) => names[l.account]).filter(Boolean).join(' + ') || '—';
    const primaryName = names[j.primary] || '—';
    out.push({
      date: dateOf(j.date, j.createdAt), voucherType: 'Journal Voucher', voucherNo: j.no,
      debitLabel: j.side === 'credit' ? lineNames : primaryName, creditLabel: j.side === 'credit' ? primaryName : lineNames,
      amount: j.amount, sourceType: 'journal_voucher', sourceId: j.id,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** the Day Book's list of dates: how many transactions and the total of each day in the range, newest first */
export function dayBookDays(entries: DayBookEntry[], range: FyRange) {
  const by = new Map<string, { date: string; count: number; total: number }>();
  for (const e of entries) {
    if (!inFy(e.date, range)) continue;
    const d = by.get(e.date) ?? { date: e.date, count: 0, total: 0 };
    d.count++;
    d.total = round2(d.total + e.amount);
    by.set(e.date, d);
  }
  return [...by.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// ------------------------------------------------------- profit & loss ---
export type AccountLine = { name: string; amount: number };
export type GroupLine = { group: string; amount: number; accounts: AccountLine[] };

export interface ProfitLossData {
  grossProfit: number;
  tradingIncomeTotal: number;
  tradingExpenseTotal: number;
  incomeGroups: GroupLine[];
  expenseGroups: GroupLine[];
  indirectIncomeTotal: number;
  indirectExpenseTotal: number;
  netProfit: number;
  incomeSideTotal: number;
  expenseSideTotal: number;
}

const byName = (a: AccountLine, b: AccountLine) => a.name.localeCompare(b.name);

/** per account: opening (unless a nominal account inside a range) + the movements whose date passes `include` */
function movementBalances(books: Books, include: (date: string) => boolean, nominalOpensAtZero: boolean) {
  const bal: Record<number, number> = {};
  for (const a of books.accounts) bal[a.id] = isNominalGroup(a.group) && nominalOpensAtZero ? 0 : a.opening || 0;
  const add = (id: number | null | undefined, delta: number) => {
    if (id == null || !(id in bal)) return;
    bal[id] += delta;
  };
  for (const b of books.bills) if (b.mode === 'Debit' && include(dateOf(b.date, b.createdAt))) add(b.account, b.kind === 'sales' ? b.total || 0 : -(b.total || 0));
  for (const v of books.vouchers) {
    if (!include(dateOf(v.date, v.createdAt))) continue;
    add(v.from, -(v.amount || 0));
    add(v.to, v.amount || 0);
  }
  for (const j of books.journals) {
    if (!include(dateOf(j.date, j.createdAt))) continue;
    add(j.primary, j.side === 'credit' ? -(j.amount || 0) : j.amount || 0);
    for (const l of j.lines) add(l.account, j.side === 'credit' ? l.amount || 0 : -(l.amount || 0));
  }
  return bal;
}

function groupsOf(books: Books, bal: Record<number, number>) {
  const byGroup: Record<string, { total: number; accounts: AccountLine[] }> = {};
  for (const a of books.accounts) {
    const raw = bal[a.id] || 0;
    const bucket = byGroup[a.group] ?? { total: 0, accounts: [] };
    bucket.total += raw;
    if (Math.abs(raw) > 0.005) bucket.accounts.push({ name: a.name, amount: raw });
    byGroup[a.group] = bucket;
  }
  return byGroup;
}

/** Sales / Purchase bill totals that reach the books (Debit mode — the reference module leaves Cash-mode bills out of every report) */
const billSum = (books: Books, kind: 'sales' | 'purchase', include: (date: string) => boolean) =>
  books.bills.reduce((s, b) => (b.kind === kind && b.mode === 'Debit' && include(dateOf(b.date, b.createdAt)) ? s + (b.total || 0) : s), 0);

/**
 * Trading Account: Gross Profit = (Sales + trading income groups) − (Purchases + trading expense groups).
 * Profit & Loss Account: Gross Profit + Indirect Income, against Indirect Expense — every ledger under its group (Tally "Groupwise Detail").
 * With a range every income / expense account opens the year at 0 — only movements dated inside it count.
 */
export function profitLoss(books: Books, range?: FyRange): ProfitLossData {
  const include = (date: string) => !range || inFy(date, range);
  const bal = movementBalances(books, include, !!range);
  const byGroup = groupsOf(books, bal);

  let tradingIncomeReal = 0;
  let tradingExpenseReal = 0;
  const incomeGroups: GroupLine[] = [];
  const expenseGroups: GroupLine[] = [];
  for (const [group, { total, accounts }] of Object.entries(byGroup)) {
    const nature = GROUP_NATURE[group];
    if (nature === 'income') {
      if (TRADING_INCOME_GROUPS.has(group)) tradingIncomeReal += -total;
      else incomeGroups.push({ group, amount: round2(-total), accounts: accounts.map((a) => ({ name: a.name, amount: round2(-a.amount) })).sort(byName) });
    } else if (nature === 'expense') {
      if (TRADING_EXPENSE_GROUPS.has(group)) tradingExpenseReal += total;
      else expenseGroups.push({ group, amount: round2(total), accounts: accounts.map((a) => ({ name: a.name, amount: round2(a.amount) })).sort(byName) });
    }
  }
  const tradingIncomeTotal = round2(tradingIncomeReal + billSum(books, 'sales', include));
  const tradingExpenseTotal = round2(tradingExpenseReal + billSum(books, 'purchase', include));
  const grossProfit = round2(tradingIncomeTotal - tradingExpenseTotal);
  const indirectIncomeTotal = round2(incomeGroups.reduce((s, g) => s + g.amount, 0));
  const indirectExpenseTotal = round2(expenseGroups.reduce((s, g) => s + g.amount, 0));
  const netProfit = round2(grossProfit + indirectIncomeTotal - indirectExpenseTotal);
  return {
    grossProfit,
    tradingIncomeTotal,
    tradingExpenseTotal,
    incomeGroups: incomeGroups.sort((a, b) => b.amount - a.amount),
    expenseGroups: expenseGroups.sort((a, b) => b.amount - a.amount),
    indirectIncomeTotal,
    indirectExpenseTotal,
    netProfit,
    // Tally mirrors both sides: the smaller side gets the Net Profit / Loss as the balancing figure
    incomeSideTotal: round2(grossProfit + indirectIncomeTotal + (netProfit < 0 ? -netProfit : 0)),
    expenseSideTotal: round2(indirectExpenseTotal + (netProfit >= 0 ? netProfit : 0)),
  };
}

// ------------------------------------------------------- balance sheet ---
export interface BalanceSheetData {
  assetGroups: GroupLine[];
  liabilityGroups: GroupLine[];
  capitalGroups: GroupLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalCapital: number;
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
  /** prior years' retained profit, folded into the capital side so the sheet balances (0 without a range) */
  openingProfit: number;
  liabilitiesSideTotal: number;
}

/** Assets = Liabilities + Capital + Net Profit, drawn as of range.end (real accounts carry their full history). */
export function balanceSheet(books: Books, range?: FyRange): BalanceSheetData {
  const nature: Record<number, GroupNature | undefined> = {};
  for (const a of books.accounts) nature[a.id] = GROUP_NATURE[a.group];
  const nominal = (id: number) => nature[id] === 'income' || nature[id] === 'expense';

  const bal: Record<number, number> = {};
  let priorNominalRaw = 0;
  for (const a of books.accounts) {
    if (range && nominal(a.id)) {
      priorNominalRaw += a.opening || 0;
      bal[a.id] = 0;
    } else bal[a.id] = a.opening || 0;
  }
  const add = (id: number | null | undefined, delta: number, date: string) => {
    if (id == null || !(id in bal)) return;
    if (range) {
      if (date > range.end) return;
      if (nominal(id) && date < range.start) {
        priorNominalRaw += delta;
        return;
      }
    }
    bal[id] += delta;
  };
  for (const b of books.bills) if (b.mode === 'Debit') add(b.account, b.kind === 'sales' ? b.total || 0 : -(b.total || 0), dateOf(b.date, b.createdAt));
  for (const v of books.vouchers) {
    const date = dateOf(v.date, v.createdAt);
    add(v.from, -(v.amount || 0), date);
    add(v.to, v.amount || 0, date);
  }
  for (const j of books.journals) {
    const date = dateOf(j.date, j.createdAt);
    add(j.primary, j.side === 'credit' ? -(j.amount || 0) : j.amount || 0, date);
    for (const l of j.lines) add(l.account, j.side === 'credit' ? l.amount || 0 : -(l.amount || 0), date);
  }

  // Sales / Purchase revenue never posts to a real "Sales Account" ledger, so it is split before / within the FY directly
  const before = (date: string) => !!range && date < range.start && date <= range.end;
  const within = (date: string) => !range || inFy(date, range);
  const openingProfit = range ? round2(-priorNominalRaw + billSum(books, 'sales', before) - billSum(books, 'purchase', before)) : 0;

  const byGroup = groupsOf(books, bal);
  const assetGroups: GroupLine[] = [];
  const liabilityGroups: GroupLine[] = [];
  const capitalGroups: GroupLine[] = [];
  let realIncome = 0;
  let realExpense = 0;
  for (const [group, { total, accounts }] of Object.entries(byGroup)) {
    const n = GROUP_NATURE[group];
    if (n === 'asset') assetGroups.push({ group, amount: round2(total), accounts: accounts.map((a) => ({ ...a, amount: round2(a.amount) })).sort(byName) });
    else if (n === 'liability') liabilityGroups.push({ group, amount: round2(-total), accounts: accounts.map((a) => ({ name: a.name, amount: round2(-a.amount) })).sort(byName) });
    else if (n === 'capital') capitalGroups.push({ group, amount: round2(-total), accounts: accounts.map((a) => ({ name: a.name, amount: round2(-a.amount) })).sort(byName) });
    else if (n === 'income') realIncome += -total;
    else if (n === 'expense') realExpense += total;
  }
  const totalIncome = round2(realIncome + billSum(books, 'sales', within));
  const totalExpense = round2(realExpense + billSum(books, 'purchase', within));
  const netProfit = round2(totalIncome - totalExpense);
  const totalAssets = round2(assetGroups.reduce((s, g) => s + g.amount, 0));
  const totalLiabilities = round2(liabilityGroups.reduce((s, g) => s + g.amount, 0));
  const totalCapital = round2(capitalGroups.reduce((s, g) => s + g.amount, 0));
  return {
    assetGroups: assetGroups.sort((a, b) => b.amount - a.amount),
    liabilityGroups: liabilityGroups.sort((a, b) => b.amount - a.amount),
    capitalGroups,
    totalAssets,
    totalLiabilities,
    totalCapital,
    totalIncome,
    totalExpense,
    netProfit,
    openingProfit,
    liabilitiesSideTotal: round2(totalLiabilities + totalCapital + openingProfit + netProfit),
  };
}

// ------------------------------------------------- receivable / payable ---
/** Sundry Debtors / Creditors with what they owe us (Dr balance) or we owe them (Cr balance) as of the end of the range, largest first. */
export function receivablePayable(books: Books, range: FyRange, which: 'receivable' | 'payable') {
  const bal = computeBalances(books, range);
  return books.accounts
    .filter((a) => a.group === 'Sundry Debtors' || a.group === 'Sundry Creditors')
    .map((a) => ({ account: a, raw: bal[a.id] ?? a.opening }))
    .filter((r) => (which === 'receivable' ? r.raw > 0.004 : r.raw < -0.004))
    .map((r) => ({ account: r.account, balance: Math.abs(r.raw) }))
    .sort((a, b) => b.balance - a.balance);
}

// ----------------------------------------------------------- dashboard ---
export interface DashboardData {
  pl: ProfitLossData;
  receivable: number;
  payable: number;
  voucherCount: number;
  sellBillsCount: number;
  purchaseBillsCount: number;
  monthly: { month: string; income: number; expense: number }[];
  incomePie: { name: string; value: number }[];
  voucherBar: { month: string; receipts: number; payments: number; journals: number }[];
  cashCollection: number;
  bankCollection: number;
  recentVouchers: { no: string; type: 'Receipt' | 'Payment' | 'Journal'; party: string; amount: number; date: string; sourceType: SourceType; id: number }[];
  recentBills: { id: number; no: string; client: string; amount: number; date: string }[];
}

/** Apr … Mar of the FY: [{ label: 'Apr', key: '2026-04' }, …] */
export function fyMonthKeys(fy: FyRange) {
  const labels = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  return labels.map((label, i) => ({ label, key: `${i < 9 ? fy.startYear : fy.startYear + 1}-${String(i < 9 ? i + 4 : i - 8).padStart(2, '0')}` }));
}

export function dashboardData(books: Books, fy: FyRange): DashboardData {
  const pl = profitLoss(books, fy);
  const balances = computeBalances(books, fy);
  const names = nameMap(books);
  const nature: Record<number, GroupNature | undefined> = {};
  for (const a of books.accounts) nature[a.id] = GROUP_NATURE[a.group];

  const months = fyMonthKeys(fy);
  const monthly: Record<string, { income: number; expense: number }> = {};
  const bars: Record<string, { receipts: number; payments: number; journals: number }> = {};
  for (const m of months) {
    monthly[m.key] = { income: 0, expense: 0 };
    bars[m.key] = { receipts: 0, payments: 0, journals: 0 };
  }
  const bump = (key: string, field: 'income' | 'expense', amount: number) => {
    if (key in monthly) monthly[key][field] += amount;
  };
  const bumpNominal = (id: number | null | undefined, delta: number, date: string) => {
    if (id == null) return;
    const key = date.slice(0, 7);
    if (!(key in monthly)) return;
    if (nature[id] === 'income') bump(key, 'income', -delta);
    else if (nature[id] === 'expense') bump(key, 'expense', delta);
  };

  let sellBillsCount = 0;
  let purchaseBillsCount = 0;
  for (const b of books.bills) {
    if (b.mode !== 'Debit') continue;
    const date = dateOf(b.date, b.createdAt);
    if (!inFy(date, fy)) continue;
    if (b.kind === 'sales') {
      sellBillsCount++;
      bump(date.slice(0, 7), 'income', b.total || 0);
    } else {
      purchaseBillsCount++;
      bump(date.slice(0, 7), 'expense', b.total || 0);
    }
  }

  let cashCollection = 0;
  let bankCollection = 0;
  let voucherCount = 0;
  const recent: DashboardData['recentVouchers'] = [];
  for (const v of books.vouchers) {
    const date = dateOf(v.date, v.createdAt);
    if (!inFy(date, fy)) continue;
    voucherCount++;
    if (v.kind === 'contra') continue;
    const receipt = v.kind === 'cash_receipt' || v.kind === 'bank_receipt';
    if (receipt) {
      if (v.kind === 'bank_receipt') bankCollection += v.amount;
      else cashCollection += v.amount;
      bars[date.slice(0, 7)].receipts++;
    } else bars[date.slice(0, 7)].payments++;
    bumpNominal(v.from, -v.amount, date);
    bumpNominal(v.to, v.amount, date);
    recent.push({ no: v.no, type: receipt ? 'Receipt' : 'Payment', party: (receipt ? names[v.from] : names[v.to]) || '—', amount: v.amount, date, sourceType: KIND_SOURCE[v.kind], id: v.id });
  }
  for (const j of books.journals) {
    const date = dateOf(j.date, j.createdAt);
    if (!inFy(date, fy)) continue;
    voucherCount++;
    bars[date.slice(0, 7)].journals++;
    bumpNominal(j.primary, j.side === 'credit' ? -j.amount : j.amount, date);
    for (const l of j.lines) bumpNominal(l.account, j.side === 'credit' ? l.amount : -l.amount, date);
    recent.push({ no: j.no, type: 'Journal', party: names[j.primary] || '—', amount: j.amount, date, sourceType: 'journal_voucher', id: j.id });
  }
  recent.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  const recentBills = books.bills
    .filter((b) => b.kind === 'sales' && b.mode === 'Debit')
    .map((b) => ({ id: b.id, no: b.no, client: (b.account != null ? names[b.account] : '') || b.partyName || 'Cash Customer', amount: b.total, date: dateOf(b.date, b.createdAt) }))
    .filter((b) => inFy(b.date, fy))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
    .slice(0, 5);

  let receivable = 0;
  let payable = 0;
  for (const a of books.accounts) {
    const b = balances[a.id] ?? 0;
    if (b > 0) receivable += b;
    else if (b < 0) payable += -b;
  }

  return {
    pl,
    receivable: round2(receivable),
    payable: round2(payable),
    voucherCount,
    sellBillsCount,
    purchaseBillsCount,
    monthly: months.map((m) => ({ month: m.label, income: round2(monthly[m.key].income), expense: round2(monthly[m.key].expense) })),
    incomePie: [{ name: 'Sales / Trading Income', value: pl.tradingIncomeTotal }, ...pl.incomeGroups.map((g) => ({ name: g.group, value: g.amount }))].filter((d) => d.value > 0.005),
    voucherBar: months.map((m) => ({ month: m.label, ...bars[m.key] })),
    cashCollection: round2(cashCollection),
    bankCollection: round2(bankCollection),
    recentVouchers: recent.slice(0, 5),
    recentBills,
  };
}

// --------------------------------------------------- cash denomination ---
export interface DenominationReport {
  /** note → net count in the drawer */
  net: Record<number, number>;
  totalValue: number;
  totalNotes: number;
  missingReceipts: number;
  missingPayments: number;
  /** one row per cash receipt / payment: the notes that came in and went out */
  vouchers: { id: number; type: 'Receipt' | 'Payment'; voucherNo: string; date: string; account: string; amount: number; notesIn: unknown; notesOut: unknown; createdAt: string; kind: Voucher['kind'] }[];
}

/** How many of each note are physically in cash-in-hand, from every cash receipt (+notes in, −change out), payment (−, +change) and exchange. */
export function denominationReport(books: Books): DenominationReport {
  const names = nameMap(books);
  const net: Record<number, number> = {};
  const add = (p: unknown, sign: 1 | -1) => {
    const map = denominationFromPayload(p);
    for (const note of NOTES) {
      const q = parseInt(map[note] ?? '0', 10) || 0;
      if (q) net[note] = (net[note] ?? 0) + sign * q;
    }
  };
  let missingReceipts = 0;
  let missingPayments = 0;
  const vouchers: DenominationReport['vouchers'] = [];
  for (const v of books.vouchers) {
    if (v.kind === 'cash_receipt') {
      if (v.denomination) {
        add(v.denomination, 1);
        add(v.returnDenomination, -1);
      } else missingReceipts++;
      vouchers.push({ id: v.id, kind: v.kind, type: 'Receipt', voucherNo: v.no, date: v.date, account: names[v.from] || '—', amount: v.amount, notesIn: v.denomination, notesOut: v.returnDenomination, createdAt: v.createdAt });
    } else if (v.kind === 'cash_payment') {
      if (v.denomination) {
        add(v.denomination, -1);
        add(v.returnDenomination, 1);
      } else missingPayments++;
      vouchers.push({ id: v.id, kind: v.kind, type: 'Payment', voucherNo: v.no, date: v.date, account: names[v.to] || '—', amount: v.amount, notesIn: v.returnDenomination, notesOut: v.denomination, createdAt: v.createdAt });
    }
  }
  for (const e of books.exchanges) {
    add(e.given, -1);
    add(e.received, 1);
  }
  vouchers.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return {
    net,
    totalValue: NOTES.reduce((s, n) => s + n * (net[n] ?? 0), 0),
    totalNotes: NOTES.reduce((s, n) => s + Math.max(0, net[n] ?? 0), 0),
    missingReceipts,
    missingPayments,
    vouchers,
  };
}

/** the earliest transaction date in the books (the FY selector lists every FY from that one on) */
export function earliestDate(books: Books): string | null {
  let min: string | null = null;
  const see = (d: string) => {
    if (d && (!min || d < min)) min = d;
  };
  for (const v of books.vouchers) see(dateOf(v.date, v.createdAt));
  for (const j of books.journals) see(dateOf(j.date, j.createdAt));
  for (const b of books.bills) see(dateOf(b.date, b.createdAt));
  for (const e of books.exchanges) see(dateOf(e.date, e.createdAt));
  return min;
}
