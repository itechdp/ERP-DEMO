import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, FileSpreadsheet, ListTree, CheckCircle, ClipboardCheck, Download, Eye, Mail, MessageSquarePlus, Pencil, Plus, Printer, RefreshCw, Send, ShoppingCart, Trash2, Undo2, XCircle } from 'lucide-react';
import { Write, useAccess } from '../auth/access';
import { Badge, Empty, Field, FilterMenu, Modal, PageFormCtx, PageHeader, Search } from '../components/ui';
import { fmtDate, fmtDateTime, fmtNum, matches, todayISO } from '../components/format';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { useQuotationDetail, useQuotations } from './hooks';
import { Brief } from '../components/Brief';
import { inr, lineCalc, pct, plusDays, totalsCalc } from './calc';
import { printQuotation } from './print';
import { exportQuotationXlsx } from './exportQuotation';
import {
  addFollowup, createOrderFromQuotation, decideQuotation, fetchMinMargin, openQuotationPdf, respondQuotation, saveQuotation, sendQuotation, sendQuotationEmail, submitQuotation,
} from './service';
import { CostSheetEditor } from './CostSheetEditor';
import { LOST_REASONS, UOMS, type QuotationHeader, type QuotationLine, type QuotationRow } from './types';

const blankLine = (): QuotationLine => ({ product: '', grade: '', size: '', uom: 'PCS', qty: null, rate: null, discountPct: 0, materialCost: null, processingCost: null, otherCost: null });
const numOrNull = (v: string) => (v === '' ? null : Number(v));
const userName = (u: { name?: string; email?: string } | null) => u?.name || u?.email || 'User';

/** shown to the Director: a red flag when the margin is under the minimum */
export function MarginFlag({ q }: { q: Pick<QuotationRow, 'belowMin' | 'minMargin' | 'marginPct'> }) {
  if (q.marginPct == null) return <span className="muted">—</span>;
  return (
    <span className={q.belowMin ? 'text-red strong' : ''} title={q.belowMin ? `Below the minimum margin of ${q.minMargin}%` : undefined}>
      {q.belowMin && <AlertTriangle size={12} style={{ marginRight: 3, verticalAlign: -1 }} />}
      {pct(q.marginPct)}
    </span>
  );
}

export async function printFromList(r: QuotationRow, toast: (t: { kind: 'success' | 'error' | 'info'; title: string; message: string }) => void) {
  try {
    const { fetchQuotation } = await import('./service');
    const d = await fetchQuotation(r.id);
    printQuotation(d.q, d.lines);
  } catch (e) {
    toast({ kind: 'error', title: 'Could not print', message: e instanceof Error ? e.message : String(e) });
  }
}

/** the next step a quotation is waiting for: the icon in the list opens its page with this step ready (nothing changes until it is confirmed there) */
export function nextStepFor(r: QuotationRow): { step: QStep; label: string; res: string; Icon: typeof Send } | null {
  switch (r.status) {
    case 'Draft':
    case 'Revision Required':
      return { step: 'submit', label: 'Submit for approval', res: 'sales_quotation', Icon: Send };
    case 'Pending Approval':
      return { step: 'approve', label: 'Review and decide', res: 'quotation_approvals', Icon: ClipboardCheck };
    case 'Approved':
      return { step: 'send', label: 'Mark as sent', res: 'sales_quotation', Icon: Send };
    case 'Sent':
      return { step: 'respond', label: 'Record customer response', res: 'sales_quotation', Icon: CheckCircle };
    case 'Won':
      return r.orderNo ? null : { step: 'order', label: 'Create sales order', res: 'sales_orders', Icon: ShoppingCart };
    default:
      return null;
  }
}

// =================================================================================================
// list + routing between list / form / detail
// =================================================================================================
export function QuotationPage({ query, navigate }: { query?: URLSearchParams; navigate: (r: string) => void }) {
  const { quotations, loading, error, reload } = useQuotations();
  const { can, canWrite } = useAccess();
  const { toast } = useStore();
  const [selected, setSelected] = useState<number | null>(Number(query?.get('id')) || null);
  const [step, setStep] = useState<QStep>(null);
  const [formOpen, setFormOpen] = useState(query?.get('new') === '1');
  const [editId, setEditId] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [customer, setCustomer] = useState('all');

  useEffect(() => {
    if (query?.get('new') === '1') {
      setEditId(null);
      setFormOpen(true);
    }
    const id = Number(query?.get('id')) || null;
    if (id) setSelected(id);
  }, [query]);

  const customers = useMemo(() => [...new Set(quotations.map((x) => x.customer).filter(Boolean))].sort(), [quotations]);
  const shown = useMemo(
    () =>
      quotations
        .filter((x) => status === 'all' || x.displayStatus === status)
        .filter((x) => customer === 'all' || x.customer === customer)
        .filter((x) => matches(q, x.docNo, x.customer, x.products, x.salesperson, x.displayStatus, x.enquiryNo)),
    [quotations, status, customer, q],
  );

  const showMoney = can('sales_rates');
  const showMargin = can('margins');
  const showCustomer = can('party_names');

  if (formOpen) {
    return (
      <PageFormCtx.Provider value={{ eyebrow: 'Sales & Orders' }}>
        <QuotationForm
          editId={editId}
          onClose={() => {
            setFormOpen(false);
            setEditId(null);
            if (query?.get('new') === '1') navigate('sales-quotation');
          }}
          onSaved={(id) => {
            setFormOpen(false);
            setEditId(null);
            void reload();
            setSelected(id);
          }}
        />
      </PageFormCtx.Provider>
    );
  }

  if (selected) {
    return (
      <QuotationDetail
        id={selected}
        initialStep={step}
        navigate={navigate}
        onBack={() => {
          setSelected(null);
          setStep(null);
          navigate('sales-quotation');
          void reload();
        }}
        onEdit={(id) => {
          setEditId(id);
          setFormOpen(true);
        }}
      />
    );
  }

  const groups = [
    {
      label: 'Status',
      value: status,
      onChange: setStatus,
      options: [{ value: 'all', label: 'All statuses' }, ...['Draft', 'Pending Approval', 'Revision Required', 'Rejected', 'Approved', 'Sent', 'Won', 'Lost', 'Expired'].map((v) => ({ value: v, label: v }))],
    },
    ...(showCustomer ? [{ label: 'Customer', value: customer, onChange: setCustomer, options: [{ value: 'all', label: 'All customers' }, ...customers.map((v) => ({ value: v, label: v }))] }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Sales & Orders"
        title="Sales Quotations"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="sales_quotation">
              <button className="btn btn-primary" onClick={() => { setEditId(null); setFormOpen(true); }}>
                <Plus size={15} /> New Quotation
              </button>
            </Write>
          </>
        }
      />
      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search by quotation no, customer, product…" />
            <FilterMenu groups={groups} />
          </div>
          <div className="right text-xs muted">
            Showing {shown.length} of {quotations.length} quotations
          </div>
        </div>
        {loading ? (
          <div className="card-center-msg">Loading quotations…</div>
        ) : error ? (
          <div className="card-center-msg text-red">{error}</div>
        ) : shown.length === 0 ? (
          <Empty title="No quotations found" text={quotations.length === 0 ? 'Create a quotation for a customer enquiry.' : 'No quotations match your search.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Quotation No</th>
                  <th>Date</th>
                  {showCustomer && <th>Customer</th>}
                  <th>Products</th>
                  {showMoney && <th className="right">Value</th>}
                  {showMargin && <th className="right">Margin</th>}
                  <th>Valid Until</th>
                  <th className="center">Status</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td className="strong">
                      <button className="link-btn" style={{ fontWeight: 600 }} onClick={() => setSelected(r.id)}>
                        {r.docNo}
                      </button>
                    </td>
                    <td className="muted nowrap">{fmtDate(r.qtDate)}</td>
                    {showCustomer && <td className="strong">{r.customer || '—'}</td>}
                    <td>
                      <div>{r.products || '—'}</div>
                      <div className="text-xs muted">{r.lineCount} line{r.lineCount === 1 ? '' : 's'} · qty {fmtNum(r.totalQty)}</div>
                    </td>
                    {showMoney && <td className="right mono nowrap">{inr(r.amount)}</td>}
                    {showMargin && (
                      <td className="right mono">
                        <MarginFlag q={r} />
                      </td>
                    )}
                    <td className="muted nowrap">{fmtDate(r.validUntil ?? undefined)}</td>
                    <td className="center">
                      <Badge status={r.displayStatus} />
                    </td>
                    <td className="act nowrap">
                      <div className="icon-actions">
                        <button className="icon-btn" title="View quotation" aria-label={`View ${r.docNo}`} onClick={() => setSelected(r.id)}>
                          <Eye size={16} />
                        </button>
                        {(r.status === 'Draft' || r.status === 'Revision Required') && (
                          <Write res="sales_quotation">
                            <button className="icon-btn" title="Edit quotation" aria-label={`Edit ${r.docNo}`} onClick={() => { setEditId(r.id); setFormOpen(true); }}>
                              <Pencil size={16} />
                            </button>
                          </Write>
                        )}
                        {['Approved', 'Sent', 'Won', 'Lost'].includes(r.status) && (
                          <button className="icon-btn" title="Print quotation" aria-label={`Print ${r.docNo}`} onClick={() => void printFromList(r, toast)}>
                            <Printer size={16} />
                          </button>
                        )}
                        {(() => {
                          const n = nextStepFor(r);
                          if (!n || !canWrite(n.res)) return null;
                          return (
                            <button className="icon-btn" title={n.step === 'approve' ? 'Go to Quotation Approvals' : n.label} aria-label={`${n.label} ${r.docNo}`} onClick={() => (n.step === 'approve' ? navigate(`quotation-approvals?id=${r.id}&step=approve`) : (setStep(n.step), setSelected(r.id)))}>
                              <ClipboardCheck size={16} />
                            </button>
                          );
                        })()}
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

// =================================================================================================
// form
// =================================================================================================
function QuotationForm({ editId, onClose, onSaved }: { editId: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const { user, can } = useAccess();
  const { toast } = useStore();
  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);
  const doc = useDocNo('qt_draft', !editId);
  const [minMargin, setMinMargin] = useState(15);
  const [h, setH] = useState<QuotationHeader>({ customer: '', contact: '', phone: '', email: '', enquiryNo: '', paymentTerms: '', deliveryTerms: '', validUntil: '', remarks: '', qtDate: todayISO() });
  const [lines, setLines] = useState<QuotationLine[]>([blankLine()]);
  const [revisionNote, setRevisionNote] = useState('');
  const [costOpen, setCostOpen] = useState<number | null>(null);
  const moveLine = (i: number, d: -1 | 1) => {
    setCostOpen(null);
    setLines((c) => {
      const j = i + d;
      if (j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };
  const allowed = can('party_names') && can('sales_rates') && can('margins');

  useEffect(() => {
    void fetchMinMargin().then(setMinMargin).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const { fetchQuotation } = await import('./service');
        const d = await fetchQuotation(editId);
        if (!['Draft', 'Revision Required'].includes(d.q.status)) {
          toast({ kind: 'error', title: 'Cannot edit', message: 'Only a draft or a quotation sent back for revision can be edited.' });
          onClose();
          return;
        }
        setH({ customer: d.q.customer, contact: d.q.contact, phone: d.q.phone, email: d.q.email, enquiryNo: d.q.enquiryNo, paymentTerms: d.q.paymentTerms, deliveryTerms: d.q.deliveryTerms, validUntil: d.q.validUntil ?? '', remarks: d.q.remarks, qtDate: d.q.qtDate });
        setLines(d.lines.length ? d.lines : [blankLine()]);
        if (d.q.status === 'Revision Required') setRevisionNote(d.q.decisionNote ?? '');
      } catch (e) {
        toast({ kind: 'error', title: 'Could not load the quotation', message: String(e) });
        onClose();
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const set = (patch: Partial<QuotationHeader>) => setH((c) => ({ ...c, ...patch }));
  const setLine = (i: number, patch: Partial<QuotationLine>) => setLines((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const totals = totalsCalc(lines);
  const below = totals.marginPct != null && totals.marginPct < minMargin;

  const save = async (submit: boolean) => {
    setSaving(true);
    try {
      const me = userName(user);
      const id = await withDocNo(editId ? undefined : doc.custom, () => saveQuotation(editId, h, lines, me));
      if (submit) {
        await submitQuotation(id, me);
        toast({ kind: 'success', title: 'Submitted for approval', message: 'The Director will see it in Quotation Approvals.' });
      } else {
        toast({ kind: 'success', title: 'Quotation saved', message: 'Saved as a draft.' });
      }
      onSaved(id);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={editId ? 'Edit Quotation' : 'New Quotation'}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button className="btn btn-subtle" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-subtle" onClick={() => save(false)} disabled={saving || loading || !allowed}>{saving ? 'Saving…' : 'Save as Draft'}</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={saving || loading || !allowed}>Save &amp; Submit for Approval</button>
        </>
      }
    >
      {loading ? (
        <div className="card-center-msg">Loading quotation…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!allowed && (
            <div className="callout warn">A quotation holds customer names, prices and costs. Ask the Director to give you access to Party names, Sales rates and Costs &amp; margins.</div>
          )}
          {revisionNote && (
            <div className="callout warn">
              <b>Sent back for revision:</b> {revisionNote}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))', gap: 14 }}>
            {!editId && <DocNoField label="Quotation no. (draft)" no={doc.no} setNo={doc.setNo} />}
            <Field label="Customer" required><input value={h.customer} onChange={(e) => set({ customer: e.target.value })} placeholder="Customer / company" /></Field>
            <Field label="Contact person"><input value={h.contact} onChange={(e) => set({ contact: e.target.value })} /></Field>
            <Field label="Phone"><input value={h.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><input value={h.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="Enquiry no."><input value={h.enquiryNo} onChange={(e) => set({ enquiryNo: e.target.value })} placeholder="e.g. INQ-2026-0001" /></Field>
            <Field label="Quotation date" required><input type="date" value={h.qtDate} onChange={(e) => set({ qtDate: e.target.value })} /></Field>
            <Field label="Valid until" required><input type="date" value={h.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></Field>
            <Field label="Payment terms"><input value={h.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="e.g. 30 days from invoice" /></Field>
            <Field label="Delivery terms"><input value={h.deliveryTerms} onChange={(e) => set({ deliveryTerms: e.target.value })} placeholder="e.g. 4 weeks, ex-works" /></Field>
          </div>
          <Field label="Remarks"><input value={h.remarks} onChange={(e) => set({ remarks: e.target.value })} /></Field>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h4 style={{ margin: 0 }}>Products ({lines.length})</h4>
              <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((c) => [...c, blankLine()])}><Plus size={14} /> Add Line</button>
            </div>
            <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
              <table className="tbl form-tbl" style={{ fontSize: 13, minWidth: 1400 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>#</th>
                    <th style={{ minWidth: 190 }}>Product *</th>
                    <th style={{ width: 100 }}>Grade</th>
                    <th style={{ width: 120 }}>Size</th>
                    <th style={{ width: 80 }}>UOM</th>
                    <th className="right" style={{ width: 90 }}>Qty *</th>
                    <th className="right" style={{ width: 100 }}>Rate (₹) *</th>
                    <th className="right" style={{ width: 80 }}>Disc. %</th>
                    <th className="right" style={{ width: 100 }}>Net rate</th>
                    <th className="right" style={{ width: 100 }}>Material cost *</th>
                    <th className="right" style={{ width: 100 }}>Processing</th>
                    <th className="right" style={{ width: 100 }}>Other cost</th>
                    <th className="right" style={{ width: 90 }}>Margin</th>
                    <th style={{ width: 150 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const c = lineCalc(l);
                    const lineBelow = c.marginPct != null && c.marginPct < minMargin;
                    return (
                      <Fragment key={i}>
                      <tr>
                        <td className="mono muted">{i + 1}</td>
                        <td><input value={l.product} onChange={(e) => setLine(i, { product: e.target.value })} aria-label={`Product ${i + 1}`} /></td>
                        <td><input value={l.grade} onChange={(e) => setLine(i, { grade: e.target.value })} /></td>
                        <td><input value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} /></td>
                        <td>
                          <select value={l.uom} onChange={(e) => setLine(i, { uom: e.target.value })}>
                            {UOMS.map((u) => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td><input type="number" step="any" min="0" className="right mono" value={l.qty ?? ''} onChange={(e) => setLine(i, { qty: numOrNull(e.target.value) })} aria-label={`Qty ${i + 1}`} /></td>
                        <td><input type="number" step="any" min="0" className="right mono" value={l.rate ?? ''} onChange={(e) => setLine(i, { rate: numOrNull(e.target.value) })} aria-label={`Rate ${i + 1}`} /></td>
                        <td><input type="number" step="any" min="0" max="99.99" className="right mono" value={l.discountPct ?? ''} onChange={(e) => setLine(i, { discountPct: numOrNull(e.target.value) })} /></td>
                        <td className="right mono">{l.rate == null ? '—' : inr(c.net)}</td>
                        <td><input type="number" step="any" min="0" className="right mono" value={l.materialCost ?? ''} onChange={(e) => setLine(i, { materialCost: numOrNull(e.target.value) })} aria-label={`Material cost ${i + 1}`} /></td>
                        <td><input type="number" step="any" min="0" className="right mono" value={l.processingCost ?? ''} onChange={(e) => setLine(i, { processingCost: numOrNull(e.target.value) })} /></td>
                        <td><input type="number" step="any" min="0" className="right mono" value={l.otherCost ?? ''} onChange={(e) => setLine(i, { otherCost: numOrNull(e.target.value) })} /></td>
                        <td className={`right mono strong ${lineBelow ? 'text-red' : ''}`}>{pct(c.marginPct == null ? null : Math.round(c.marginPct * 100) / 100)}</td>
                        <td className="act">
                          <button type="button" className="icon-btn" style={l.costing?.length ? { color: '#259392' } : undefined} title="Cost sheet (for the detailed quotation)" onClick={() => setCostOpen(costOpen === i ? null : i)}><ListTree size={15} /></button>
                          <button type="button" className="icon-btn" title="Move up" disabled={i === 0} onClick={() => moveLine(i, -1)}><ArrowUp size={15} /></button>
                          <button type="button" className="icon-btn" title="Move down" disabled={i === lines.length - 1} onClick={() => moveLine(i, 1)}><ArrowDown size={15} /></button>
                          <button type="button" className="icon-btn text-red" title="Remove line" onClick={() => { setCostOpen(null); setLines((cur) => (cur.length > 1 ? cur.filter((_, k) => k !== i) : cur)); }}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                      {costOpen === i && (
                        <tr>
                          <td colSpan={14}>
                            <CostSheetEditor rows={l.costing ?? []} onChange={(r) => setLine(i, { costing: r })} onUseRate={(a) => setLine(i, { rate: a })} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 16 }}>
              <div><div className="text-xs muted">Quotation value</div><div className="strong mono" style={{ fontSize: 18 }}>{inr(totals.amount)}</div></div>
              <div><div className="text-xs muted">Discount given</div><div className="mono">{inr(totals.discount)}</div></div>
              <div><div className="text-xs muted">Total cost</div><div className="mono">{inr(totals.cost)}</div></div>
              <div><div className="text-xs muted">Gross profit</div><div className="mono">{inr(totals.profit)}</div></div>
              <div><div className="text-xs muted">Gross margin</div><div className={`strong mono ${below ? 'text-red' : ''}`} style={{ fontSize: 18 }}>{pct(totals.marginPct == null ? null : Math.round(totals.marginPct * 100) / 100)}</div></div>
            </div>
            {below && (
              <div className="callout warn" style={{ marginTop: 12 }}>
                <AlertTriangle size={14} /> The margin is below the minimum of {minMargin}%. You can still submit it; the Director must give a reason to approve.
              </div>
            )}
            <div className="text-xs muted" style={{ marginTop: 10 }}>Gross margin % = (net rate − total cost) ÷ net rate × 100. Cost per unit = material + processing + other.</div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// =================================================================================================
// detail (also used by Quotation Approvals)
// =================================================================================================
export type QStep = null | 'submit' | 'approve' | 'reject' | 'revise' | 'send' | 'respond' | 'followup' | 'order';
type Dlg = QStep;
const STEP_TITLE: Record<string, string> = { submit: 'Submit for approval', approve: 'Approve quotation', reject: 'Reject quotation', revise: 'Send back for revision', send: 'Send quotation to the customer', respond: 'Customer response', order: 'Create Sales Order' };

export function QuotationDetail({ id, onBack, onEdit, navigate, initialStep = null }: { id: number; onBack: () => void; onEdit?: (id: number) => void; navigate: (r: string) => void; initialStep?: QStep }) {
  const { detail, loading, error, reload } = useQuotationDetail(id);
  const { user, can, canWrite } = useAccess();
  const [mailPrefilled, setMailPrefilled] = useState(false);
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [detailed, setDetailed] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(initialStep);
  const [note, setNote] = useState('');
  const [response, setResponse] = useState<'Won' | 'Lost' | 'Pending'>('Won');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(todayISO());
  const [next, setNext] = useState(initialStep === 'send' || initialStep === 'respond' ? plusDays(3) : '');
  const [sendVia, setSendVia] = useState<'email' | 'other'>('email');
  const [mailTo, setMailTo] = useState('');
  const [mailCc, setMailCc] = useState('');
  const [extRef, setExtRef] = useState('');
  const [delivery, setDelivery] = useState('');

  const open = (d: Dlg) => {
    setNote('');
    setReason('');
    setNext(d === 'send' || d === 'respond' ? plusDays(3) : '');
    setDate(todayISO());
    setResponse('Won');
    setSendVia('email');
    setMailTo(detail?.q.email ?? '');
    setMailCc('');
    setDlg(d);
  };

  if (loading && !detail) return <div className="card"><div className="card-center-msg">Loading quotation…</div></div>;
  if (error || !detail) {
    return (
      <div className="card">
        <div className="card-center-msg text-red">{error || 'Quotation not found.'}</div>
        <div className="center mt-4"><button className="btn btn-subtle" onClick={onBack}><ArrowLeft size={15} /> Back</button></div>
      </div>
    );
  }
  const { q, lines, actions, followups, emails } = detail;
  if (!mailPrefilled) {
    setMailPrefilled(true);
    setMailTo(q.email);
  }
  const me = userName(user);
  const showMargin = can('margins');
  const showMoney = can('sales_rates');
  const canApprove = canWrite('quotation_approvals');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ kind: 'success', title: ok, message: q.docNo });
      setDlg(null);
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not complete that', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const decide = (d: 'approve' | 'reject' | 'revise') =>
    run(() => decideQuotation(q.id, d, note, me), d === 'approve' ? 'Quotation approved' : d === 'reject' ? 'Quotation rejected' : 'Sent back for revision');

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await openQuotationPdf(q.id);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the PDF', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmStep = async () => {
    if (dlg === 'submit') return run(() => submitQuotation(q.id, me), 'Submitted for approval');
    if (dlg === 'send' && (sendVia === 'email' || q.status === 'Sent')) {
      if (!mailTo.trim()) return toast({ kind: 'error', title: 'Enter the customer e-mail', message: 'Type the address the quotation should be sent to.' });
      return run(() => sendQuotationEmail(q.id, { to: mailTo.trim(), cc: mailCc.trim(), note, nextDate: next }), q.status === 'Sent' ? 'Quotation sent again' : 'Quotation e-mailed to the customer');
    }
    if (dlg === 'send') return run(() => sendQuotation(q.id, me, next), 'Marked as sent to the customer');
    if (dlg === 'approve' || dlg === 'reject' || dlg === 'revise') return decide(dlg);
    if (dlg === 'respond' && response === 'Pending') {
      if (!next) return toast({ kind: 'error', title: 'Choose the next follow-up date', message: 'Say when the customer should be contacted again.' });
      return run(() => addFollowup(q.id, todayISO(), note || 'Customer has not decided yet', next, me), 'Follow-up scheduled');
    }
    if (dlg === 'respond') return run(() => respondQuotation(q.id, response as 'Won' | 'Lost', reason, note, date, me), response === 'Won' ? 'Marked as won' : 'Marked as lost');
    if (dlg === 'order') {
      setBusy(true);
      try {
        const oid = await createOrderFromQuotation(q.id, extRef, delivery, note, me);
        toast({ kind: 'success', title: 'Sales order created', message: 'Opening it now.' });
        navigate(`sales-order?id=${oid}`);
      } catch (e) {
        toast({ kind: 'error', title: 'Could not create the order', message: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    }
  };

  const editable = q.status === 'Draft' || q.status === 'Revision Required';
  const printable = ['Approved', 'Sent', 'Won', 'Lost'].includes(q.status);

  return (
    <>
      <PageHeader
        eyebrow="Sales Quotation"
        title={q.docNo}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onBack}><ArrowLeft size={14} /> Back</button>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={busy}><RefreshCw size={14} /> Refresh</button>
            {printable && (
              <>
                <select value={detailed ? 'detailed' : 'standard'} onChange={(e) => setDetailed(e.target.value === 'detailed')} title="Detailed adds each line's cost sheet" aria-label="Quotation format" style={{ width: 'auto' }}>
                  <option value="standard">Standard</option>
                  <option value="detailed">Detailed (with cost sheet)</option>
                </select>
                <button className="btn btn-subtle" onClick={() => printQuotation(q, lines, { detailed })}><Printer size={14} /> Print / PDF</button>
                <button className="btn btn-subtle" onClick={() => exportQuotationXlsx(q, lines, me, { detailed }).catch((e) => toast({ kind: 'error', title: 'Could not export', message: e instanceof Error ? e.message : String(e) }))}><FileSpreadsheet size={14} /> Excel</button>
              </>
            )}
            {editable && onEdit && (
              <Write res="sales_quotation">
                <button className="btn btn-subtle" onClick={() => onEdit(q.id)}><Pencil size={14} /> Edit</button>
                <button className="btn btn-primary" onClick={() => open('submit')}><Send size={14} /> Submit for Approval</button>
              </Write>
            )}
            {q.status === 'Pending Approval' && canApprove && (
              <>
                <button className="btn btn-subtle" onClick={() => open('revise')}><Undo2 size={14} /> Send Back</button>
                <button className="btn btn-danger" onClick={() => open('reject')}><XCircle size={14} /> Reject</button>
                <button className="btn btn-primary" onClick={() => open('approve')}><CheckCircle size={14} /> Approve</button>
              </>
            )}
            {(q.status === 'Approved' || q.status === 'Sent') && (
              <Write res="sales_quotation">
                <button className="btn btn-subtle" onClick={() => void downloadPdf()}><Download size={14} /> Download PDF</button>
                <button className={`btn ${q.status === 'Approved' ? 'btn-primary' : 'btn-subtle'}`} onClick={() => open('send')}><Mail size={14} /> {q.status === 'Approved' ? 'Send to Customer' : 'Send again'}</button>
              </Write>
            )}
            {q.status === 'Sent' && (
              <Write res="sales_quotation">
                <button className="btn btn-primary" onClick={() => open('respond')}><CheckCircle size={14} /> Customer Response</button>
              </Write>
            )}
            {q.status === 'Won' && !q.orderNo && (
              <Write res="sales_orders">
                <button className="btn btn-primary" onClick={() => { setExtRef(''); setDelivery(''); open('order'); }}><ShoppingCart size={14} /> Create Sales Order</button>
              </Write>
            )}
            {q.orderNo && <button className="btn btn-subtle" onClick={() => navigate(`sales-order?id=${q.orderId}`)}><ShoppingCart size={14} /> {q.orderNo}</button>}
          </>
        }
      />

      {q.status === 'Revision Required' && q.decisionNote && <div className="callout warn" style={{ marginBottom: 16 }}><b>Sent back for revision:</b> {q.decisionNote}</div>}
      {q.status === 'Rejected' && q.decisionNote && <div className="callout warn" style={{ marginBottom: 16 }}><b>Rejected:</b> {q.decisionNote}</div>}
      {q.belowMin && q.status === 'Pending Approval' && (
        <div className="callout warn" style={{ marginBottom: 16 }}><AlertTriangle size={14} /> Margin {pct(q.marginPct)} is below the minimum of {q.minMargin}%. A note is needed to approve.</div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(190px, 100%), 1fr))', gap: 18, padding: 20 }}>
          <Info label="Status"><Badge status={q.displayStatus} /></Info>
          <Info label="Customer">{q.customer || '—'}</Info>
          <Info label="Contact">{[q.contact, q.phone].filter(Boolean).join(' · ') || '—'}</Info>
          <Info label="Quotation date">{fmtDate(q.qtDate)}</Info>
          <Info label="Valid until">{fmtDate(q.validUntil ?? undefined)}</Info>
          <Info label="Enquiry no.">{q.enquiryNo || '—'}</Info>
          <Info label="Salesperson">{q.salesperson || '—'}</Info>
          <Info label="Payment terms">{q.paymentTerms || '—'}</Info>
          <Info label="Delivery terms">{q.deliveryTerms || '—'}</Info>
          <Info label="Approved by">{q.approvedBy ? `${q.approvedBy}${q.approvedAt ? ' · ' + fmtDate(q.approvedAt) : ''}` : '—'}</Info>
          {q.sentAt && <Info label="Sent">{fmtDate(q.sentAt)}</Info>}
          {q.responseDate && <Info label="Customer response">{q.status} · {fmtDate(q.responseDate)}</Info>}
          {q.lostReason && <Info label="Lost reason">{q.lostReason}</Info>}
        </div>
        {(q.remarks || q.responseNote) && (
          <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--border)' }} className="text-sm">
            {q.remarks && <div><span className="text-xs muted">Remarks: </span>{q.remarks}</div>}
            {q.responseNote && <div><span className="text-xs muted">Response note: </span>{q.responseNote}</div>}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h3>Products ({lines.length})</h3></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th><th>Product</th><th>Grade / Size</th><th className="right">Qty</th>
                {showMoney && <><th className="right">Rate</th><th className="right">Disc.</th><th className="right">Net rate</th><th className="right">Amount</th></>}
                {showMargin && <><th className="right">Unit cost</th><th className="right">Margin</th></>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id ?? i}>
                  <td className="mono">{i + 1}</td>
                  <td className="strong">{l.product}</td>
                  <td>{[l.grade, l.size].filter(Boolean).join(' • ') || '—'}</td>
                  <td className="right mono nowrap">{fmtNum(l.qty ?? 0)} {l.uom}</td>
                  {showMoney && (
                    <>
                      <td className="right mono nowrap">{inr(l.rate)}</td>
                      <td className="right mono">{l.discountPct ? `${l.discountPct}%` : '—'}</td>
                      <td className="right mono nowrap">{inr(l.netRate)}</td>
                      <td className="right mono strong nowrap">{inr(l.amount)}</td>
                    </>
                  )}
                  {showMargin && (
                    <>
                      <td className="right mono nowrap">{inr(l.unitCost)}</td>
                      <td className="right mono">{pct(l.marginPct)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(showMoney || showMargin) && (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
            {showMoney && <Info label="Total value"><span className="mono strong">{inr(q.amount)}</span></Info>}
            {showMoney && <Info label="Discount given"><span className="mono">{inr(q.discountValue)}</span></Info>}
            {showMargin && <Info label="Total cost"><span className="mono">{inr(q.costTotal)}</span></Info>}
            {showMargin && <Info label="Gross profit"><span className="mono">{inr(q.profit)}</span></Info>}
            {showMargin && <Info label={`Gross margin (min ${q.minMargin}%)`}><span className="mono strong"><MarginFlag q={q} /></span></Info>}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 20 }}>
        <div className="card">
          <div className="card-head"><h3>Approval trail</h3></div>
          <ul className="feed">
            {actions.map((a) => (
              <li key={a.id}>
                <div>
                  <div className="tx"><b>{a.action}</b> · {a.actor}{showMargin && a.marginPct != null ? ` · margin ${pct(a.marginPct)}` : ''}</div>
                  {a.note && <div className="text-sm">{a.note}</div>}
                  <div className="tm">{fmtDateTime(a.actedAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Follow-ups ({followups.length})</h3>
            {['Approved', 'Sent'].includes(q.status) && (
              <Write res="sales_quotation">
                <button className="btn btn-sm btn-subtle" onClick={() => open('followup')}><MessageSquarePlus size={14} /> Add follow-up</button>
              </Write>
            )}
          </div>
          {followups.length === 0 ? (
            <Empty title="No follow-ups yet" text="Record each call or visit once the quotation is with the customer." />
          ) : (
            <ul className="feed">
              {followups.map((f) => (
                <li key={f.id}>
                  <div>
                    <div className="tx"><b>{fmtDate(f.date)}</b> · {f.by}{f.nextDate ? ` · next ${fmtDate(f.nextDate)}` : ''}</div>
                    <div className="text-sm">{f.note}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {emails.length > 0 && (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-head"><h3>E-mails to the customer ({emails.length})</h3></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Sent to</th><th>By</th><th className="center">Result</th><th>Details</th></tr></thead>
              <tbody>
                {emails.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap muted">{fmtDateTime(e.sentAt)}</td>
                    <td>{e.sentTo || '—'}{e.cc ? <div className="text-xs muted">CC {e.cc}</div> : null}</td>
                    <td>{e.sentBy || '—'}</td>
                    <td className="center"><span className={`badge ${e.status === 'Sent' ? 'b-green' : e.status === 'Failed' ? 'b-red' : 'b-neutral'}`}>{e.status}</span></td>
                    <td className="text-sm">{e.error || e.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        dialog
        open={!!dlg && dlg !== 'followup'}
        title={dlg ? STEP_TITLE[dlg] ?? '' : ''}
        onClose={() => setDlg(null)}
        footer={
          <>
            <button className="btn btn-subtle" onClick={() => setDlg(null)} disabled={busy}>Cancel</button>
            <button className={`btn ${dlg === 'reject' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={confirmStep}>
              {dlg === 'submit' ? 'Submit for approval' : dlg === 'send' ? (q.status === 'Sent' ? 'Send again' : sendVia === 'email' ? 'Send e-mail' : 'Yes, it has been sent') : dlg === 'approve' ? 'Approve & give number' : dlg === 'reject' ? 'Reject' : dlg === 'revise' ? 'Send back' : dlg === 'respond' ? (response === 'Pending' ? 'Schedule follow-up' : 'Save response') : 'Create order'}
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
        <Brief
          rows={[
            ['Quotation', q.docNo],
            ['Customer', q.customer || '—'],
            ['Products', q.products || '—'],
            ...(showMoney ? ([['Value', inr(q.amount)]] as [string, React.ReactNode][]) : []),
            ...(showMargin && (dlg === 'submit' || dlg === 'approve' || dlg === 'reject' || dlg === 'revise') ? ([['Gross margin', <MarginFlag key="m" q={q} />], ['Minimum margin', pct(q.minMargin)]] as [string, React.ReactNode][]) : []),
            ['Valid until', fmtDate(q.validUntil ?? undefined)],
            ...(dlg === 'respond' || dlg === 'send' ? ([['Sent on', q.sentAt ? fmtDate(q.sentAt) : '—'], ['Days waiting', q.daysPending != null ? String(q.daysPending) : '—']] as [string, React.ReactNode][]) : []),
            ...(dlg === 'order' ? ([['Payment terms', q.paymentTerms || '—'], ['Delivery terms', q.deliveryTerms || '—']] as [string, React.ReactNode][]) : []),
          ]}
        />
          {dlg === 'submit' && <p className="text-sm muted" style={{ margin: 0 }}>The Director will see this quotation in Quotation Approvals. It cannot be edited while it waits for a decision.</p>}
          {dlg === 'send' && q.status === 'Approved' && (
            <Field label="How is it going to the customer?">
              <select value={sendVia} onChange={(e) => setSendVia(e.target.value as 'email' | 'other')}>
                <option value="email">E-mail it now from the ERP (PDF attached)</option>
                <option value="other">I send it another way (WhatsApp, print and hand over…)</option>
              </select>
            </Field>
          )}
          {dlg === 'send' && (sendVia === 'email' || q.status === 'Sent') && (
            <>
              <Field label="To" required><input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} placeholder="customer@company.com" /></Field>
              <Field label="CC" hint="Optional. Separate several addresses with commas"><input value={mailCc} onChange={(e) => setMailCc(e.target.value)} /></Field>
              <Field label="Note to the customer" hint="Optional. Added to the e-mail text"><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
            </>
          )}
          {dlg === 'send' && sendVia === 'other' && q.status === 'Approved' && <p className="text-sm muted" style={{ margin: 0 }}>Confirm that the approved quotation has been sent to {q.customer || 'the customer'}.</p>}
          {dlg === 'send' && (
            <Field label="Next follow-up date" hint="You are reminded a day before. Clear it if no follow-up is needed.">
              <input type="date" min={todayISO()} value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
          )}
          {dlg === 'approve' && <p className="text-sm muted" style={{ margin: 0 }}>The quotation number is generated when you approve. {q.belowMin ? 'The margin is below the minimum, so a note is required.' : 'A note is optional.'}</p>}
          {(dlg === 'approve' || dlg === 'reject' || dlg === 'revise') && (
            <Field label={dlg === 'approve' ? 'Note' : dlg === 'reject' ? 'Reason for rejecting' : 'What should be changed?'} required={dlg !== 'approve' || !!q.belowMin}>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {dlg === 'respond' && (
            <>
              <Field label="Response" required>
                <select value={response} onChange={(e) => setResponse(e.target.value as 'Won' | 'Lost' | 'Pending')}>
                  <option value="Won">Won — customer accepted</option>
                  <option value="Lost">Lost — customer declined</option>
                  <option value="Pending">Pending — not decided yet, follow up again</option>
                </select>
              </Field>
              {response !== 'Pending' && <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
              {response === 'Pending' && (
                <Field label="Next follow-up date" required hint="You are reminded a day before."><input type="date" min={todayISO()} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
              )}
              {response === 'Lost' && (
                <Field label="Reason lost" required>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">Select a reason…</option>
                    {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </Field>
              )}
              <Field label={reason === 'Other' ? 'Describe the reason' : 'Note'} required={reason === 'Other'}><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </>
          )}
          {dlg === 'order' && (
            <>
              <p className="text-sm muted" style={{ margin: 0 }}>The order copies the customer, terms and every product at its net rate.</p>
              <Field label="Customer's PO no."><input value={extRef} onChange={(e) => setExtRef(e.target.value)} /></Field>
              <Field label="Delivery date"><input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} /></Field>
              <Field label="Remarks"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </>
          )}
        </div>
      </Modal>

      {/* follow-up */}
      <Modal dialog open={dlg === 'followup'} title="Add follow-up" onClose={() => setDlg(null)}
        footer={<>
          <button className="btn btn-subtle" onClick={() => setDlg(null)} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => addFollowup(q.id, date, note, next, me), 'Follow-up recorded')}>Save</button>
        </>}>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="What was discussed" required><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Field label="Next follow-up on"><input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        </div>
      </Modal>

    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs muted">{label}</div>
      <div className="strong" style={{ marginTop: 5 }}>{children}</div>
    </div>
  );
}
