import { useEffect, useMemo, useState } from 'react';
import { withDocNo } from '../../db/client';
import { DocNoField, useDocNo } from '../../components/DocNoField';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle, ClipboardCheck, Eye, FileCheck, Pencil, Plus, RefreshCw, Wallet } from 'lucide-react';
import { Conf, Write, canSee, useAccess } from '../../auth/access';
import { Badge, Empty, Field, FilterMenu, Modal, PageFormCtx, PageHeader, Search, Tabs } from '../../components/ui';
import { fmtDate, fmtNum, matches, todayISO } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { PaymentModal } from '../components/PaymentModal';
import { cancelInvoice, fetchInvoiceDetail, fetchInvoiceablePOs, fetchInvoices, fetchPOInvoiceLines, postInvoice, saveInvoice } from '../services/invoiceService';
import { INVOICE_RATE_TOLERANCE_PCT, type InvoiceDetail, type InvoiceablePO, type POInvoiceLine, type PurchaseInvoice } from '../types';
import { useTabAccess } from '../../auth/tabs';
import { DocButtons } from '../../export/docOutput';
import * as docs from '../../export/documents';
import { usePaged } from '../../components/Pager';

const inr = (v: number) => '₹ ' + v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
const round2 = (v: number) => Math.round(v * 100) / 100;

export function PurchaseInvoicePage({ query, navigate }: { query?: URLSearchParams; navigate: (r: string) => void }) {
  const id = Number(query?.get('id')) || null;
  const editId = Number(query?.get('edit')) || null;
  const isNew = query?.get('new') === '1';
  if (isNew || editId) return <InvoiceForm editId={editId} initialPoId={Number(query?.get('po_id')) || null} navigate={navigate} />;
  if (id) return <InvoiceDetailView id={id} navigate={navigate} autoPay={query?.get('step') === 'pay'} />;
  return <InvoiceList navigate={navigate} supplierParam={Number(query?.get('supplier')) || null} openOnly={query?.get('open') === '1'} />;
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------
function InvoiceList({ navigate, supplierParam, openOnly }: { navigate: (r: string) => void; supplierParam: number | null; openOnly: boolean }) {
  const [rows, setRows] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState(openOnly ? 'open' : '');
  const [overdue, setOverdue] = useState('');
  const [supplier, setSupplier] = useState(supplierParam ? String(supplierParam) : '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchInvoices());
      setError(null);
    } catch {
      setRows([]);
      setError('Purchase invoices could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const suppliers = useMemo(() => [...new Map(rows.map((r) => [r.supplierId, r.supplierName])).entries()], [rows]);
  const shown = useMemo(
    () =>
      rows
        .filter((r) => !status || r.status === status)
        .filter((r) => !pay || (pay === 'open' ? r.status === 'Posted' && r.balance > 0.004 : r.payStatus === pay))
        .filter((r) => !overdue || r.isOverdue === (overdue === 'yes'))
        .filter((r) => !supplier || String(r.supplierId) === supplier)
        .filter((r) => !from || r.invDate >= from)
        .filter((r) => !to || r.invDate <= to)
        .filter((r) => matches(q, r.pinvNo, canSee('invoices') ? r.supplierInvNo : '', canSee('party_names') ? r.supplierName : '', r.poNo, r.status, r.payStatus)),
    [rows, status, pay, overdue, supplier, from, to, q],
  );
  const pg = usePaged(shown, shown.length);

  const groups = [
    { label: 'Status', value: status, onChange: setStatus, options: [{ value: '', label: 'All statuses' }, ...['Draft', 'Posted', 'Cancelled'].map((v) => ({ value: v, label: v }))] },
    { label: 'Payment', value: pay, onChange: setPay, options: [{ value: '', label: 'All' }, { value: 'open', label: 'Open (balance due)' }, ...['Unpaid', 'Partially Paid', 'Paid'].map((v) => ({ value: v, label: v }))] },
    { label: 'Overdue', value: overdue, onChange: setOverdue, options: [{ value: '', label: 'All' }, { value: 'yes', label: 'Overdue' }, { value: 'no', label: 'Not overdue' }] },
    ...(canSee('party_names') ? [{ label: 'Supplier', value: supplier, onChange: setSupplier, options: [{ value: '', label: 'All suppliers' }, ...suppliers.map(([sid, name]) => ({ value: String(sid), label: name }))] }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Purchase Invoices"
        actions={
          <>
            <button className="btn btn-subtle" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="purchase_invoices">
              <button className="btn btn-primary" onClick={() => navigate('purchase-invoices?new=1')}>
                <Plus size={15} /> New Invoice
              </button>
            </Write>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search invoice no, supplier, PO…" />
            <FilterMenu groups={groups} />
          </div>
          <div className="right text-xs muted">
            {shown.length} of {rows.length} invoices
          </div>
        </div>
        <div className="rp-dates" style={{ padding: '0 22px 14px', marginTop: 0 }}>
          <Field label="Invoice date from">
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="to">
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading purchase invoices…</div>
        ) : error ? (
          <Empty title="Not available" text={error} action={<button className="btn" onClick={load}>Try again</button>} />
        ) : shown.length === 0 ? (
          <Empty title="No purchase invoices" text={rows.length === 0 ? 'Enter a supplier invoice against a released purchase order.' : 'No invoice matches the filters.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <Conf g="invoices">
                    <th>Supplier Inv. No.</th>
                  </Conf>
                  <th>Date</th>
                  <Conf g="party_names">
                    <th>Supplier</th>
                  </Conf>
                  <th>PO</th>
                  <Conf g="purchase_rates">
                    <th className="r">Total</th>
                    <th className="r">Paid</th>
                    <th className="r">Balance</th>
                  </Conf>
                  <th>Due</th>
                  <th>Status</th>
                  <th className="act">View</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r) => (
                  <tr key={r.invoiceId}>
                    <td className="strong nowrap">{r.pinvNo}</td>
                    <Conf g="invoices">
                      <td className="nowrap">{r.supplierInvNo}</td>
                    </Conf>
                    <td className="nowrap">{fmtDate(r.invDate)}</td>
                    <Conf g="party_names">
                      <td>{r.supplierName}</td>
                    </Conf>
                    <td className="nowrap">{r.poNo ?? '—'}</td>
                    <Conf g="purchase_rates">
                      <td className="r num nowrap">{inr(r.totalAmount)}</td>
                      <td className="r num nowrap">{inr(r.paidAmount)}</td>
                      <td className="r num nowrap strong">{r.status === 'Posted' ? inr(r.balance) : '—'}</td>
                    </Conf>
                    <td className="nowrap">
                      {r.dueDate ? fmtDate(r.dueDate) : '—'}
                      {r.isOverdue && <span className="badge b-red text-xs ml-1">{r.daysOverdue}d late</span>}
                    </td>
                    <td>
                      <Badge status={r.status} />
                      {r.status === 'Posted' && (
                        <div style={{ marginTop: 4 }}>
                          <Badge status={r.payStatus} />
                        </div>
                      )}
                    </td>
                    <td className="act">
                      <div className="icon-actions">
                        <button className="icon-btn" title="View" aria-label={`View ${r.pinvNo}`} onClick={() => navigate(`purchase-invoices?id=${r.invoiceId}`)}>
                          <Eye size={16} />
                        </button>
                        {r.status === 'Draft' && (
                          <Write res="purchase_invoices">
                            <button className="icon-btn" title="Edit draft invoice" aria-label={`Edit ${r.pinvNo}`} onClick={() => navigate(`purchase-invoices?edit=${r.invoiceId}`)}>
                              <Pencil size={16} />
                            </button>
                          </Write>
                        )}
                        {r.status === 'Posted' && r.balance > 0.004 && (
                          <Write res="purchase_payments">
                            <button className="icon-btn" title="Record payment" aria-label={`Pay ${r.pinvNo}`} onClick={() => navigate(`purchase-invoices?id=${r.invoiceId}&step=pay`)}><ClipboardCheck size={16} /></button>
                          </Write>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {pg.pager}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------
function InvoiceDetailView({ id, navigate, autoPay = false }: { id: number; navigate: (r: string) => void; autoPay?: boolean }) {
  const { user, canWrite } = useAccess();
  const { toast } = useStore();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab0, setTab] = useState<'lines' | 'payments'>('lines');
  const ta = useTabAccess('purchase_invoices', ['lines', 'payments'] as const);
  const tab = ta.pick(tab0);
  const [payOpen, setPayOpen] = useState(autoPay);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  const showRates = canSee('purchase_rates');

  const load = async () => {
    try {
      setLoading(true);
      setInv(await fetchInvoiceDetail(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The invoice could not be loaded.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const who = user?.name || user?.email || 'User';
  const act = async (fn: () => Promise<unknown>, ok: { title: string; message?: string }) => {
    try {
      setActing(true);
      await fn();
      toast({ kind: 'success', ...ok });
      await load();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not complete the action', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setActing(false);
    }
  };

  if (loading && !inv) return <div className="card"><Empty title="Loading invoice…" /></div>;
  if (error || !inv) return <div className="card"><Empty title="Invoice not available" text={error ?? undefined} action={<button className="btn" onClick={() => navigate('purchase-invoices')}>Back to invoices</button>} /></div>;

  const canInvoice = canWrite('purchase_invoices');
  const canPay = canWrite('purchase_payments');
  const byItem = new Map<number, POInvoiceLine>(inv.match.map((m) => [m.poItemId, m]));
  const half = inv.gstAmount / 2;

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title={inv.pinvNo}
        subtitle={
          <div className="flex-center gap-2 mt-1">
            <Badge status={inv.status} />
            {inv.status === 'Posted' && <Badge status={inv.payStatus} />}
            {inv.isOverdue && <span className="badge b-red">{inv.daysOverdue} days overdue</span>}
          </div>
        }
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => navigate('purchase-invoices')}>
              <ArrowLeft size={15} /> Back
            </button>
            <DocButtons build={(u) => docs.purchaseInvoiceSpec(inv, u)} />
            {inv.status === 'Draft' && canInvoice && (
              <>
                <button className="btn btn-subtle" onClick={() => navigate(`purchase-invoices?edit=${inv.invoiceId}`)}>
                  <Pencil size={15} /> Edit
                </button>
                <button className="btn btn-primary" disabled={acting} onClick={() => act(() => postInvoice(inv.invoiceId, who), { title: 'Invoice posted', message: `${inv.pinvNo} is now locked and counts toward payables.` })}>
                  <FileCheck size={15} /> Post Invoice
                </button>
              </>
            )}
            {inv.status === 'Posted' && inv.balance > 0.004 && canPay && (
              <button className="btn btn-primary" onClick={() => setPayOpen(true)}>
                <Wallet size={15} /> Record Payment
              </button>
            )}
            {inv.status !== 'Cancelled' && canInvoice && (
              <button className="btn btn-danger" onClick={() => setCancelOpen(true)} disabled={acting || inv.payments.length > 0} title={inv.payments.length > 0 ? 'Payments are recorded against this invoice' : undefined}>
                <Ban size={15} /> Cancel
              </button>
            )}
          </>
        }
      />

      <div className="card po-summary">
        <div>
          <div className="po-k">Supplier &amp; PO</div>
          <Conf g="party_names">
            <div className="po-v">{inv.supplierName}</div>
          </Conf>
          <div className="po-s">
            PO:{' '}
            {inv.poId ? (
              <button className="link-btn" onClick={() => navigate(`purchase-orders?id=${inv.poId}`)}>
                {inv.poNo}
              </button>
            ) : (
              '—'
            )}
          </div>
          <Conf g="invoices">
            <div className="po-s">
              Supplier invoice no.: <b>{inv.supplierInvNo}</b>
            </div>
          </Conf>
        </div>
        <div>
          <div className="po-k">Dates</div>
          <div className="po-s">
            Invoice date: <b>{fmtDate(inv.invDate)}</b>
          </div>
          <div className="po-s">
            Due date: <b>{inv.dueDate ? fmtDate(inv.dueDate) : '—'}</b>
          </div>
          {inv.postedAt && (
            <div className="po-s">
              Posted: <b>{fmtDate(inv.postedAt)}</b> by {inv.postedBy}
            </div>
          )}
        </div>
        <div>
          <div className="po-k">Amount</div>
          <div className="po-v po-total">{showRates ? inr(inv.totalAmount) : '—'}</div>
          <div className="po-s">
            Taxable {showRates ? inr(inv.taxableAmount) : '—'} · {inv.taxType === 'inter' ? `IGST ${showRates ? inr(inv.gstAmount) : '—'}` : `CGST ${showRates ? inr(half) : '—'} + SGST ${showRates ? inr(half) : '—'}`}
          </div>
          {showRates && inv.status === 'Posted' && (
            <div className="po-s">
              Paid <b>{inr(inv.paidAmount)}</b> · Balance <b>{inr(inv.balance)}</b>
            </div>
          )}
        </div>
      </div>

      {inv.varianceNote && (
        <div className="callout warn" style={{ marginTop: 0, marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <div>
            <b>Rate variance note:</b> {inv.varianceNote}
          </div>
        </div>
      )}
      {inv.status === 'Cancelled' && inv.cancelReason && (
        <div className="callout err" style={{ marginTop: 0, marginBottom: 16 }}>
          <Ban size={16} />
          <div>
            <b>Cancelled:</b> {inv.cancelReason}
          </div>
        </div>
      )}

      <div className="card">
        <Tabs
          value={tab}
          onChange={(t) => setTab(t as typeof tab)}
          items={ta.only([
            { value: 'lines', label: 'Lines & Three-way Match', count: inv.items.length },
            { value: 'payments', label: 'Payments', count: inv.payments.length },
          ])}
        />
        <div style={{ marginTop: 14 }}>
          {tab === 'lines' && (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }} className="center">#</th>
                    <th>Item</th>
                    <th className="r">Ordered</th>
                    <th className="r">Received</th>
                    <th className="r">Accepted</th>
                    <th className="r">Invoiced (posted)</th>
                    <th className="r">This invoice</th>
                    <Conf g="purchase_rates">
                      <th className="r">PO rate</th>
                      <th className="r">Invoice rate</th>
                      <th className="r">Amount</th>
                    </Conf>
                  </tr>
                </thead>
                <tbody>
                  {inv.items.map((l) => {
                    const m = byItem.get(l.poItemId);
                    const off = m && m.poRate > 0 ? Math.abs(l.rate - m.poRate) / m.poRate * 100 > INVOICE_RATE_TOLERANCE_PCT : false;
                    return (
                      <tr key={l.id}>
                        <td className="center">{l.lineNo}</td>
                        <td>
                          <div className="strong">{l.item}</div>
                          <div className="text-xs muted">
                            {m?.uom ?? 'KG'} · GST {l.gstPct}%
                          </div>
                        </td>
                        <td className="r num">{m ? fmtNum(m.ordered) : '—'}</td>
                        <td className="r num">{m ? fmtNum(m.received) : '—'}</td>
                        <td className="r num">{m ? (m.qcRecorded ? fmtNum(m.accepted) : 'QC pending') : '—'}</td>
                        <td className="r num">{m ? fmtNum(m.invoiced) : '—'}</td>
                        <td className="r num strong">{fmtNum(l.qty)}</td>
                        <Conf g="purchase_rates">
                          <td className="r num">{m ? inr(m.poRate) : '—'}</td>
                          <td className={`r num ${off ? 'text-amber strong' : ''}`}>{inr(l.rate)}</td>
                          <td className="r num strong">{inr(l.amount)}</td>
                        </Conf>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-xs muted" style={{ padding: '8px 12px' }}>
                An invoice can bill at most the accepted quantity (the received quantity while QC is pending; the ordered quantity for lines not counted in KG).
              </div>
            </div>
          )}
          {tab === 'payments' &&
            (inv.payments.length === 0 ? (
              <Empty title="No payments yet" text={inv.status === 'Posted' ? 'Use Record Payment above.' : 'Payments can be recorded once the invoice is posted.'} />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Payment</th>
                      <th>Date</th>
                      <th>Mode</th>
                      <th>Reference</th>
                      <th className="r">Amount</th>
                      <th>Recorded by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.payments.map((p) => (
                      <tr key={p.paymentId}>
                        <td className="strong nowrap">{p.payNo}</td>
                        <td className="nowrap">{fmtDate(p.payDate)}</td>
                        <td>{p.mode}</td>
                        <td>{p.reference ?? '—'}</td>
                        <td className="r num strong">{inr(p.amount)}</td>
                        <td>{p.createdBy ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </div>
      </div>

      {payOpen && (
        <PaymentModal
          invoice={inv}
          onClose={() => setPayOpen(false)}
          onSaved={() => {
            setPayOpen(false);
            void load();
          }}
        />
      )}
      <PageFormCtx.Provider value={null}>
        <Modal
          dialog
          open={cancelOpen}
          title="Cancel Invoice"
          onClose={() => setCancelOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCancelOpen(false)} disabled={acting}>
                Keep Invoice
              </button>
              <button
                className="btn btn-danger"
                disabled={acting || !reason.trim()}
                onClick={async () => {
                  await act(() => cancelInvoice(inv.invoiceId, reason.trim(), who), { title: 'Invoice cancelled', message: inv.status === 'Posted' ? 'The invoiced quantity is available again.' : undefined });
                  setCancelOpen(false);
                  setReason('');
                }}
              >
                Confirm Cancellation
              </button>
            </>
          }
        >
          <p className="text-sm muted" style={{ marginTop: 0 }}>
            A posted invoice cannot be edited. Cancel it, then enter it again with the right values. This is not possible once a payment is recorded.
          </p>
          <Field label="Reason" required>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      </PageFormCtx.Provider>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Entry form (a full page)
// ---------------------------------------------------------------------------------------------
interface FormLine extends POInvoiceLine {
  include: boolean;
  qty: string;
  rate: string;
  gst: number;
}

function InvoiceForm({ editId, initialPoId, navigate }: { editId: number | null; initialPoId: number | null; navigate: (r: string) => void }) {
  const { user } = useAccess();
  const { toast } = useStore();
  const [pos, setPos] = useState<InvoiceablePO[]>([]);
  const [poId, setPoId] = useState<number | ''>(initialPoId ?? '');
  const [lines, setLines] = useState<FormLine[]>([]);
  const [invNo, setInvNo] = useState('');
  const [invDate, setInvDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const doc = useDocNo('pinv', !editId);
  const [error, setError] = useState<string | null>(null);

  const po = pos.find((p) => p.id === poId);
  const toForm = (m: POInvoiceLine[], draft?: InvoiceDetail): FormLine[] =>
    m.map((l) => {
      const mine = draft?.items.find((i) => i.poItemId === l.poItemId);
      return mine
        ? { ...l, include: true, qty: String(mine.qty), rate: String(mine.rate), gst: mine.gstPct }
        : { ...l, include: !draft && l.billable > 0, qty: !draft && l.billable > 0 ? String(l.billable) : '', rate: String(l.poRate), gst: l.gstPct };
    });

  // first load: the POs that can be invoiced; and the draft when editing
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await fetchInvoiceablePOs();
        if (!alive) return;
        setPos(list);
        if (editId) {
          const d = await fetchInvoiceDetail(editId);
          if (!alive) return;
          if (d.status !== 'Draft') throw new Error(`${d.pinvNo} is ${d.status} and can no longer be edited.`);
          setPoId(d.poId ?? '');
          setInvNo(d.supplierInvNo);
          setInvDate(d.invDate);
          setDueDate(d.dueDate ?? '');
          setNote(d.varianceNote ?? '');
          setLines(toForm(d.match, d));
        } else if (initialPoId) {
          setLines(toForm(await fetchPOInvoiceLines(initialPoId)));
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'The form could not be loaded.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickPo = async (id: number | '') => {
    setPoId(id);
    setLines([]);
    if (!id) return;
    try {
      setLines(toForm(await fetchPOInvoiceLines(id)));
    } catch (e) {
      toast({ kind: 'error', title: 'Could not load the PO lines', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const upd = (i: number, patch: Partial<FormLine>) => setLines((cur) => cur.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const used = lines.filter((l) => l.include);
  const lineErr = (l: FormLine): string | null => {
    const q = Number(l.qty);
    if (!(q > 0)) return 'Enter a quantity';
    if (q > l.billable + 0.0005 && l.billable >= 0) return `Only ${fmtNum(l.billable)} ${l.uom} can be invoiced`;
    if (!(Number(l.rate) >= 0) || l.rate === '') return 'Enter a rate';
    return null;
  };
  const rateOff = (l: FormLine) => l.poRate > 0 ? Math.abs(Number(l.rate) - l.poRate) / l.poRate * 100 > INVOICE_RATE_TOLERANCE_PCT : Number(l.rate) > 0;
  const needsNote = used.some(rateOff);
  const taxable = used.reduce((a, l) => a + round2(Number(l.qty) * Number(l.rate)), 0);
  const gst = used.reduce((a, l) => a + round2(Number(l.qty) * Number(l.rate) * (l.gst / 100)), 0);
  const valid = !!poId && invNo.trim() !== '' && used.length > 0 && used.every((l) => !lineErr(l)) && (!needsNote || note.trim() !== '');

  const submit = async (post: boolean) => {
    if (!poId) return;
    try {
      setSaving(true);
      const who = user?.name || user?.email || 'User';
      const newId = await withDocNo(editId ? undefined : doc.custom, () =>
        saveInvoice(
          editId,
          { po_id: Number(poId), supplier_inv_no: invNo.trim(), inv_date: invDate, due_date: dueDate || null, variance_note: note.trim() || null },
          used.map((l) => ({ po_item_id: l.poItemId, qty: Number(l.qty), rate: Number(l.rate), gst_pct: l.gst })),
          who,
        ),
      );
      if (post) {
        try {
          await postInvoice(newId, who);
          toast({ kind: 'success', title: 'Invoice saved and posted', message: 'It now counts toward payables.' });
        } catch (e) {
          toast({ kind: 'error', title: 'Saved as a draft, but not posted', message: e instanceof Error ? e.message : String(e) });
        }
      } else {
        toast({ kind: 'success', title: 'Draft saved' });
      }
      navigate(`purchase-invoices?id=${newId}`);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the invoice', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageFormCtx.Provider value={{ eyebrow: 'Purchase & Procurement' }}>
      <Modal
        open
        onClose={() => navigate(editId ? `purchase-invoices?id=${editId}` : 'purchase-invoices')}
        title={editId ? 'Edit Draft Invoice' : 'New Purchase Invoice'}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => navigate(editId ? `purchase-invoices?id=${editId}` : 'purchase-invoices')} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-subtle" onClick={() => submit(false)} disabled={!valid || saving}>
              Save as Draft
            </button>
            <button className="btn btn-primary" onClick={() => submit(true)} disabled={!valid || saving}>
              <CheckCircle size={15} /> Save &amp; Post
            </button>
          </>
        }
      >
        {loading ? (
          <div className="card-center-msg">Loading…</div>
        ) : error ? (
          <Empty title="Not available" text={error} />
        ) : (
          <>
            <div className="form-grid three">
              {!editId && <DocNoField label="Invoice No. (internal)" no={doc.no} setNo={doc.setNo} />}
              <Field label="Purchase Order" required hint="Released orders only">
                <select value={poId} disabled={!!editId} onChange={(e) => void pickPo(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select a purchase order…</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.poNo}
                      {canSee('party_names') ? ` · ${p.supplierName}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier's Invoice No." required>
                <input value={invNo} onChange={(e) => setInvNo(e.target.value)} />
              </Field>
              <Field label="Invoice Date" required>
                <input type="date" max={todayISO()} value={invDate} onChange={(e) => setInvDate(e.target.value)} />
              </Field>
              <Field label="Due Date" hint={po?.paymentTerms ? `Left empty, it is worked out from "${po.paymentTerms}"` : 'Optional'}>
                <input type="date" min={invDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>

            <div className="section-label">Lines (from the purchase order)</div>
            {lines.length === 0 ? (
              <div className="muted">{poId ? 'This purchase order has no lines.' : 'Choose a purchase order to see its lines.'}</div>
            ) : (
              <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                <table className="tbl form-tbl" style={{ minWidth: 1250 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 46 }} className="center">Bill</th>
                      <th style={{ minWidth: 200 }}>Item</th>
                      <th style={{ width: 90 }} className="r">Ordered</th>
                      <th style={{ width: 90 }} className="r">Received</th>
                      <th style={{ width: 100 }} className="r">Accepted</th>
                      <th style={{ width: 90 }} className="r">Invoiced</th>
                      <th style={{ width: 100 }} className="r">Can bill</th>
                      <th style={{ width: 120 }} className="r">Qty *</th>
                      <th style={{ width: 120 }} className="r">Rate *</th>
                      <th style={{ width: 110 }}>GST %</th>
                      <th style={{ width: 130 }} className="r">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const e = l.include ? lineErr(l) : null;
                      return (
                        <tr key={l.poItemId} style={l.include ? undefined : { opacity: 0.55 }}>
                          <td className="center">
                            <input type="checkbox" checked={l.include} disabled={l.billable <= 0 && !l.include} onChange={(ev) => upd(i, { include: ev.target.checked, qty: ev.target.checked && !l.qty ? String(l.billable) : l.qty })} aria-label={`Bill line ${l.lineNo}`} />
                          </td>
                          <td>
                            <div className="strong">{l.item}</div>
                            <div className="text-xs muted">
                              Line {l.lineNo} · {l.uom}
                            </div>
                          </td>
                          <td className="r num">{fmtNum(l.ordered)}</td>
                          <td className="r num">{fmtNum(l.received)}</td>
                          <td className="r num">{l.qcRecorded ? fmtNum(l.accepted) : <span className="muted">QC pending</span>}</td>
                          <td className="r num">{fmtNum(l.invoiced)}</td>
                          <td className="r num strong">{fmtNum(l.billable)}</td>
                          <td>
                            <input type="number" min="0" step="any" className="right" value={l.qty} disabled={!l.include} onChange={(ev) => upd(i, { qty: ev.target.value })} title={e ?? undefined} style={e ? { borderColor: 'var(--crit)' } : undefined} />
                          </td>
                          <td>
                            <input type="number" min="0" step="any" className="right" value={l.rate} disabled={!l.include} onChange={(ev) => upd(i, { rate: ev.target.value })} style={l.include && rateOff(l) ? { borderColor: 'var(--warn)' } : undefined} />
                          </td>
                          <td>
                            <select value={l.gst} disabled={!l.include} onChange={(ev) => upd(i, { gst: Number(ev.target.value) })}>
                              {[0, 5, 12, 18, 28].map((g) => (
                                <option key={g} value={g}>
                                  {g}%
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="r num strong">{l.include ? inr(round2(Number(l.qty) * Number(l.rate)) || 0) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {used.some((l) => lineErr(l)) && <div className="callout warn"><AlertTriangle size={16} /><div>{used.map((l) => lineErr(l) && `Line ${l.lineNo}: ${lineErr(l)}`).filter(Boolean).join(' · ')}</div></div>}

            {needsNote && (
              <div className="callout warn">
                <AlertTriangle size={16} />
                <div>A rate differs from the PO rate by more than {INVOICE_RATE_TOLERANCE_PCT}%. Explain why below; the invoice cannot be saved without it.</div>
              </div>
            )}
            <Field label="Variance note" required={needsNote} hint="Why the invoice rate differs from the PO rate (leave empty when the rates match)">
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>

            {used.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ minWidth: 300, border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', background: 'var(--surface-2)' }}>
                  <div className="flex-between text-xs" style={{ marginBottom: 6 }}>
                    <span className="muted">Taxable amount</span>
                    <span className="strong">{inr(taxable)}</span>
                  </div>
                  <div className="flex-between text-xs" style={{ marginBottom: 8 }}>
                    <span className="muted">GST (preview — the final figures are worked out when saved)</span>
                    <span className="strong">{inr(gst)}</span>
                  </div>
                  <div className="flex-between strong" style={{ borderTop: '1px solid var(--border-strong)', paddingTop: 10, fontSize: 16 }}>
                    <span>Invoice total</span>
                    <span className="num">{inr(taxable + gst)}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </PageFormCtx.Provider>
  );
}
