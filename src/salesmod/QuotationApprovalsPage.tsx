import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Eye, Printer, RefreshCw, Save } from 'lucide-react';
import { Write, useAccess } from '../auth/access';
import { Badge, Empty, PageHeader, Search, Tabs } from '../components/ui';
import { fmtDate, matches } from '../components/format';
import { useStore } from '../store/StoreContext';
import { useQuotations } from './hooks';
import { inr, pct } from './calc';
import { MarginFlag, QuotationDetail, printFromList, type QStep } from './QuotationPage';
import { fetchMinMargin, setMinMargin } from './service';
import { useTabAccess } from '../auth/tabs';

type Tab = 'pending' | 'decided';

export function QuotationApprovalsPage({ query, navigate }: { query?: URLSearchParams; navigate: (r: string) => void }) {
  const { quotations, loading, error, reload } = useQuotations();
  const { can, canWrite } = useAccess();
  const { toast } = useStore();
  const [tab0, setTab] = useState<Tab>('pending');
  const ta = useTabAccess('quotation_approvals', ['pending', 'decided'] as const);
  const tab = ta.pick(tab0);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<number | null>(Number(query?.get('id')) || null);
  const [step, setStep] = useState<QStep>(query?.get('step') === 'approve' ? 'approve' : null);
  const [minDraft, setMinDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [minMargin, setMinMarginValue] = useState<number | null>(null);

  const loadMin = () => fetchMinMargin().then((v) => { setMinMarginValue(v); setMinDraft(String(v)); }).catch(() => undefined);
  useEffect(() => {
    void loadMin();
  }, []);

  const pending = useMemo(() => quotations.filter((x) => x.status === 'Pending Approval'), [quotations]);
  const decided = useMemo(() => quotations.filter((x) => x.approvedAt || ['Rejected', 'Revision Required'].includes(x.status)).filter((x) => x.status !== 'Pending Approval'), [quotations]);
  const shown = (tab === 'pending' ? pending : decided).filter((x) => matches(q, x.docNo, x.customer, x.products, x.salesperson, x.status));
  const showMargin = can('margins');
  const showMoney = can('sales_rates');
  const showCustomer = can('party_names');

  if (selected) {
    return (
      <QuotationDetail
        id={selected}
        initialStep={step}
        navigate={navigate}
        onBack={() => {
          setSelected(null);
          setStep(null);
          void reload();
        }}
      />
    );
  }

  const saveMin = async () => {
    setSaving(true);
    try {
      await setMinMargin(Number(minDraft));
      toast({ kind: 'success', title: 'Minimum margin saved', message: `Quotations under ${minDraft}% are now flagged.` });
      await Promise.all([reload(), loadMin()]);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales & Orders"
        title="Quotation Approvals"
        actions={<button className="btn btn-subtle" onClick={() => reload()} disabled={loading}><RefreshCw size={14} /> Refresh</button>}
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16 }}>
          <div>
            <div className="strong">Minimum gross margin</div>
            <div className="text-xs muted">A quotation below this margin is flagged red and needs a note to approve.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
            <input type="number" min="0" max="99.99" step="any" style={{ width: 90 }} value={minDraft} onChange={(e) => setMinDraft(e.target.value)} aria-label="Minimum margin %" disabled={!canWrite('quotation_approvals')} />
            <span className="muted">%</span>
            <Write res="quotation_approvals">
              <button className="btn btn-primary" onClick={saveMin} disabled={saving || minDraft === '' || Number(minDraft) === minMargin}><Save size={14} /> Save</button>
            </Write>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Tabs value={tab} onChange={setTab} items={ta.only([{ value: 'pending', label: 'Waiting for approval', count: pending.length, tone: 'amber' }, { value: 'decided', label: 'Decided', count: decided.length }])} />
            <Search value={q} onChange={setQ} placeholder="Search quotation, customer, salesperson…" />
          </div>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty title={tab === 'pending' ? 'Nothing is waiting for approval' : 'No decided quotations yet'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Quotation</th><th>Date</th>{showCustomer && <th>Customer</th>}<th>Products</th>
                  {showMoney && <th className="right">Value</th>}
                  {showMargin && <><th className="right">Cost</th><th className="right">Margin</th></>}
                  <th>Salesperson</th><th className="center">Status</th><th className="act">Open</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="strong"><button className="link-btn" style={{ fontWeight: 600 }} onClick={() => setSelected(r.id)}>{r.docNo}</button></td>
                    <td className="muted nowrap">{fmtDate(r.qtDate)}</td>
                    {showCustomer && <td className="strong">{r.customer || '—'}</td>}
                    <td>{r.products || '—'}</td>
                    {showMoney && <td className="right mono nowrap">{inr(r.amount)}</td>}
                    {showMargin && (
                      <>
                        <td className="right mono nowrap">{inr(r.costTotal)}</td>
                        <td className="right mono nowrap"><MarginFlag q={r} /></td>
                      </>
                    )}
                    <td>{r.salesperson || '—'}</td>
                    <td className="center"><Badge status={r.displayStatus} /></td>
                    <td className="act"><div className="icon-actions"><button className="icon-btn" title="View" aria-label={`Review ${r.docNo}`} onClick={() => setSelected(r.id)}><Eye size={16} /></button>{['Approved', 'Sent', 'Won', 'Lost'].includes(r.status) && <button className="icon-btn" title="Print quotation" aria-label={`Print ${r.docNo}`} onClick={() => void printFromList(r, toast)}><Printer size={16} /></button>}{r.status === 'Won' && !r.orderNo && canWrite('sales_orders') && <button className="icon-btn" title="Create sales order" aria-label={`Create sales order ${r.docNo}`} onClick={() => { setStep('order'); setSelected(r.id); }}><ClipboardCheck size={16} /></button>}{r.status === 'Pending Approval' && canWrite('quotation_approvals') && <button className="icon-btn" title="Review and decide" aria-label={`Decide ${r.docNo}`} onClick={() => { setStep('approve'); setSelected(r.id); }}><ClipboardCheck size={16} /></button>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showMargin && minMargin != null && <div className="text-xs muted" style={{ padding: '10px 16px' }}>Minimum margin is {pct(minMargin)}.</div>}
      </div>
    </>
  );
}
