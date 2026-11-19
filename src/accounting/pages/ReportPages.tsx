// Accounting Report — Day Book, Receivable, Payable, Balance Sheet and Profit & Loss.
import { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Calendar, ChevronRight, IndianRupee, Scale, Target, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Empty, Kpi, PageHeader, Search, go } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { usePaged } from '../../components/Pager';
import { DocButtons, ListButtons } from '../../export/docOutput';
import { balanceSheet, dayBookDays, dayBookEntries, earliestDate, inr, profitLoss, receivablePayable, type GroupLine } from '../engine';
import { useFy } from '../fy';
import { ACC_FORMS } from '../print';
import type { SheetSpec } from '../../export/xlsxSheet';
import { BooksGate, FySelector, HubCard, ar, av, fyText, useAccBooks, type HubCardDef } from '../components';
import { EntryActions } from './LedgerPages';
import type { DayBookEntry } from '../engine';

const REPORT_CARDS: HubCardDef[] = [
  { title: 'Day Book', description: 'Pick a date and see every transaction recorded that day — sales, purchases, receipts, payments, journals and contra entries, with Debit and Credit side by side.', icon: Calendar, tone: 'amber', to: ar('day-book'), linkText: 'View Day Book' },
  { title: 'Receivable', description: 'Every account that owes you money — all outstanding Debit balances of Sundry Debtors / Creditors in one place.', icon: TrendingUp, tone: 'green', to: ar('receivable'), linkText: 'View Receivable' },
  { title: 'Payable', description: 'Every account you owe money to — all outstanding Credit balances of Sundry Debtors / Creditors in one place.', icon: TrendingDown, tone: 'red', to: ar('payable'), linkText: 'View Payable' },
  { title: 'Balance Sheet', description: "Assets vs. Liabilities & Capital, computed live from every account's closing balance — with Net Profit / Loss folded in and a balance check.", icon: Scale, tone: 'blue', to: ar('balance-sheet'), linkText: 'View Balance Sheet' },
  { title: 'Profit & Loss Account', description: 'Gross Profit from Trading, then Indirect Income vs. Indirect Expense down to Net Profit — every ledger account shown under its group.', icon: BarChart3, tone: 'amber', to: ar('profit-loss'), linkText: 'View Profit & Loss Account' },
];

export function ReportHub() {
  const { books } = useAccBooks();
  return (
    <>
      <PageHeader eyebrow="Accounting" title="Accounting Report" actions={<FySelector earliest={books ? earliestDate(books) : null} />} />
      <div className="acct-cards">
        {REPORT_CARDS.map((c) => (
          <HubCard key={c.title} c={c} />
        ))}
      </div>
    </>
  );
}

const backToReports = (
  <button className="btn btn-subtle" onClick={() => go(ar())}>
    <ArrowLeft size={15} /> Reports
  </button>
);

// --------------------------------------------------------------- day book ---
export function DayBookList() {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const [date, setDate] = useState('');
  const days = useMemo(() => (books ? dayBookDays(dayBookEntries(books), fy) : []), [books, fy]);
  const shown = days.filter((d) => !date || d.date === date);
  const pg = usePaged(shown, `${fy.startYear}${date}`);
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Accounting Report"
        title="Day Book"
        subtitle={`Every day of ${fyText(fy)} with transactions. Pick a day to see them.`}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            {backToReports}
            <ListButtons doc={() => ({ filename: 'Day Book', title: 'Day Book Summary', form: ACC_FORMS.report, info: [[`FY :- ${fy.label}`]], rows: shown, cols: [{ label: 'Date', key: 'date', kind: 'date' }, { label: 'Transactions', key: 'count', kind: 'num' }, { label: 'Total (₹)', key: 'total', kind: 'money' }], totals: ['count', 'total'] })} />
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="card">
          <div className="card-head">
            <div className="table-search-row">
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Jump to a date" style={{ maxWidth: 200 }} />
              {date && (
                <button className="btn btn-primary" onClick={() => go(ar('day-book', { date }))}>
                  Open {fmtDate(date)} <ChevronRight size={15} />
                </button>
              )}
            </div>
            <div className="right text-xs muted">{shown.length} days</div>
          </div>
          {shown.length === 0 ? (
            <Empty icon={Calendar} title="No transactions" text={date ? 'Nothing was recorded on that date.' : `Nothing recorded in ${fyText(fy)}.`} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="r">Transactions</th>
                    <th className="r">Total Debit</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((d) => (
                    <tr key={d.date} className="row-click" onClick={() => go(ar('day-book', { date: d.date }))}>
                      <td className="strong nowrap">{fmtDate(d.date)}</td>
                      <td className="r num">{d.count}</td>
                      <td className="r num strong nowrap">{inr(d.total)}</td>
                      <td className="muted">
                        <ChevronRight size={16} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pg.pager}
            </div>
          )}
        </div>
      </BooksGate>
    </>
  );
}

export function DayBookView({ date }: { date: string }) {
  const { books, loading, error, reload } = useAccBooks();
  const [detail, setDetail] = useState<DayBookEntry | null>(null);
  const rows = useMemo(() => (books ? dayBookEntries(books).filter((e) => e.date === date) : []), [books, date]);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Day Book"
        title={`Day Book — ${fmtDate(date)}`}
        actions={
          <>
            <ListButtons doc={() => ({ filename: `Day Book ${date}`, title: 'Day Book', form: ACC_FORMS.report, info: [[`Date :- ${fmtDate(date)}`]], rows: rows.map((r) => ({ type: r.voucherType, no: r.voucherNo, dr: r.debitLabel, cr: r.creditLabel, amount: r.amount })), cols: [{ label: 'Voucher Type', key: 'type' }, { label: 'Voucher No.', key: 'no' }, { label: 'Debit', key: 'dr', width: 28 }, { label: 'Credit', key: 'cr', width: 28 }, { label: 'Amount (₹)', key: 'amount', kind: 'money' }], totals: ['amount'] })} />
            <button className="btn" onClick={() => go(ar('day-book'))}>
              <ArrowLeft size={15} /> Back
            </button>
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="card">
          {rows.length === 0 ? (
            <Empty icon={Calendar} title="No transactions on this date" />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Voucher Type</th>
                    <th>Voucher No.</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th className="r">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.sourceType}-${r.sourceId}`} className="row-click" onClick={() => setDetail(r)}>
                      <td>{r.voucherType}</td>
                      <td className="acct-no">{r.voucherNo}</td>
                      <td>{r.debitLabel}</td>
                      <td>{r.creditLabel}</td>
                      <td className="r num strong nowrap">{inr(r.amount)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={4} className="strong">
                      Total
                    </td>
                    <td className="r num strong nowrap">{inr(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </BooksGate>
      {detail && (
        <EntryActions
          entry={{ sourceType: detail.sourceType, sourceId: detail.sourceId, voucherNo: detail.voucherNo, date: detail.date, particulars: `${detail.debitLabel} Dr / ${detail.creditLabel} Cr`, refNo: '', debit: detail.amount, credit: detail.amount }}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

// --------------------------------------------------- receivable / payable ---
export function ReceivablePayable({ which }: { which: 'receivable' | 'payable' }) {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const [q, setQ] = useState('');
  const recv = which === 'receivable';
  const all = useMemo(() => (books ? receivablePayable(books, fy, which) : []), [books, fy, which]);
  const rows = all.filter((r) => matches(q, r.account.name, r.account.group));
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const pg = usePaged(rows, `${q}${fy.startYear}`);
  const title = recv ? 'Receivable' : 'Payable';
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Accounting Report"
        title={`${title} Report`}
        subtitle={`${recv ? 'What every debtor / creditor account owes you' : 'What you owe every debtor / creditor account'} at the end of ${fyText(fy)}.`}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            {backToReports}
            <ListButtons doc={() => ({ filename: `${title} Report`, title: `${title} Report`, form: ACC_FORMS.report, info: [[`FY :- ${fy.label}`]], rows: rows.map((r) => ({ name: r.account.name, group: r.account.group, amount: r.balance })), cols: [{ label: 'Account Name', key: 'name', width: 32 }, { label: 'Group Name', key: 'group', width: 22 }, { label: `${title} Amount (₹)`, key: 'amount', kind: 'money' }], totals: ['amount'] })} />
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        <div className="kpis compact">
          <Kpi label={`Total ${title}`} value={inr(total, 0)} icon={IndianRupee} tone={recv ? 'green' : 'red'} hint={`${rows.length} outstanding accounts`} />
          <Kpi label={recv ? 'Debtor Accounts' : 'Creditor Accounts'} value={rows.length} icon={Users} tone="blue" hint={fy.label} />
          <Kpi label={`Avg. ${title}`} value={inr(rows.length ? total / rows.length : 0, 0)} icon={TrendingUp} tone="teal" hint={`Per ${recv ? 'debtor' : 'creditor'} account`} />
          <Kpi label={recv ? 'Top Debtor' : 'Top Creditor'} value={rows[0] ? inr(rows[0].balance, 0) : '—'} icon={Target} tone="violet" hint={rows[0]?.account.name ?? 'None'} />
        </div>
        <div className="card">
          <div className="card-head">
            <div className="table-search-row">
              <Search value={q} onChange={setQ} placeholder="Search account…" />
            </div>
            <div className="right text-xs muted">{rows.length} accounts</div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={recv ? TrendingUp : TrendingDown} title={`Nothing ${recv ? 'receivable' : 'payable'}`} text={all.length ? 'No account matches your search.' : `No Sundry Debtor / Creditor account has a ${recv ? 'Debit' : 'Credit'} balance.`} />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Sr.</th>
                    <th>Account Name</th>
                    <th>Group Name</th>
                    <th className="r">{title} Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r, i) => (
                    <tr key={r.account.id} className="row-click" onClick={() => go(av('ledger-view', { account: r.account.id }))}>
                      <td className="muted">{i + 1}</td>
                      <td className="strong">{r.account.name}</td>
                      <td>{r.account.group}</td>
                      <td className={`r num strong nowrap ${recv ? 'acct-in' : 'acct-out'}`}>{inr(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3} className="strong">
                      Total
                    </td>
                    <td className="r num strong nowrap">{inr(total)}</td>
                  </tr>
                </tbody>
              </table>
              {pg.pager}
            </div>
          )}
        </div>
      </BooksGate>
    </>
  );
}

// ------------------------------------------------- P&L and balance sheet ---
function Side({ title, tone, lead, groups, trail, total }: { title: string; tone: string; lead?: { label: string; amount: number; sub?: string }[]; groups: GroupLine[]; trail?: { label: string; amount: number }[]; total: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className={`acct-side acct-tone-${tone}`}>
      <div className="acct-side-h">{title}</div>
      <div className="acct-side-b">
        {lead?.map((l) => (
          <div key={l.label} className="acct-single">
            <span>
              {l.label}
              {l.sub && <small>{l.sub}</small>}
            </span>
            <span className="num">{inr(l.amount)}</span>
          </div>
        ))}
        {groups.length === 0 && !lead?.length && !trail?.length && <div className="card-center-msg">Nothing here.</div>}
        {groups.map((g) => (
          <div key={g.group} className="acct-grp">
            <button type="button" className="acct-grp-h" onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))} aria-expanded={!open[g.group]}>
              <span>{g.group}</span>
              <span className="num">{inr(g.amount)}</span>
            </button>
            {!open[g.group] &&
              g.accounts.map((a) => (
                <div key={a.name} className="acct-grp-a">
                  <span>{a.name}</span>
                  <span className="num">{inr(a.amount)}</span>
                </div>
              ))}
          </div>
        ))}
        {trail?.map((l) => (
          <div key={l.label} className="acct-single">
            <span>{l.label}</span>
            <span className="num">{inr(l.amount)}</span>
          </div>
        ))}
      </div>
      <div className="acct-side-f">
        <span>Total</span>
        <span className="num">{inr(total)}</span>
      </div>
    </div>
  );
}

const groupRows = (gs: GroupLine[]) => gs.flatMap((g) => [{ cells: ['', g.group, g.amount], bold: true }, ...g.accounts.map((a) => ({ cells: ['', `    ${a.name}`, a.amount] }))]);
const tSpec = (title: string, fy: string, left: { title: string; rows: { cells: (string | number)[]; bold?: boolean }[]; total: number }, right: { title: string; rows: { cells: (string | number)[]; bold?: boolean }[]; total: number }, user: string): SheetSpec => ({
  filename: title,
  sheet: title,
  form: ACC_FORMS.report,
  title,
  info: [[`FY :- ${fy}`]],
  widths: [7, 46, 20],
  blocks: [left, right].map((s) => ({ heading: s.title, headers: ['', 'Particulars', 'Amount (₹)'], align: ['center', 'left', 'right'] as ('left' | 'center' | 'right')[], rows: [...s.rows, { cells: ['', 'Total', s.total], bold: true }] })),
  checkedBy: user,
});

export function ProfitLoss() {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const pl = useMemo(() => (books ? profitLoss(books, fy) : null), [books, fy]);
  const gp = pl && pl.tradingIncomeTotal ? (pl.grossProfit / pl.tradingIncomeTotal) * 100 : 0;
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Accounting Report"
        title="Profit & Loss Account"
        subtitle={`${fyText(fy)} — Income vs. Expense, computed from every account's movements in the year.`}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            {backToReports}
            {pl && (
              <DocButtons
                build={(u) =>
                  tSpec(
                    'Profit & Loss Account',
                    fy.label,
                    { title: 'Income', rows: [{ cells: ['', `Gross Profit (GP ${gp.toFixed(2)}%)`, pl.grossProfit], bold: true }, ...groupRows(pl.incomeGroups), ...(pl.netProfit < 0 ? [{ cells: ['', 'Net Loss b/f from P&L', -pl.netProfit], bold: true }] : [])], total: pl.incomeSideTotal },
                    { title: 'Expense', rows: [...groupRows(pl.expenseGroups), ...(pl.netProfit >= 0 ? [{ cells: ['', 'Net Profit c/o to Capital A/c', pl.netProfit], bold: true }] : [])], total: pl.expenseSideTotal },
                    u,
                  )
                }
              />
            )}
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        {pl && (
          <>
            <div className="kpis compact">
              <Kpi label="Trading Income" value={inr(pl.tradingIncomeTotal, 0)} icon={TrendingUp} tone="green" hint="Sales bills + trading income groups" />
              <Kpi label="Trading Expense" value={inr(pl.tradingExpenseTotal, 0)} icon={TrendingDown} tone="red" hint="Purchase bills + direct expense groups" />
              <Kpi label="Gross Profit" value={inr(pl.grossProfit, 0)} icon={BarChart3} tone="blue" hint={`GP: ${gp.toFixed(2)}%`} />
              <Kpi label={pl.netProfit >= 0 ? 'Net Profit' : 'Net Loss'} value={inr(Math.abs(pl.netProfit), 0)} icon={IndianRupee} tone={pl.netProfit >= 0 ? 'green' : 'red'} />
            </div>
            <div className="acct-t">
              <Side title="Income" tone="green" lead={[{ label: 'Gross Profit', amount: pl.grossProfit, sub: `GP: ${gp.toFixed(2)}%` }]} groups={pl.incomeGroups} trail={pl.netProfit < 0 ? [{ label: 'Net Loss b/f from P&L', amount: -pl.netProfit }] : undefined} total={pl.incomeSideTotal} />
              <Side title="Expense" tone="red" groups={pl.expenseGroups} trail={pl.netProfit >= 0 ? [{ label: 'Net Profit c/o to Capital A/c', amount: pl.netProfit }] : undefined} total={pl.expenseSideTotal} />
            </div>
          </>
        )}
      </BooksGate>
    </>
  );
}

export function BalanceSheet() {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const bs = useMemo(() => (books ? balanceSheet(books, fy) : null), [books, fy]);
  const diff = bs ? Math.round((bs.totalAssets - bs.liabilitiesSideTotal) * 100) / 100 : 0;
  const plLine = bs ? { label: bs.netProfit >= 0 ? 'Profit & Loss A/c (Net Profit)' : 'Profit & Loss A/c (Net Loss)', amount: bs.netProfit } : null;
  return (
    <>
      <PageHeader
        eyebrow="Accounting · Accounting Report"
        title="Balance Sheet"
        subtitle={`${fyText(fy)} — Assets vs. Liabilities & Capital, from every account's closing balance.`}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            {backToReports}
            {bs && plLine && (
              <DocButtons
                build={(u) =>
                  tSpec(
                    'Balance Sheet',
                    fy.label,
                    { title: 'Liabilities & Capital', rows: [...groupRows(bs.capitalGroups), ...(bs.openingProfit ? [{ cells: ['', 'Opening Profit (prior years)', bs.openingProfit], bold: true }] : []), { cells: ['', plLine.label, plLine.amount], bold: true }, ...groupRows(bs.liabilityGroups)], total: bs.liabilitiesSideTotal },
                    { title: 'Assets', rows: groupRows(bs.assetGroups), total: bs.totalAssets },
                    u,
                  )
                }
              />
            )}
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        {bs && plLine && (
          <>
            <div className={`callout ${Math.abs(diff) < 0.01 ? 'ok' : 'warn'}`} style={{ marginTop: 0, marginBottom: 16 }}>
              <Scale size={14} />
              <span>
                Assets: <b>{inr(bs.totalAssets)}</b> &nbsp;|&nbsp; Liabilities + Capital + Profit: <b>{inr(bs.liabilitiesSideTotal)}</b> &nbsp;—&nbsp;
                {Math.abs(diff) < 0.01 ? <b>Balanced ✓</b> : <b>Difference {inr(Math.abs(diff))}</b>}
              </span>
            </div>
            <div className="acct-t">
              <Side
                title="Liabilities & Capital"
                tone="blue"
                groups={[...bs.capitalGroups, ...bs.liabilityGroups]}
                lead={[...(bs.openingProfit ? [{ label: 'Opening Profit (prior years)', amount: bs.openingProfit }] : []), plLine]}
                total={bs.liabilitiesSideTotal}
              />
              <Side title="Assets" tone="green" groups={bs.assetGroups} total={bs.totalAssets} />
            </div>
            <div className="kpis compact" style={{ marginTop: 18 }}>
              <Kpi label="Total Income" value={inr(bs.totalIncome, 0)} icon={TrendingUp} tone="green" />
              <Kpi label="Total Expense" value={inr(bs.totalExpense, 0)} icon={TrendingDown} tone="red" />
              <Kpi label={bs.netProfit >= 0 ? 'Net Profit' : 'Net Loss'} value={inr(Math.abs(bs.netProfit), 0)} icon={IndianRupee} tone={bs.netProfit >= 0 ? 'green' : 'red'} />
            </div>
          </>
        )}
      </BooksGate>
    </>
  );
}
