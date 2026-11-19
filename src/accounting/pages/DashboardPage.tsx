// Accounting Dashboard — the year at a glance (selected FY).
import { useMemo } from 'react';
import { BookOpen, ClipboardList, CreditCard, Eye, FileText, IndianRupee, Landmark, Banknote, Receipt, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Empty, Kpi, PageHeader, go } from '../../components/ui';
import { fmtDate } from '../../components/format';
import { dashboardData, earliestDate, inr } from '../engine';
import { useFy } from '../fy';
import { SOURCE_VIEW } from '../types';
import { AreaChart, BarChart, BooksGate, Donut, FySelector, ar, av, fyText, useAccBooks } from '../components';

const C = { blue: '#3b82f6', green: '#16a34a', red: '#dc2626', violet: '#7c3aed' };

export function AccountingDashboardPage() {
  const { books, loading, error, reload } = useAccBooks();
  const [fy] = useFy();
  const d = useMemo(() => (books ? dashboardData(books, fy) : null), [books, fy]);
  const revenue = d ? d.pl.tradingIncomeTotal + d.pl.indirectIncomeTotal : 0;
  const expenses = d ? d.pl.tradingExpenseTotal + d.pl.indirectExpenseTotal : 0;
  const net = d?.pl.netProfit ?? 0;
  const totalCollection = (d?.cashCollection ?? 0) + (d?.bankCollection ?? 0);
  const pct = (v: number) => (totalCollection > 0 ? Math.round((v / totalCollection) * 100) : 0);

  return (
    <>
      <PageHeader
        eyebrow="Accounting"
        title="Accounting Dashboard"
        subtitle={fyText(fy)}
        actions={
          <>
            <FySelector earliest={books ? earliestDate(books) : null} />
            <button className="btn btn-subtle" onClick={() => void reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="btn btn-subtle" onClick={() => go(av())}>
              <ClipboardList size={15} /> View All Vouchers
            </button>
          </>
        }
      />
      <BooksGate loading={loading && !books} error={error} reload={reload}>
        {d && (
          <>
            <div className="kpis compact">
              <Kpi label="Total Revenue" value={inr(revenue, 0)} icon={IndianRupee} tone="blue" />
              <Kpi label="Total Expenses" value={inr(expenses, 0)} icon={TrendingDown} tone="red" />
              <Kpi label={net >= 0 ? 'Net Profit' : 'Net Loss'} value={inr(Math.abs(net), 0)} icon={TrendingUp} tone={net >= 0 ? 'green' : 'red'} onClick={() => go(ar('profit-loss'))} />
              <Kpi label="Receivable" value={inr(d.receivable, 0)} icon={CreditCard} tone="amber" onClick={() => go(ar('receivable'))} />
              <Kpi label="Total Vouchers" value={d.voucherCount} icon={BookOpen} tone="violet" />
              <Kpi label="Sell Bills" value={d.sellBillsCount} icon={FileText} tone="teal" onClick={() => go(av('sales-bill'))} />
            </div>

            <div className="acct-grid-12">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>Income vs Expense Trend</h3>
                    <div className="sub">Month-wise income and expenditure for {fyText(fy)}</div>
                  </div>
                </div>
                <div className="card-body">
                  <AreaChart data={d.monthly} series={[{ key: 'income', label: 'Income', color: C.green }, { key: 'expense', label: 'Expense', color: C.red }]} />
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>Income Breakdown</h3>
                    <div className="sub">By ledger group, {fyText(fy)}</div>
                  </div>
                </div>
                <div className="card-body">{d.incomePie.length === 0 ? <Empty title="No income recorded yet this FY" /> : <Donut data={d.incomePie} />}</div>
              </div>
            </div>

            <div className="acct-grid-12">
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>Voucher Activity</h3>
                    <div className="sub">Receipts, payments and journal entries by month</div>
                  </div>
                </div>
                <div className="card-body">
                  <BarChart data={d.voucherBar} series={[{ key: 'receipts', label: 'Receipts', color: C.green }, { key: 'payments', label: 'Payments', color: C.red }, { key: 'journals', label: 'Journals', color: C.blue }]} />
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>Collection by Mode</h3>
                    <div className="sub">Cash vs Bank receipts, {fyText(fy)}</div>
                  </div>
                </div>
                <div className="card-body">
                  {[
                    { mode: 'Cash', amount: d.cashCollection, color: C.blue },
                    { mode: 'Bank', amount: d.bankCollection, color: C.violet },
                  ].map((c) => (
                    <div key={c.mode} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                        <span className="strong">{c.mode}</span>
                        <span>
                          <span className="muted">{pct(c.amount)}%</span> &nbsp;<b className="num">{inr(c.amount, 0)}</b>
                        </span>
                      </div>
                      <div className="acct-meter">
                        <div style={{ width: `${pct(c.amount)}%`, background: c.color }} />
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 13 }}>
                    <span className="strong">Total Collection</span>
                    <b className="num" style={{ color: 'var(--primary)' }}>{inr(totalCollection, 0)}</b>
                  </div>
                  <div className="acct-quick">
                    <button onClick={() => go(av())}>
                      <BookOpen size={15} color={C.blue} /> Vouchers
                    </button>
                    <button onClick={() => go(av('sales-bill'))}>
                      <FileText size={15} color={C.green} /> Sell Bills
                    </button>
                    <button onClick={() => go(ar('receivable'))}>
                      <Wallet size={15} color={C.violet} /> Receivable
                    </button>
                    <button onClick={() => go(ar('payable'))}>
                      <CreditCard size={15} color="#ea580c" /> Payable
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="acct-grid-12" style={{ gridTemplateColumns: 'minmax(0,5fr) minmax(0,7fr)' }}>
              <div className="card">
                <div className="card-head">
                  <h3>Recent Vouchers</h3>
                  <button className="btn btn-sm btn-subtle" onClick={() => go(av())}>
                    View All
                  </button>
                </div>
                {d.recentVouchers.length === 0 ? (
                  <Empty title="No vouchers recorded yet this FY" />
                ) : (
                  <ul className="acct-feed">
                    {d.recentVouchers.map((v) => (
                      <li key={`${v.sourceType}-${v.id}`} className="row-click" style={{ cursor: 'pointer' }} onClick={() => go(av(SOURCE_VIEW[v.sourceType], { id: v.id, mode: 'view', back: 'accounting-dashboard' }))}>
                        <span className="ic" style={{ background: v.type === 'Receipt' ? 'var(--good-bg)' : v.type === 'Payment' ? 'var(--crit-bg)' : 'var(--info-bg)', color: v.type === 'Receipt' ? 'var(--good)' : v.type === 'Payment' ? 'var(--crit)' : 'var(--info)' }}>
                          {v.type === 'Receipt' ? <Receipt size={16} /> : v.type === 'Payment' ? <CreditCard size={16} /> : <BookOpen size={16} />}
                        </span>
                        <span className="tx">
                          <b>{v.no}</b> <span className={`badge ${v.type === 'Receipt' ? 'b-green' : v.type === 'Payment' ? 'b-red' : 'b-blue'}`}>{v.type}</span>
                          <div>
                            {v.party} · {fmtDate(v.date)}
                          </div>
                        </span>
                        <span className="amt num">{inr(v.amount, 0)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Recent Sell Bills</h3>
                  <button className="btn btn-sm btn-subtle" onClick={() => go(av('sales-bill'))}>
                    View All
                  </button>
                </div>
                {d.recentBills.length === 0 ? (
                  <Empty title="No sell bills recorded yet this FY" />
                ) : (
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Bill No.</th>
                          <th>Client</th>
                          <th>Date</th>
                          <th className="r">Amount</th>
                          <th className="act">View</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.recentBills.map((b) => (
                          <tr key={b.id}>
                            <td className="acct-no in">{b.no}</td>
                            <td>{b.client}</td>
                            <td className="nowrap">{fmtDate(b.date)}</td>
                            <td className="r num strong nowrap">{inr(b.amount, 0)}</td>
                            <td className="act">
                              <button className="icon-btn" title="View" onClick={() => go(av('sales-bill', { id: b.id, mode: 'view', back: 'accounting-dashboard' }))}>
                                <Eye size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="kpis compact">
              <Kpi label="Cash Collection" value={inr(d.cashCollection, 0)} icon={Banknote} tone="blue" />
              <Kpi label="Bank Collection" value={inr(d.bankCollection, 0)} icon={Landmark} tone="violet" />
              <Kpi label="Payable" value={inr(d.payable, 0)} icon={TrendingDown} tone="amber" onClick={() => go(ar('payable'))} />
              <Kpi label="Purchase Bills" value={d.purchaseBillsCount} icon={Receipt} tone="teal" onClick={() => go(av('purchase-bill'))} />
            </div>
          </>
        )}
      </BooksGate>
    </>
  );
}
