// ---------------------------------------------------------------------------
// Printouts of the accounting vouchers, in the company's document layout (src/export: one SheetSpec → Excel sheet and PDF).
// ---------------------------------------------------------------------------
import { dmy } from '../sales/print';
import type { FormFormat, SheetBlock, SheetSpec, SheetValue } from '../export/xlsxSheet';
import { amountInWords, describeBalance, NOTES, round2, summarizeDenomination, type LedgerStatement } from './engine';
import type { FyRange } from './fy';
import { KIND_SOURCE, SOURCE_LABEL, type Account, type Bill, type BillItem, type CashExchange, type Denomination, type Journal, type Voucher } from './types';

/** form numbers of the accounting documents (working numbers, like the other F AC forms) */
export const ACC_FORMS: Record<string, FormFormat> = {
  voucher: { formNo: 'F AC 04', revision: '00 / 01.10.25' },
  journal: { formNo: 'F AC 05', revision: '00 / 01.10.25' },
  salesBill: { formNo: 'F AC 06', revision: '00 / 01.10.25' },
  purchaseBill: { formNo: 'F AC 07', revision: '00 / 01.10.25' },
  ledger: { formNo: 'F AC 08', revision: '00 / 01.10.25' },
  report: { formNo: 'F AC 09', revision: '00 / 01.10.25' },
  exchange: { formNo: 'F AC 10', revision: '00 / 01.10.25' },
};

const d = (iso?: string | null) => (iso ? dmy(iso) : '');
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');

function denomRows(p: Denomination | null): { cells: SheetValue[] }[] {
  if (!p) return [];
  return NOTES.filter((n) => (p[String(n)] ?? 0) > 0).map((n, i) => ({ cells: [i + 1, `₹${n}`, p[String(n)], n * (p[String(n)] ?? 0)] }));
}

/** Cash / Bank Receipt, Cash / Bank Payment and Contra Entry */
export function voucherSpec(v: Voucher, names: Record<number, string>, user: string): SheetSpec {
  const label = SOURCE_LABEL[KIND_SOURCE[v.kind]];
  const receipt = v.kind === 'cash_receipt' || v.kind === 'bank_receipt';
  const bank = v.kind === 'bank_receipt' || v.kind === 'bank_payment';
  const party = receipt ? names[v.from] : names[v.to];
  const info: string[][] = [
    [`Voucher No :- ${v.no}`, `Date :- ${d(v.date)}`, `Ref / Reg. No :- ${v.refNo}`],
    [`${receipt ? 'Received From' : v.kind === 'contra' ? 'Transfer From' : 'Paid From'} :- ${names[v.from] ?? ''}`, `${receipt ? 'Received Into' : v.kind === 'contra' ? 'Transfer To' : 'Paid To'} :- ${names[v.to] ?? ''}`],
  ];
  if (bank) info.push([`Cheque / D.D. No :- ${v.chequeNo}`, `Cheque Date :- ${d(v.chequeDate)}`, v.kind === 'bank_receipt' ? `Drawn On :- ${v.drawnOn}` : '']);
  if (receipt && v.billNo) info.push([`Bill No :- ${v.billNo}`]);
  const given = denomRows(v.denomination);
  const back = denomRows(v.returnDenomination);
  const noteBlock = (heading: string, rows: { cells: SheetValue[] }[]): SheetBlock => ({ heading, headers: ['Sr. No.', 'Note', 'Count', 'Value (₹)'], align: ['center', 'left', 'right', 'right'], rows });
  return {
    filename: safe(v.no),
    sheet: v.no,
    form: ACC_FORMS.voucher,
    title: label,
    info,
    widths: [7, 46, 14, 20],
    blocks: [
      {
        headers: ['Sr. No.', 'Particulars', 'Amount (₹)'],
        spans: [1, 2, 1],
        align: ['center', 'left', 'right'],
        rows: [
          { cells: [1, `${label} ${receipt ? 'from' : 'to'} ${party ?? ''}${v.narration ? `\n${v.narration}` : ''}`, round2(v.amount)] },
          { cells: ['', `Amount in words: ${amountInWords(v.amount)}`, round2(v.amount)], bold: true },
        ],
      },
      ...(given.length ? [noteBlock(receipt ? 'Cash Tendered' : 'Cash Paid', given)] : []),
      ...(back.length ? [noteBlock(receipt ? 'Change Given Back' : 'Change Received Back', back)] : []),
    ],
    notes: [],
    checkedBy: user,
    reviewedBy: v.createdBy,
  };
}

export function journalSpec(j: Journal, names: Record<number, string>, user: string): SheetSpec {
  const credit = j.side === 'credit';
  const primaryRow: SheetValue[] = [1, names[j.primary] ?? '', credit ? '' : round2(j.amount), credit ? round2(j.amount) : ''];
  const lineRows = j.lines.map((l, i) => ({ cells: [i + 2, names[l.account] ?? '', credit ? round2(l.amount) : '', credit ? '' : round2(l.amount)] as SheetValue[] }));
  return {
    filename: safe(j.no),
    sheet: j.no,
    form: ACC_FORMS.journal,
    title: 'Journal Voucher',
    info: [[`Voucher No :- ${j.no}`, `Date :- ${d(j.date)}`, `Ref / Reg. No :- ${j.refNo}`]],
    widths: [7, 46, 17, 17],
    blocks: [
      {
        headers: ['Sr. No.', 'Account', 'Debit (₹)', 'Credit (₹)'],
        align: ['center', 'left', 'right', 'right'],
        rows: [{ cells: primaryRow }, ...lineRows, { cells: ['', 'Total', round2(j.amount), round2(j.amount)], bold: true }],
      },
    ],
    notes: [...(j.narration ? [`Narration : ${j.narration}`] : []), `Amount in words : ${amountInWords(j.amount)}`],
    checkedBy: user,
    reviewedBy: j.createdBy,
  };
}

export function billSpec(b: Bill, items: BillItem[], account: Account | undefined, user: string): SheetSpec {
  const sales = b.kind === 'sales';
  const igst = items.some((i) => i.gstType === 'IGST');
  const party = b.mode === 'Cash' ? (sales ? 'Cash Customer' : 'Cash Purchase') : account?.name || b.partyName;
  const addr = account ? [account.area, account.city, account.state, account.pincode].filter(Boolean).join(', ') : '';
  return {
    filename: safe(b.no),
    sheet: b.no,
    form: sales ? ACC_FORMS.salesBill : ACC_FORMS.purchaseBill,
    title: sales ? 'Sales Bill' : 'Purchase Bill',
    info: [
      [`Bill No :- ${b.no}`, `Date :- ${d(b.date)}`, `Payment :- ${b.mode}`],
      [`${sales ? 'Bill To' : 'Supplier'} :- ${party}`, `GSTIN :- ${account?.gstinNo ?? ''}`, `Ref / Reg. No :- ${b.refNo}`],
      ...(addr || b.dueDate ? [[addr ? `Address :- ${addr}` : '', b.dueDate ? `Due Date :- ${d(b.dueDate)} (${b.creditDays ?? 0} days)` : '']] : []),
    ],
    widths: [6, 30, 10, 9, 12, 14, 9, 12, 14],
    blocks: [
      {
        headers: ['Sr. No.', 'Item', 'HSN', 'Qty', 'Rate (₹)', 'Taxable (₹)', 'GST %', 'Tax (₹)', 'Amount (₹)'],
        align: ['center', 'left', 'center', 'right', 'right', 'right', 'center', 'right', 'right'],
        rows: [
          ...items.map((it, i) => ({ cells: [i + 1, it.itemName, it.hsnCode, it.qty, it.rate, it.taxable, `${it.taxRate}%${it.gstType === 'IGST' ? ' IGST' : ''}`, it.tax, it.total] as SheetValue[] })),
          { cells: ['', '', '', '', '', '', '', 'Taxable', round2(b.taxable)] },
          ...(igst ? [{ cells: ['', '', '', '', '', '', '', 'IGST', round2(b.tax)] as SheetValue[] }] : [{ cells: ['', '', '', '', '', '', '', 'CGST', round2(b.tax / 2)] as SheetValue[] }, { cells: ['', '', '', '', '', '', '', 'SGST', round2(b.tax - round2(b.tax / 2))] as SheetValue[] }]),
          ...(b.discount > 0 ? [{ cells: ['', '', '', '', '', '', '', 'Discount', -round2(b.discount)] as SheetValue[] }] : []),
          { cells: ['', '', '', '', '', '', '', 'Total', round2(b.total)], bold: true },
        ],
      },
    ],
    notes: [`Amount in words : ${amountInWords(b.total)}`],
    checkedBy: user,
    reviewedBy: b.createdBy,
  };
}

export function exchangeSpec(e: CashExchange, names: Record<number, string>, user: string): SheetSpec {
  return {
    filename: safe(e.no),
    sheet: e.no,
    form: ACC_FORMS.exchange,
    title: 'Cash Exchange',
    info: [[`Voucher No :- ${e.no}`, `Date :- ${d(e.date)}`, `Cash Account :- ${names[e.cashAccount] ?? ''}`]],
    widths: [7, 54, 20],
    blocks: [
      {
        headers: ['Sr. No.', 'Notes', 'Value (₹)'],
        align: ['center', 'left', 'right'],
        rows: [
          { cells: [1, `Given: ${summarizeDenomination(e.given)}`, e.amount] },
          { cells: [2, `Received: ${summarizeDenomination(e.received)}`, e.amount] },
        ],
      },
    ],
    notes: e.narration ? [`Narration : ${e.narration}`] : [],
    checkedBy: user,
    reviewedBy: e.createdBy,
  };
}

/** an account's ledger statement for a range */
export function ledgerSpec(a: Account, st: LedgerStatement, range: FyRange, user: string): SheetSpec {
  const bal = (n: number) => {
    const { abs, type } = describeBalance(n);
    return `${abs.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${type}`;
  };
  return {
    filename: safe(`Ledger-${a.name}`),
    sheet: 'Ledger',
    form: ACC_FORMS.ledger,
    title: 'Ledger Account',
    info: [
      [`Account :- ${a.name}`, `Group :- ${a.group}`, `Period :- ${d(range.start)} to ${d(range.end)}`],
      [`Address :- ${[a.area, a.city, a.state, a.pincode].filter(Boolean).join(', ')}`],
    ],
    widths: [7, 12, 40, 14, 14, 18],
    blocks: [
      {
        headers: ['Sr. No.', 'Date', 'Particulars', 'Debit (₹)', 'Credit (₹)', 'Balance (₹)'],
        align: ['center', 'center', 'left', 'right', 'right', 'right'],
        rows: [
          { cells: ['', d(range.start), 'Opening Balance', '', '', bal(st.opening)], bold: true },
          ...st.rows.map((r, i) => ({ cells: [i + 1, d(r.date), `${r.particulars}${r.narration ? `\n${r.narration}` : ''}`, r.debit || '', r.credit || '', bal(r.balance)] as SheetValue[] })),
          { cells: ['', '', 'Total', st.totalDebit, st.totalCredit, ''], bold: true },
          { cells: ['', d(range.end), 'Closing Balance', '', '', bal(st.closing)], bold: true },
        ],
      },
    ],
    checkedBy: user,
  };
}
