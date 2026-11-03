import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, RefreshCw } from 'lucide-react';
import { Conf, Write, canSee } from '../../auth/access';
import { Empty, Field, FilterMenu, PageHeader, Search } from '../../components/ui';
import { fmtDate, matches } from '../../components/format';
import { PaymentModal } from '../components/PaymentModal';
import { fetchInvoices, fetchPayments } from '../services/invoiceService';
import type { PurchaseInvoice, PurchasePayment } from '../types';
import { DocButtons } from '../../export/docOutput';
import * as docs from '../../export/documents';

const inr = (v: number) => '₹ ' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export function PurchasePaymentsPage({ navigate }: { navigate: (r: string) => void }) {
  const [rows, setRows] = useState<PurchasePayment[]>([]);
  const [open, setOpen] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paying, setPaying] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchPayments());
      setError(null);
    } catch {
      setRows([]);
      setError('Payments could not be loaded right now.');
    } finally {
      setLoading(false);
    }
    // posted invoices that still have a balance, for "Record payment"; stays empty if it cannot be read
    fetchInvoices()
      .then((all) => setOpen(all.filter((i) => i.status === 'Posted' && i.balance > 0.004)))
      .catch(() => setOpen([]));
  };
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(
    () =>
      rows
        .filter((r) => !mode || r.mode === mode)
        .filter((r) => !from || r.payDate >= from)
        .filter((r) => !to || r.payDate <= to)
        .filter((r) => matches(q, r.payNo, r.pinvNo, canSee('invoices') ? r.supplierInvNo : '', canSee('party_names') ? r.supplierName : '', r.poNo, r.reference, r.mode)),
    [rows, mode, from, to, q],
  );
  const total = shown.reduce((a, r) => a + r.amount, 0);

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Purchase Payments"
        actions={
          <>
            <button className="btn btn-subtle" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="purchase_payments">
              <button className="btn btn-primary" onClick={() => setPaying(true)} disabled={open.length === 0} title={open.length === 0 ? 'There is no posted invoice with a balance due' : undefined}>
                <Plus size={15} /> Record Payment
              </button>
            </Write>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search payment, invoice, supplier, reference…" />
            <FilterMenu groups={[{ label: 'Mode', value: mode, onChange: setMode, options: [{ value: '', label: 'All modes' }, ...['Bank Transfer', 'Cheque', 'UPI', 'Cash'].map((m) => ({ value: m, label: m }))] }]} />
          </div>
          <div className="right text-xs muted">
            {shown.length} of {rows.length} payments
          </div>
        </div>
        <div className="rp-dates" style={{ padding: '0 22px 14px', marginTop: 0 }}>
          <Field label="Payment date from">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="to">
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading payments…</div>
        ) : error ? (
          <Empty title="Not available" text={error} action={<button className="btn" onClick={load}>Try again</button>} />
        ) : shown.length === 0 ? (
          <Empty title="No payments" text={rows.length === 0 ? 'Payments are recorded against posted purchase invoices.' : 'No payment matches the filters.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th>Date</th>
                  <th>Invoice</th>
                  <Conf g="party_names">
                    <th>Supplier</th>
                  </Conf>
                  <th>PO</th>
                  <th>Mode</th>
                  <th>Reference</th>
                  <Conf g="purchase_rates">
                    <th className="r">Amount</th>
                  </Conf>
                  <th className="act">View</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.paymentId}>
                    <td className="strong nowrap">{r.payNo}</td>
                    <td className="nowrap">{fmtDate(r.payDate)}</td>
                    <td className="nowrap">{r.pinvNo}</td>
                    <Conf g="party_names">
                      <td>{r.supplierName}</td>
                    </Conf>
                    <td className="nowrap">{r.poNo ?? '—'}</td>
                    <td>{r.mode}</td>
                    <td>{r.reference ?? '—'}</td>
                    <Conf g="purchase_rates">
                      <td className="r num strong nowrap">{inr(r.amount)}</td>
                    </Conf>
                    <td className="act">
                      <div className="icon-actions">
                        <DocButtons compact build={(u) => docs.paymentVoucherSpec(r, u)} />
                        <button className="icon-btn" title="View invoice" aria-label={`View invoice ${r.pinvNo}`} onClick={() => navigate(`purchase-invoices?id=${r.invoiceId}`)}>
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                <Conf g="purchase_rates">
                  <tr className="total-row">
                    <td colSpan={canSee('party_names') ? 7 : 6} className="strong">
                      Total
                    </td>
                    <td className="r num strong nowrap">{inr(total)}</td>
                    <td />
                  </tr>
                </Conf>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paying && (
        <PaymentModal
          choices={open}
          onClose={() => setPaying(false)}
          onSaved={() => {
            setPaying(false);
            void load();
          }}
        />
      )}
    </>
  );
}
