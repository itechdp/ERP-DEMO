import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardCheck, Eye, Pencil, Plus, Printer, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { Write, useAccess } from '../auth/access';
import { Badge, Empty, Field, FilterMenu, Modal, PageFormCtx, PageHeader, Search } from '../components/ui';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { useStore } from '../store/StoreContext';
import { fgAvailable } from '../store/engine';
import { useOrderDetail, useOrders } from './hooks';
import { Brief } from '../components/Brief';
import { inr } from './calc';
import { printSalesOrder } from './print';
import { withDocNo } from '../db/client';
import { CustomerSelect } from '../masters/CustomerSelect';
import { MaterialPick, SizePick } from '../masters/MaterialPick';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { fetchOrder, saveOrder, setOrderStatus, type OrderHeaderInput } from './service';
import { ORDER_NEXT, UOMS, type OrderLine, type OrderRow } from './types';
import { DocButtons } from '../export/docOutput';
import * as docs from '../export/documents';

const blank = (): OrderLine => ({ product: '', grade: '', size: '', uom: 'PCS', qty: null, rate: null });
const numOrNull = (v: string) => (v === '' ? null : Number(v));
const userName = (u: { name?: string; email?: string } | null) => u?.name || u?.email || 'User';

async function printFromList(o: OrderRow, toast: (t: { kind: 'success' | 'error' | 'info'; title: string; message: string }) => void) {
  try {
    const d = await fetchOrder(o.id);
    printSalesOrder(d.o, d.lines);
  } catch (e) {
    toast({ kind: 'error', title: 'Could not print', message: e instanceof Error ? e.message : String(e) });
  }
}

export function SalesOrderPage({ query, navigate }: { query?: URLSearchParams; navigate: (r: string) => void }) {
  const { orders, loading, error, reload } = useOrders();
  const { can, canWrite } = useAccess();
  const { toast } = useStore();
  const [selected, setSelected] = useState<number | null>(Number(query?.get('id')) || null);
  const [step, setStep] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(query?.get('new') === '1');
  const [editId, setEditId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    const id = Number(query?.get('id')) || null;
    if (id) setSelected(id);
    if (query?.get('new') === '1') {
      setEditId(null);
      setFormOpen(true);
    }
  }, [query]);

  const shown = useMemo(() => orders.filter((o) => status === 'all' || o.status === status).filter((o) => matches(q, o.soNo, o.customer, o.products, o.extRef, o.quotationNo ?? '', o.status)), [orders, status, q]);

  if (formOpen) {
    return (
      <PageFormCtx.Provider value={{ eyebrow: 'Sales & Orders' }}>
        <OrderForm
          editId={editId}
          onClose={() => { setFormOpen(false); setEditId(null); if (query?.get('new') === '1') navigate('sales-order'); }}
          onSaved={(id) => { setFormOpen(false); setEditId(null); void reload(); setSelected(id); }}
        />
      </PageFormCtx.Provider>
    );
  }
  if (selected) {
    return <OrderDetail id={selected} initialStep={step} navigate={navigate} onBack={() => { setSelected(null); setStep(null); navigate('sales-order'); void reload(); }} onEdit={(id) => { setEditId(id); setFormOpen(true); }} />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales & Orders"
        title="Sales Orders"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
            <Write res="sales_orders"><button className="btn btn-primary" onClick={() => { setEditId(null); setFormOpen(true); }}><Plus size={15} /> New Sales Order</button></Write>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search by order no, customer, product…" />
            <FilterMenu groups={[{ label: 'Status', value: status, onChange: setStatus, options: [{ value: 'all', label: 'All statuses' }, ...['Draft', 'Confirmed', 'In Production', 'Delivered', 'Cancelled'].map((v) => ({ value: v, label: v }))] }]} />
          </div>
          <div className="right text-xs muted">Showing {shown.length} of {orders.length} orders</div>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading sales orders…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty title="No sales orders found" text={orders.length === 0 ? 'A sales order is created from a won quotation, or entered directly.' : 'No orders match your search.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order No</th><th>Date</th>{can('party_names') && <th>Customer</th>}<th>Products</th><th>Quotation</th><th>Delivery</th>
                  {can('sales_rates') && <th className="right">Value</th>}<th className="center">Status</th><th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td className="strong"><button className="link-btn" style={{ fontWeight: 600 }} onClick={() => setSelected(o.id)}>{o.soNo}</button></td>
                    <td className="muted nowrap">{fmtDate(o.soDate)}</td>
                    {can('party_names') && <td className="strong">{o.customer || '—'}</td>}
                    <td><div>{o.products || '—'}</div><div className="text-xs muted">{o.lineCount} line{o.lineCount === 1 ? '' : 's'} · qty {fmtNum(o.totalQty)}</div></td>
                    <td className="mono">{o.quotationNo || '—'}</td>
                    <td className="muted nowrap">{fmtDate(o.deliveryDate ?? undefined)}</td>
                    {can('sales_rates') && <td className="right mono nowrap">{inr(o.amount)}</td>}
                    <td className="center"><Badge status={o.status} /></td>
                    <td className="act nowrap">
                      <div className="icon-actions">
                        <button className="icon-btn" title="View" aria-label={`View ${o.soNo}`} onClick={() => setSelected(o.id)}><Eye size={16} /></button>
                        {o.status !== 'Cancelled' && (
                          <button className="icon-btn" title="Print sales order" aria-label={`Print ${o.soNo}`} onClick={() => void printFromList(o, toast)}>
                            <Printer size={16} />
                          </button>
                        )}
                        {ORDER_NEXT[o.status] && canWrite('sales_orders') && (
                          <button className="icon-btn" title={`Mark as ${ORDER_NEXT[o.status]}`} aria-label={`Mark ${o.soNo} as ${ORDER_NEXT[o.status]}`} onClick={() => { setStep(ORDER_NEXT[o.status] ?? null); setSelected(o.id); }}>
                            <ClipboardCheck size={16} />
                          </button>
                        )}
                        {['Draft', 'Confirmed'].includes(o.status) && <Write res="sales_orders"><button className="icon-btn" title="Edit" aria-label={`Edit ${o.soNo}`} onClick={() => { setEditId(o.id); setFormOpen(true); }}><Pencil size={16} /></button></Write>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function OrderForm({ editId, onClose, onSaved }: { editId: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { user, can } = useAccess();
  const { toast, state } = useStore();
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const doc = useDocNo('sales_order', !editId);
  const [h, setH] = useState<OrderHeaderInput>({ customer: '', contact: '', phone: '', email: '', extRef: '', deliveryDate: '', paymentTerms: '', deliveryTerms: '', remarks: '', soDate: todayISO() });
  const [lines, setLines] = useState<OrderLine[]>([blank()]);
  const allowed = can('party_names') && can('sales_rates');

  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const { o, lines: ls } = await fetchOrder(editId);
        if (!['Draft', 'Confirmed'].includes(o.status)) {
          toast({ kind: 'error', title: 'Cannot edit', message: 'A sales order can be edited until production starts.' });
          onClose();
          return;
        }
        setH({ customer: o.customer, contact: o.contact, phone: o.phone, email: o.email, extRef: o.extRef, deliveryDate: o.deliveryDate ?? '', paymentTerms: o.paymentTerms, deliveryTerms: o.deliveryTerms, remarks: o.remarks, soDate: o.soDate });
        setLines(ls.length ? ls : [blank()]);
      } catch (e) {
        toast({ kind: 'error', title: 'Could not load the order', message: String(e) });
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const set = (p: Partial<OrderHeaderInput>) => setH((c) => ({ ...c, ...p }));
  const setLine = (i: number, p: Partial<OrderLine>) => setLines((c) => c.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + (l.qty ?? 0) * (l.rate ?? 0), 0);

  const save = async () => {
    setSaving(true);
    try {
      const id = await withDocNo(editId ? undefined : doc.custom, () => saveOrder(editId, h, lines, userName(user)));
      toast({ kind: 'success', title: 'Sales order saved', message: 'Saved as a draft.' });
      onSaved(id);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open title={editId ? 'Edit Sales Order' : 'New Sales Order'} onClose={onClose} size="lg"
      footer={<><button className="btn btn-subtle" onClick={onClose} disabled={saving}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={saving || loading || !allowed}>{saving ? 'Saving…' : 'Save Sales Order'}</button></>}>
      {loading ? <div className="card-center-msg">Loading…</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!allowed && <div className="callout warn">A sales order holds customer names and prices. Ask the Director for access to Party names and Sales rates.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 14 }}>
            {!editId && <DocNoField label="Sales order no." no={doc.no} setNo={doc.setNo} />}
            <Field label="Customer" required><CustomerSelect value={h.customer} onChange={(name, c) => set({ customer: name, ...(c ? { contact: c.contact || h.contact, phone: c.phone || h.phone, email: c.email || h.email, paymentTerms: h.paymentTerms || c.paymentTerms } : {}) })} /></Field>
            <Field label="Contact person"><input value={h.contact} onChange={(e) => set({ contact: e.target.value })} /></Field>
            <Field label="Phone"><input value={h.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><input value={h.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Customer's PO no."><input value={h.extRef} onChange={(e) => set({ extRef: e.target.value })} /></Field>
            <Field label="Order date"><input type="date" value={h.soDate} onChange={(e) => set({ soDate: e.target.value })} /></Field>
            <Field label="Delivery date"><input type="date" value={h.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} /></Field>
            <Field label="Payment terms"><input value={h.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} /></Field>
            <Field label="Delivery terms"><input value={h.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} /></Field>
          </div>
          <Field label="Remarks"><input value={h.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Products ({lines.length})</h4>
              <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((c) => [...c, blank()])}><Plus size={14} /> Add Line</button>
            </div>
            <datalist id="so-products">{state.products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
            <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="tbl form-tbl" style={{ fontSize: 13, minWidth: 900 }}>
                <thead><tr><th style={{ width: 36 }}>#</th><th style={{ minWidth: 190 }}>Product *</th><th style={{ width: 110 }}>Grade</th><th style={{ width: 130 }}>Size</th><th style={{ width: 80 }}>UOM</th><th className="right" style={{ width: 100 }}>Qty *</th><th className="right" style={{ width: 110 }}>Rate (₹) *</th><th className="right" style={{ width: 120 }}>Amount</th><th style={{ width: 40 }}></th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className="mono muted">{i + 1}</td>
                      <td>
                        <input value={l.product} list="so-products" onChange={(e) => setLine(i, { product: e.target.value })} aria-label={`Product ${i + 1}`} />
                        {(() => {
                          // finished goods on hand for a product that matches the Product Master (by name or code)
                          const p = state.products.find((x) => x.name.trim().toLowerCase() === l.product.trim().toLowerCase() || x.code.trim().toLowerCase() === l.product.trim().toLowerCase());
                          if (!p) return null;
                          const have = state.finishedGoods.filter((g) => g.productId === p.id).reduce((t, g) => t + fgAvailable(g), 0);
                          const short = (l.qty ?? 0) - have;
                          return <div className={`text-xs ${short > 0 ? 'text-red' : 'muted'}`} style={{ marginTop: 3 }}>{have > 0 ? `${fmtNum(have)} PCS finished goods in stock` : 'None in finished goods'}{short > 0 && l.qty ? ` — ${fmtNum(short)} PCS still to produce` : ''}</div>;
                        })()}
                      </td>
                      <td><MaterialPick mode="grade" grade={l.grade} onChange={(v) => setLine(i, { grade: v.grade })} /></td>
                      <td><SizePick value={l.size} onChange={(v) => setLine(i, { size: v })} /></td>
                      <td><select value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })}>{UOMS.map((u) => <option key={u}>{u}</option>)}</select></td>
                      <td><input type="number" step="any" min="0" className="right mono" value={l.qty ?? ''} onChange={(e) => setLine(i, { qty: numOrNull(e.target.value) })} /></td>
                      <td><input type="number" step="any" min="0" className="right mono" value={l.rate ?? ''} onChange={(e) => setLine(i, { rate: numOrNull(e.target.value) })} /></td>
                      <td className="right mono nowrap">{inr((l.qty ?? 0) * (l.rate ?? 0))}</td>
                      <td className="act"><button type="button" className="icon-btn text-red" title="Remove line" onClick={() => setLines((c) => (c.length > 1 ? c.filter((_, k) => k !== i) : c))}><Trash2 size={15} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="right strong mono" style={{ marginTop: 10, textAlign: 'right' }}>Total {inr(total)}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function OrderDetail({ id, onBack, onEdit, navigate, initialStep = null }: { id: number; onBack: () => void; onEdit: (id: number) => void; navigate: (r: string) => void; initialStep?: string | null }) {
  const { detail, loading, error, reload } = useOrderDetail(id);
  const { user, can } = useAccess();
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [stepTo, setStepTo] = useState<string | null>(initialStep);
  const [note, setNote] = useState('');

  if (loading && !detail) return <div className="card"><div className="card-center-msg">Loading sales order…</div></div>;
  if (error || !detail) {
    return <div className="card"><div className="card-center-msg text-red">{error || 'Sales order not found.'}</div><div className="center mt-4"><button className="btn btn-subtle" onClick={onBack}><ArrowLeft size={15} /> Back</button></div></div>;
  }
  const { o, lines } = detail;
  const next = ORDER_NEXT[o.status];
  const move = async (status: string, why = '') => {
    setBusy(true);
    try {
      await setOrderStatus(o.id, status, why, userName(user));
      toast({ kind: 'success', title: `Order ${status.toLowerCase()}`, message: o.soNo });
      setStepTo(null);
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change the status', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales Order"
        title={o.soNo}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onBack}><ArrowLeft size={14} /> Back</button>
            {o.status !== 'Cancelled' && <button className="btn btn-subtle" onClick={() => printSalesOrder(o, lines)}><Printer size={14} /> Print / PDF</button>}
            {o.status !== 'Cancelled' && <DocButtons only="excel" build={(u) => docs.salesOrderSpec(o, lines, u)} />}
            {o.quotationId && <button className="btn btn-subtle" onClick={() => navigate(`sales-quotation?id=${o.quotationId}`)}>Quotation {o.quotationNo}</button>}
            <Write res="sales_orders">
              {['Draft', 'Confirmed'].includes(o.status) && <button className="btn btn-subtle" onClick={() => onEdit(o.id)}><Pencil size={14} /> Edit</button>}
              {next && <button className="btn btn-primary" onClick={() => { setNote(''); setStepTo(next); }}>Mark as {next}</button>}
              {!['Delivered', 'Cancelled'].includes(o.status) && <button className="btn btn-danger" onClick={() => { setNote(''); setStepTo('Cancelled'); }}><XCircle size={14} /> Cancel Order</button>}
            </Write>
          </>
        }
      />
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 18, padding: 20 }}>
          <Cell label="Status"><Badge status={o.status} /></Cell>
          <Cell label="Customer">{o.customer || '—'}</Cell>
          <Cell label="Contact">{[o.contact, o.phone].filter(Boolean).join(' · ') || '—'}</Cell>
          <Cell label="Order date">{fmtDate(o.soDate)}</Cell>
          <Cell label="Delivery date">{fmtDate(o.deliveryDate ?? undefined)}</Cell>
          <Cell label="Customer's PO no.">{o.extRef || '—'}</Cell>
          <Cell label="Payment terms">{o.paymentTerms || '—'}</Cell>
          <Cell label="Delivery terms">{o.deliveryTerms || '—'}</Cell>
        </div>
        {(o.remarks || o.cancelReason) && (
          <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }} className="text-sm">
            {o.remarks && <div><span className="text-xs muted">Remarks: </span>{o.remarks}</div>}
            {o.cancelReason && <div><span className="text-xs muted">Cancelled because: </span>{o.cancelReason}</div>}
          </div>
        )}
      </div>
      <div className="card">
        <div className="card-head"><h3>Products ({lines.length})</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>Product</th><th>Grade / Size</th><th className="right">Qty</th>{can('sales_rates') && <><th className="right">Rate</th><th className="right">Amount</th></>}</tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="mono">{i + 1}</td><td className="strong">{l.product}</td><td>{[l.grade, l.size].filter(Boolean).join(' • ') || '—'}</td>
                  <td className="right mono nowrap">{fmtNum(l.qty ?? 0)} {l.uom}</td>
                  {can('sales_rates') && <><td className="right mono nowrap">{inr(l.rate)}</td><td className="right mono strong nowrap">{inr(l.rate == null ? null : (l.qty ?? 0) * l.rate)}</td></>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('sales_rates') && <div className="strong mono" style={{ padding: '12px 20px', textAlign: 'right', borderTop: '1px solid var(--border)' }}>Total {inr(o.amount)}</div>}
      </div>

      <Modal
        dialog
        open={!!stepTo}
        title={stepTo === 'Cancelled' ? 'Cancel sales order' : `Mark as ${stepTo ?? ''}`}
        onClose={() => setStepTo(null)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setStepTo(null)} disabled={busy}>{stepTo === 'Cancelled' ? 'Keep order' : 'Cancel'}</button>
            <button className={`btn ${stepTo === 'Cancelled' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => stepTo && move(stepTo, stepTo === 'Cancelled' ? note : '')}>
              {stepTo === 'Cancelled' ? 'Cancel order' : `Yes, mark as ${stepTo ?? ''}`}
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <Brief
            rows={[
              ['Order', o.soNo],
              ['Customer', o.customer || '—'],
              ['Products', o.products || '—'],
              ...(can('sales_rates') ? ([['Value', inr(o.amount)]] as [string, React.ReactNode][]) : []),
              ['Delivery date', fmtDate(o.deliveryDate ?? undefined)],
              ['Status now', o.status],
            ]}
          />
          {stepTo === 'Cancelled' ? (
            <Field label="Reason for cancelling" required><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          ) : (
            <p className="text-sm muted" style={{ margin: 0 }}>This moves order {o.soNo} from {o.status} to {stepTo}.</p>
          )}
        </div>
      </Modal>
    </>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-xs muted">{label}</div><div className="strong" style={{ marginTop: 5 }}>{children}</div></div>;
}
