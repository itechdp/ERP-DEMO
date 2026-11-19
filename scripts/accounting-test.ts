// The accounting calculations (src/accounting/engine.ts): balances, ledger statements, day book, P&L, balance sheet, dashboard,
// receivable / payable, cash denominations, bill totals and amount in words.
// Run: npm run test:accounting
import {
  accountBalance, amountInWords, balanceSheet, billTotals, computeBalances, dashboardData, dayBookDays, dayBookEntries, denominationPayload,
  denominationReport, denominationTotal, describeBalance, ledgerEntries, ledgerStatement, lineExclTax, lineTax, narrationsByAccount, profitLoss,
  rateFromInclTax, receivablePayable, round2, summarizeDenomination,
} from '../src/accounting/engine';
import { customDateRange, dayBefore, fyOf, fyRange, fyShort, listFinancialYears, openingCutoff } from '../src/accounting/fy';
import type { Account, Bill, Books, CashExchange, Journal, Voucher } from '../src/accounting/types';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// ---------------------------------------------------------------- fixture
const acc = (id: number, name: string, group: string, opening = 0): Account => ({
  id, name, group, opening, customerId: null, supplierId: null, city: '', pincode: '', area: '', mobileNo: '', state: '', panNo: '', aadharNo: '', gstinNo: '',
  creditDays: null, bankName: '', bankBranch: '', ifscCode: '', bankAccountNo: '', otherDetails: '',
});
const v = (id: number, kind: Voucher['kind'], date: string, from: number, to: number, amount: number, extra: Partial<Voucher> = {}): Voucher => ({
  id, kind, no: `${kind}-${id}`, date, from, to, amount, narration: '', refNo: '', billNo: '', chequeNo: '', chequeDate: '', drawnOn: '', denomination: null,
  returnDenomination: null, changeAmount: null, createdBy: '', createdAt: `${date}T10:00:00Z`, ...extra,
});
const bill = (id: number, kind: Bill['kind'], date: string, mode: Bill['mode'], account: number | null, total: number): Bill => ({
  id, kind, no: `${kind}-${id}`, date, mode, account, partyName: '', refNo: '', taxable: total, tax: 0, discount: 0, total, creditDays: null, dueDate: '', createdBy: '', createdAt: `${date}T10:00:00Z`,
});

const CASH = 1, BANK = 2, RANA = 3, OFFICE = 4, CAPITAL = 5, SUPP = 6, RENT_INC = 7;
const books: Books = {
  accounts: [
    acc(CASH, 'Cash', 'Cash-in-Hand', 10000),
    acc(BANK, 'HDFC Bank', 'Bank Accounts (Banks)', 50000),
    acc(RANA, 'Rana Traders', 'Sundry Debtors', 2000),
    acc(OFFICE, 'Office Expense', 'Expense Account', 999), // a nominal opening: ignored inside an FY
    acc(CAPITAL, 'Capital', 'Capital Account', -61499), // the openings net to zero (a balanced trial balance)
    acc(SUPP, 'Shree Steels', 'Sundry Creditors', -1500),
    acc(RENT_INC, 'Rent Received', 'Income (Other Than Sales)', 0),
  ],
  vouchers: [
    v(1, 'cash_receipt', '2026-05-10', RANA, CASH, 4800, { denomination: { 500: 10 }, returnDenomination: { 100: 2 } }),
    v(2, 'cash_payment', '2026-06-01', CASH, OFFICE, 300, { denomination: { 200: 1, 100: 1 }, narration: 'tea and stationery' }),
    v(3, 'bank_payment', '2026-06-15', BANK, SUPP, 1500, { refNo: 'CHQ-77' }),
    v(4, 'contra', '2026-07-01', CASH, BANK, 2000),
    v(5, 'bank_receipt', '2026-08-01', RENT_INC, BANK, 5000),
    v(6, 'cash_receipt', '2025-12-01', RANA, CASH, 1000), // previous FY
    v(7, 'cash_receipt', '2026-08-02', RANA, CASH, 50), // no note breakdown
  ],
  journals: [
    { id: 1, no: 'JV-1', date: '2026-09-01', side: 'credit', primary: RANA, amount: 300, narration: 'write off', refNo: '', lines: [{ account: OFFICE, amount: 200 }, { account: CASH, amount: 100 }], createdBy: '', createdAt: '2026-09-01T00:00:00Z' } as Journal,
  ],
  bills: [
    bill(1, 'sales', '2026-05-01', 'Debit', RANA, 11800),
    bill(2, 'purchase', '2026-05-20', 'Debit', SUPP, 5900),
    bill(3, 'sales', '2026-05-21', 'Cash', null, 999), // Cash bills stay out of the books
    bill(4, 'sales', '2025-11-01', 'Debit', RANA, 1000), // previous FY
  ],
  exchanges: [{ id: 1, no: 'CX-1', date: '2026-06-02', cashAccount: CASH, amount: 1000, given: { 500: 2 }, received: { 200: 5 }, narration: '', createdBy: '', createdAt: '2026-06-02T00:00:00Z' } as CashExchange],
};
const FY = fyRange(2026); // 01/04/2026 – 31/03/2027

// ---- 1. numbers
eq('round2 of 2500.825 is 2500.83 (half up, as the database rounds)', round2(2.5 * 1000.33), 2500.83);
eq('round2 of 1.005 is 1.01', round2(1.005), 1.01);
eq('round2 keeps negatives symmetric', round2(-2.345), -2.35);
eq('describeBalance: negative is Cr', describeBalance(-5), { abs: 5, type: 'Cr' });
eq('amount in words (Indian)', amountInWords(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only');
eq('amount in words of a crore', amountInWords(10000000), 'One Crore Rupees Only');

// ---- 2. bills: same as acc_save_bill in the database (tested there with the same lines)
const sb = billTotals([{ qty: '3', rate: '120.5', taxRate: '18' }, { qty: '1', rate: '99.99', taxRate: '0' }], '10');
eq('sales bill totals = 461.49 + 65.07 − 10 = 516.56 (matches the database)', sb, { taxable: 461.49, tax: 65.07, discount: 10, total: 516.56 });
const pb = billTotals([{ qty: '2.5', rate: '1000.33', taxRate: '5' }], '');
eq('purchase bill totals = 2500.83 + 125.04 = 2625.87 (matches the database)', pb, { taxable: 2500.83, tax: 125.04, discount: 0, total: 2625.87 });
eq('discount can not exceed the bill', billTotals([{ qty: 1, rate: 100, taxRate: 0 }], 500).total, 0);
eq('line taxable / tax', [lineExclTax({ qty: 3, rate: 120.5, taxRate: 18 }), lineTax({ qty: 3, rate: 120.5, taxRate: 18 })], [361.5, 65.07]);
eq('rate from tax-inclusive amount: 1180 incl. 18% for qty 1 → 1000.00', rateFromInclTax('1180', '1', '18'), '1000.00');
eq('rate from incl. tax with zero qty → nothing', rateFromInclTax('1180', '0', '18'), null);

// ---- 3. financial years
eq('FY of 12 Nov 2026 is 2026-27', fyOf('2026-11-12').startYear, 2026);
eq('FY of 31 Mar 2027 is still 2026-27', fyOf('2027-03-31').startYear, 2026);
eq('FY short code', fyShort(FY), '2627');
eq('day before 1 April', dayBefore('2026-04-01'), '2026-03-31');
eq('opening cutoff ends the day before the FY', openingCutoff(FY).end, '2026-03-31');
check('FY list runs from the earliest FY to the current one, newest first', (() => { const l = listFinancialYears('2024-06-01'); return l[l.length - 1].startYear === 2024 && l[0].startYear >= 2026; })());

// ---- 4. balances
const all = computeBalances(books);
// Cash: 10000 + 4800 − 300 − 2000 + 1000 + 50 + 100 (JV line, debit) = 13650
eq('cash all-time balance', all[CASH], 13650);
// Rana: 2000 + 11800 + 1000 (old bill) − 4800 − 1000 − 50 − 300 (JV primary credit) = 8650
eq('debtor all-time balance', all[RANA], 8650);
// Shree: −1500 − 5900 + 1500 = −5900
eq('creditor all-time balance (Cr)', all[SUPP], -5900);
const inFyBal = computeBalances(books, FY);
eq('nominal account opens the FY at 0 (opening 999 ignored): 300 + 200', inFyBal[OFFICE], 500);
eq('income account in the FY is a credit of 5000', inFyBal[RENT_INC], -5000);
const opening = computeBalances(books, openingCutoff(FY));
// Rana before the FY: 2000 + 1000 − 1000 = 2000
eq('debtor opening for the FY carries prior years', opening[RANA], 2000);
eq('nominal account opening for the FY is 0', opening[OFFICE], 0);
eq('voucher form balance leaves out the voucher being edited', accountBalance(books, CASH, { source: 'cash_receipt', id: 1 }), 13650 - 4800);

// ---- 5. ledger
const rana = books.accounts.find((a) => a.id === RANA)!;
const st = ledgerStatement(rana, ledgerEntries(books, RANA), FY);
eq('ledger opening', st.opening, 2000);
eq('ledger debits in the FY (sales bill)', st.totalDebit, 11800);
eq('ledger credits in the FY (4800 + 50 + 300)', st.totalCredit, 5150);
eq('ledger closing = opening + Dr − Cr', st.closing, 8650);
eq('running balance ends at the closing', st.rows[st.rows.length - 1].balance, st.closing);
check('a receipt shows as "Cash Receipt … → To account" on the payer', ledgerEntries(books, RANA).some((e) => e.particulars === 'Cash Receipt cash_receipt-1 → Cash' && e.credit === 4800));
check('journal line shows "↔ primary account"', ledgerEntries(books, OFFICE).some((e) => e.particulars === 'Journal Voucher JV-1 ↔ Rana Traders' && e.debit === 200));
check('a Cash bill never reaches a ledger', !ledgerEntries(books, RANA).some((e) => e.voucherNo === 'sales-3'));
const office = books.accounts.find((a) => a.id === OFFICE)!;
eq('nominal ledger opens at 0 for a range', ledgerStatement(office, ledgerEntries(books, OFFICE), customDateRange('2026-06-01', '2026-12-31')).opening, 0);
check('ledger search finds an account by narration', (narrationsByAccount(books)[OFFICE] ?? []).includes('tea and stationery'));

// ---- 6. day book
const days = dayBookDays(dayBookEntries(books), FY);
check('day book lists only days inside the FY', days.every((d) => d.date >= FY.start && d.date <= FY.end));
eq('day book entry for a journal: Dr lines, Cr primary', dayBookEntries(books).find((e) => e.voucherNo === 'JV-1') && [dayBookEntries(books).find((e) => e.voucherNo === 'JV-1')!.debitLabel, dayBookEntries(books).find((e) => e.voucherNo === 'JV-1')!.creditLabel], ['Office Expense + Cash', 'Rana Traders']);

// ---- 7. P&L and balance sheet
const pl = profitLoss(books, FY);
eq('trading income = Debit sales bills in the FY', pl.tradingIncomeTotal, 11800);
eq('trading expense = Debit purchase bills in the FY', pl.tradingExpenseTotal, 5900);
eq('gross profit', pl.grossProfit, 5900);
eq('indirect income (rent)', pl.indirectIncomeTotal, 5000);
eq('indirect expense (office: 300 + 200)', pl.indirectExpenseTotal, 500);
eq('net profit = 5900 + 5000 − 500', pl.netProfit, 10400);
eq('both P&L sides balance', pl.incomeSideTotal, pl.expenseSideTotal);
const bs = balanceSheet(books, FY);
check('balance sheet balances (Assets = Liabilities + Capital + Profit)', Math.abs(bs.totalAssets - bs.liabilitiesSideTotal) < 0.01, bs);
eq('balance sheet net profit = P&L net profit', bs.netProfit, pl.netProfit);
eq('opening profit = prior-year sales 1000 − prior nominal opening 999', bs.openingProfit, 1);
const bsAll = balanceSheet(books);
check('all-time balance sheet balances too', Math.abs(bsAll.totalAssets - bsAll.liabilitiesSideTotal) < 0.01, bsAll);
const unbalanced: Books = { ...books, accounts: books.accounts.map((a) => (a.id === CAPITAL ? { ...a, opening: -62000 } : a)) };
const off = balanceSheet(unbalanced, FY);
eq('openings that do not net to zero show up as the balance-sheet difference', round2(off.liabilitiesSideTotal - off.totalAssets), 501);

// ---- 8. receivable / payable and dashboard
eq('receivable: debtors with a Dr balance', receivablePayable(books, FY, 'receivable').map((r) => [r.account.name, r.balance]), [['Rana Traders', 8650]]);
eq('payable: creditors with a Cr balance', receivablePayable(books, FY, 'payable').map((r) => [r.account.name, r.balance]), [['Shree Steels', 5900]]);
const dash = dashboardData(books, FY);
eq('dashboard voucher count (6 vouchers + 1 journal in the FY)', dash.voucherCount, 7);
eq('dashboard sell / purchase bills (Debit, in the FY)', [dash.sellBillsCount, dash.purchaseBillsCount], [1, 1]);
eq('dashboard cash / bank collection', [dash.cashCollection, dash.bankCollection], [4850, 5000]);
eq('dashboard monthly income in May (sales bill)', dash.monthly.find((m) => m.month === 'May')!.income, 11800);
eq('dashboard monthly income in Aug (rent)', dash.monthly.find((m) => m.month === 'Aug')!.income, 5000);
eq('dashboard monthly expense in Jun (office 300)', dash.monthly.find((m) => m.month === 'Jun')!.expense, 300);

// ---- 9. cash denominations
eq('denomination total', denominationTotal({ 500: '3', 20: '2' }), 1540);
eq('empty breakdown saves as null', denominationPayload({ 500: '', 100: '0' }), null);
eq('summary text, largest note first', summarizeDenomination({ 100: 1, 500: 2 }), '2×₹500, 1×₹100');
const den = denominationReport(books);
// ₹500: +10 (receipt) −2 (exchange) = 8 · ₹200: −1 (payment) +5 (exchange) = 4 · ₹100: −2 (change) −1 (payment) = −3
eq('net notes in the drawer', [den.net[500], den.net[200], den.net[100]], [8, 4, -3]);
eq('cash in hand from the notes', den.totalValue, 8 * 500 + 4 * 200 - 300);
eq('vouchers without a breakdown are counted', [den.missingReceipts, den.missingPayments], [2, 0]);

console.log(`\n${failed === 0 ? 'All accounting checks passed.' : `${failed} check(s) FAILED.`}`);
if (failed) process.exit(1);
