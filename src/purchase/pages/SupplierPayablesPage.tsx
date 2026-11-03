import { useEffect, useMemo, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import { Conf, canSee } from '../../auth/access';
import { Empty, PageHeader, Search } from '../../components/ui';
import { fmtNum, matches } from '../../components/format';
import { fetchSupplierPayables } from '../services/invoiceService';
import type { SupplierPayable } from '../types';
import { DocButtons } from '../../export/docOutput';
import * as docs from '../../export/documents';

const inr = (v: number) => (v ? '₹ ' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '—');

/** What is owed to each supplier on posted invoices, aged by invoice date (0–30 / 31–60 / 61–90 / 90+ days old). */
export function SupplierPayablesPage({ navigate }: { navigate: (r: string) => void }) {
  const [rows, setRows] = useState<SupplierPayable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const showParty = canSee('party_names');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchSupplierPayables());
      setError(null);
    } catch {
      setRows([]);
      setError('Supplier payables could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => rows.filter((r) => matches(q, showParty ? r.supplierName : '', r.supplierCode)), [rows, q, showParty]);
  const sum = (k: keyof SupplierPayable) => shown.reduce((a, r) => a + (r[k] as number), 0);

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Supplier Payables"
        actions={
          <>
            <button className="btn btn-subtle" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <DocButtons build={(u) => docs.payablesSpec(shown, u)} />
            <button className="btn btn-subtle" onClick={() => navigate('purchase-reports?r=payables-ageing')}>
              Open as report
            </button>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search supplier…" />
          </div>
          <div className="right text-xs muted">{shown.length} suppliers</div>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading payables…</div>
        ) : error ? (
          <Empty title="Not available" text={error} action={<button className="btn" onClick={load}>Try again</button>} />
        ) : shown.length === 0 ? (
          <Empty title="Nothing is owed" text={rows.length === 0 ? 'Payables appear once a purchase invoice is posted.' : 'No supplier matches your search.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="r">Open invoices</th>
                  <Conf g="purchase_rates">
                    <th className="r">Outstanding</th>
                    <th className="r">Overdue</th>
                    <th className="r">0–30 days</th>
                    <th className="r">31–60 days</th>
                    <th className="r">61–90 days</th>
                    <th className="r">90+ days</th>
                  </Conf>
                  <th className="act">Invoices</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.supplierId}>
                    <td className="strong">
                      {showParty ? r.supplierName : '—'}
                      <div className="text-xs muted">{r.supplierCode}</div>
                    </td>
                    <td className="r num">{fmtNum(r.openInvoices)}</td>
                    <Conf g="purchase_rates">
                      <td className="r num strong nowrap">{inr(r.outstanding)}</td>
                      <td className={`r num nowrap ${r.overdueAmount > 0 ? 'text-red strong' : ''}`}>{inr(r.overdueAmount)}</td>
                      <td className="r num nowrap">{inr(r.b0to30)}</td>
                      <td className="r num nowrap">{inr(r.b31to60)}</td>
                      <td className="r num nowrap">{inr(r.b61to90)}</td>
                      <td className={`r num nowrap ${r.b90plus > 0 ? 'text-amber strong' : ''}`}>{inr(r.b90plus)}</td>
                    </Conf>
                    <td className="act">
                      <div className="icon-actions">
                        <button className="icon-btn" title="Open invoices of this supplier" aria-label={`Open invoices of ${r.supplierName}`} onClick={() => navigate(`purchase-invoices?supplier=${r.supplierId}&open=1`)}>
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <Conf g="purchase_rates">
                  <tr className="total-row">
                    <td className="strong">Total</td>
                    <td className="r num strong">{fmtNum(sum('openInvoices'))}</td>
                    <td className="r num strong nowrap">{inr(sum('outstanding'))}</td>
                    <td className="r num strong nowrap">{inr(sum('overdueAmount'))}</td>
                    <td className="r num strong nowrap">{inr(sum('b0to30'))}</td>
                    <td className="r num strong nowrap">{inr(sum('b31to60'))}</td>
                    <td className="r num strong nowrap">{inr(sum('b61to90'))}</td>
                    <td className="r num strong nowrap">{inr(sum('b90plus'))}</td>
                    <td />
                  </tr>
                </Conf>
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="text-xs muted" style={{ marginTop: 12 }}>
        Ageing counts the days since the invoice date. “Overdue” is what is past its due date.
      </div>
    </>
  );
}
