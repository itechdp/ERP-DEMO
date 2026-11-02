import * as api from '../db/api';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, CheckCircle, Eye, FileText, LayoutGrid, Pencil, Plus, Printer, ShoppingCart, Trash2 } from 'lucide-react';
import { Conf, Write, canSee, searchable, useAccess } from '../auth/access';
import { NoAccess } from './NoAccess';
import { useStore } from '../store/StoreContext';
import { Badge, Confirm, Empty, Field, go, NumInput, PageHeader, Search, type Icon, FilterMenu } from '../components/ui';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { COL_LABEL, KIND_BY_ROUTE, SALES_KINDS, type ColKey, type FieldDef, type FieldKey, type KindCfg, type SalesRecord } from '../sales/config';
import { useSalesRecords } from '../sales/useSales';
import { printSalesRecord } from '../sales/print';
import { dbMessage, withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { UrgencyBadge } from '../tasks/UrgencyBadge';
import { PersonSelect } from '../components/PersonSelect';
import { CustomerSelect } from '../masters/CustomerSelect';
import { fetchAssignableUsers, type AssignableUser } from '../tasks/service';

export interface SalesPageDef {
  route: string;
  resource: string;
  label: string;
  icon: Icon;
}

/** The Sales & Orders pages, in menu order. */
export const SALES_PAGES: SalesPageDef[] = [
  { route: 'sales-dashboard', resource: 'sales_dashboard', label: 'Sales Dashboard', icon: LayoutGrid },
  ...SALES_KINDS.filter((k) => k.kind === 'inquiry').map((k) => ({ route: k.route, resource: k.resource, label: k.label, icon: k.icon })),
  { route: 'sales-quotation', resource: 'sales_quotation', label: 'Sales Quotation', icon: FileText },
  { route: 'quotation-approvals', resource: 'quotation_approvals', label: 'Quotation Approvals', icon: CheckCircle },
  { route: 'sales-order', resource: 'sales_orders', label: 'Sales Order', icon: ShoppingCart },
  ...SALES_KINDS.filter((k) => k.kind === 'task').map((k) => ({ route: k.route, resource: k.resource, label: k.label, icon: k.icon })),
  { route: 'sales-reports', resource: 'sales_reports', label: 'Sales Reports', icon: BarChart3 },
];

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;
/** which kind of confidential information a column carries */
const colGroup = (c: ColKey) => (c === 'party' || c === 'contact' || c === 'phone' || c === 'email' ? ('party_names' as const) : c === 'rate' || c === 'amount' ? ('sales_rates' as const) : undefined);
const NUM_COLS: ColKey[] = ['qty', 'rate', 'amount'];

function Cell({ r, c }: { r: SalesRecord; c: ColKey }) {
  switch (c) {
    case 'docNo':
      return <td className="mono strong nowrap">{r.docNo}</td>;
    case 'status':
      return (
        <td>
          <Badge status={r.status} />
        </td>
      );
    case 'docDate':
      return <td className="nowrap">{fmtDate(r.docDate)}</td>;
    case 'dueDate':
      return <td className="nowrap">{r.dueDate ? fmtDate(r.dueDate) : '—'}</td>;
    case 'priority':
      return <td><UrgencyBadge urgency={r.priority} /></td>;
    case 'qty':
      return <td className="r num">{r.qty == null ? '—' : fmtNum(r.qty)}</td>;
    case 'rate':
      return <td className="r num nowrap">{r.rate == null ? '—' : `${inr(r.rate)} / pc`}</td>;
    case 'amount':
      return <td className="r num nowrap strong">{r.amount == null ? '—' : inr(r.amount)}</td>;
    case 'party':
    case 'title':
      return <td className="strong">{r[c] || '—'}</td>;
    case 'refNo':
    case 'extRef':
      return <td className="mono">{r[c] || '—'}</td>;
    default:
      return <td>{r[c] || '—'}</td>;
  }
}

// ------------------------------------------------------------------ list ---
/** One Sales & Orders page: the list, or — when the address says ?new=1 / ?edit=<id> — the full-page form. */
export function SalesListPage({ route, query }: { route: string; query: URLSearchParams }) {
  const cfg = KIND_BY_ROUTE[route];
  const editId = Number(query.get('edit')) || undefined;
  if (query.get('new') === '1' || editId) return <SalesFormPage cfg={cfg} editId={editId} viewOnly={query.get('view') === '1'} />;
  return <SalesList cfg={cfg} />;
}

function SalesList({ cfg }: { cfg: KindCfg }) {
  const { rows, loading, error, reload } = useSalesRecords();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<SalesRecord | null>(null);
  const { toast } = useStore();

  const mine = useMemo(() => rows.filter((r) => r.kind === cfg.kind), [rows, cfg.kind]);
  const shown = mine
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => Object.entries(extra).every(([k, v]) => v === 'all' || r[k as 'party' | 'product' | 'source' | 'priority' | 'assignee'] === v))
    .filter((r) => matches(q, r.docNo, r.extRef, r.refNo, r.product, r.title, r.assignee, r.status, searchable(r.party), searchable(r.contact), searchable(r.phone)));

  const dim = (key: 'party' | 'product' | 'source' | 'priority' | 'assignee', label: string, all: string) => ({
    label,
    value: extra[key] ?? 'all',
    onChange: (v: string) => setExtra((x) => ({ ...x, [key]: v })),
    options: [{ value: 'all', label: all }, ...[...new Set(mine.map((r) => r[key]).filter(Boolean))].sort().map((v) => ({ value: v, label: v }))],
  });
  const groups = [
    { label: 'Status', value: status, onChange: setStatus, options: [{ value: 'all', label: 'All', count: mine.length }, ...cfg.statuses.map((s) => ({ value: s, label: s, count: mine.filter((r) => r.status === s).length }))] },
    ...(cfg.kind !== 'task' && canSee('party_names') ? [dim('party', 'Customer', 'All customers')] : []),
    ...(cfg.kind !== 'task' ? [dim('product', 'Product', 'All products')] : []),
    ...(cfg.kind === 'task' ? [dim('priority', 'Urgency', 'All urgencies'), dim('assignee', 'Assigned to', 'Everyone')] : []),
  ];

  const remove = async (r: SalesRecord) => {
    try {
      await api.deleteSalesRecord(r.kind, r.id);
      toast({ kind: 'success', title: `${cfg.singular} deleted`, message: r.docNo });
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });
    }
  };

  const add = (
    <button className="btn btn-primary" onClick={() => go(`${cfg.route}?new=1`)}>
      <Plus size={15} /> Add {cfg.singular}
    </button>
  );

  return (
    <>
      <PageHeader eyebrow="Sales & Orders" title={cfg.label} actions={mine.length > 0 ? <Write res={cfg.resource}>{add}</Write> : undefined} />
      <div className="card">
        {error ? (
          <Empty icon={cfg.icon} title="Could not load" text={error} />
        ) : loading ? (
          <Empty icon={cfg.icon} title="Loading…" />
        ) : mine.length === 0 ? (
          <Empty icon={cfg.icon} title={`No ${cfg.label.toLowerCase()} records yet`} text={`Nothing has been added to ${cfg.label} yet.`} action={<Write res={cfg.resource}>{add}</Write>} />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder={`Search ${cfg.label.toLowerCase()}…`} />
              <FilterMenu groups={groups} />
            </div>
            {shown.length === 0 ? (
              <Empty icon={cfg.icon} title="No matches" text="Try a different status or search." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      {cfg.cols.map((c) => (
                        <Conf key={c} g={colGroup(c)}>
                          <th className={NUM_COLS.includes(c) ? 'r' : undefined}>{COL_LABEL[c]}</th>
                        </Conf>
                      ))}
                      <th className="act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id}>
                        {cfg.cols.map((c) => (
                          <Conf key={c} g={colGroup(c)}>
                            <Cell r={r} c={c} />
                          </Conf>
                        ))}
                        <td className="r nowrap">
                          <div className="icon-actions">
                            <button className="icon-btn" title="View" aria-label={`View ${r.docNo}`} onClick={() => go(`${cfg.route}?edit=${r.id}&view=1`)}>
                              <Eye size={17} />
                            </button>
                            {cfg.printable && (
                              <button className="icon-btn" title="Print" aria-label={`Print ${r.docNo}`} onClick={() => printSalesRecord(r)}>
                                <Printer size={17} />
                              </button>
                            )}
                            <Write res={cfg.resource}>
                              <button className="icon-btn" title="Edit" aria-label={`Edit ${r.docNo}`} onClick={() => go(`${cfg.route}?edit=${r.id}`)}>
                                <Pencil size={17} />
                              </button>
                              <button className="icon-btn danger" title="Delete" aria-label={`Delete ${r.docNo}`} onClick={() => setDeleting(r)}>
                                <Trash2 size={17} />
                              </button>
                            </Write>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
      <Confirm
        open={!!deleting}
        title={`Delete ${cfg.singular}`}
        message={deleting ? `Delete ${deleting.docNo}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

// ------------------------------------------------------------------ form ---
const SNAKE: Record<string, string> = { docDate: 'doc_date', dueDate: 'due_date', refNo: 'ref_no', extRef: 'ext_ref' };

/** Full-page Add / Edit form for one Sales & Orders record. */
function SalesFormPage({ cfg, editId, viewOnly }: { cfg: KindCfg; editId?: number; viewOnly?: boolean }) {
  const { canWrite, canRead } = useAccess();
  const { rows, loading, error } = useSalesRecords();
  const back = () => go(cfg.route);
  // a read-only view needs Read access; add / edit needs Write
  if (!(viewOnly ? canRead(cfg.resource) : canWrite(cfg.resource))) return <NoAccess />;
  const rec = editId ? rows.find((r) => r.id === editId && r.kind === cfg.kind) : undefined;
  const title = rec ? `${viewOnly ? 'View' : 'Edit'} ${cfg.singular} — ${rec.docNo}` : editId ? `${viewOnly ? 'View' : 'Edit'} ${cfg.singular}` : `Add ${cfg.singular}`;
  return (
    <>
      <PageHeader
        eyebrow="Sales & Orders"
        title={title}
        actions={
          <button className="btn" onClick={back}>
            <ArrowLeft size={15} /> Back to {cfg.label}
          </button>
        }
      />
      {editId && !rec ? (
        <div className="card">
          <Empty icon={cfg.icon} title={loading ? 'Loading…' : error ? 'Could not load' : 'Record not found'} text={error ?? (loading ? undefined : 'It may have been deleted.')} action={loading ? undefined : <button className="btn btn-primary" onClick={back}>Back to {cfg.label}</button>} />
        </div>
      ) : (
        <SalesFormBody key={(rec?.id ?? 'new') + (viewOnly ? '-v' : '')} cfg={cfg} rec={rec} onDone={back} viewOnly={!!viewOnly && !!rec} />
      )}
    </>
  );
}

/** The groups the form is laid out in; a field that belongs to none of them lands in "Other details", so new fields always show. */
const FORM_SECTIONS: { label: string; keys: FieldKey[] }[] = [
  { label: 'Customer', keys: ['party', 'contact', 'phone', 'email'] },
  { label: 'Task', keys: ['title', 'assignee', 'priority'] },
  { label: 'Item', keys: ['product', 'qty', 'rate'] },
  { label: 'Reference & dates', keys: ['source', 'refNo', 'extRef', 'dueDate'] },
];

function SalesFormBody({ cfg, rec, onDone, viewOnly }: { cfg: KindCfg; rec?: SalesRecord; onDone: () => void; viewOnly?: boolean }) {
  const { toast } = useStore();
  // fields the role may not see are not shown (and the database ignores them anyway)
  const fields = cfg.fields.filter((f) => (colGroup(f.key) === 'party_names' ? canSee('party_names') : colGroup(f.key) === 'sales_rates' ? canSee('sales_rates') : true));
  const initial = (f: FieldDef) => {
    const v = rec?.[f.key];
    if (v == null) return f.key === 'priority' ? 'Medium' : '';
    return String(v);
  };
  const [v, setV] = useState<Record<string, string>>(() => ({ ...Object.fromEntries(fields.map((f) => [f.key, initial(f)])), docDate: rec?.docDate ?? todayISO(), status: rec?.status ?? cfg.statuses[0] }));
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<AssignableUser[]>([]);
  useEffect(() => {
    if (cfg.kind === 'task') void fetchAssignableUsers().then(setPeople);
  }, [cfg.kind]);
  const doc = useDocNo(`sales_${cfg.kind}`, !rec);
  const set = (k: string, val: string) => setV((x) => ({ ...x, [k]: val }));
  const valid = fields.every((f) => !f.required || (v[f.key] ?? '').trim() !== '');

  const submit = async () => {
    setBusy(true);
    try {
      const payload: Record<string, string> = { status: v.status, doc_date: v.docDate };
      for (const f of fields) payload[SNAKE[f.key] ?? f.key] = (v[f.key] ?? '').trim();
      const no = await withDocNo(rec ? undefined : doc.custom, () => api.saveSalesRecord(cfg.kind, rec?.id, payload));
      toast({ kind: 'success', title: rec ? `${cfg.singular} updated` : `${cfg.singular} added`, message: no });
      onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });
      setBusy(false);
    }
  };

  const input = (f: FieldDef) => {
    if (f.key === 'qty') return <NumInput value={v.qty} onChange={(x) => set('qty', x)} suffix="PCS" />;
    if (f.key === 'rate') return <NumInput value={v.rate} onChange={(x) => set('rate', x)} suffix="₹ / pc" step="any" />;
    if (f.key === 'dueDate') return <input className="input" type="date" value={v.dueDate} onChange={(e) => set('dueDate', e.target.value)} />;
    if (f.key === 'remarks') return <textarea value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />;
    if (f.key === 'party' && cfg.kind !== 'task')
      return (
        <CustomerSelect
          value={v.party}
          onChange={(name, c) => setV((x) => ({ ...x, party: name, ...(c ? { contact: x.contact || c.contact, phone: x.phone || c.phone, email: x.email || c.email } : {}) }))}
        />
      );
    if (f.key === 'assignee' && people.length) return <PersonSelect value={v.assignee} onChange={(name) => set('assignee', name)} people={people} />;
    if (f.options)
      return (
        <select value={v[f.key]} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">Select…</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    return <input className="input" value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />;
  };
  const grid = (list: FieldDef[]) => (
    <div className="form-grid three">
      {list.map((f) => (
        <Field key={f.key} label={f.label} required={f.required}>
          {input(f)}
        </Field>
      ))}
    </div>
  );

  const placed = new Set<string>(['remarks', ...FORM_SECTIONS.flatMap((s) => s.keys)]);
  const other = fields.filter((f) => !placed.has(f.key));
  const remarks = fields.find((f) => f.key === 'remarks');

  // in view mode the card body is a disabled fieldset: the same layout, every field disabled
  const Body = (viewOnly ? 'fieldset' : 'div') as unknown as 'div';
  return (
    <div className="card">
      <Body className={`card-body form-page${viewOnly ? ' view-fieldset' : ''}`} {...(viewOnly ? ({ disabled: true } as object) : {})}>
        {viewOnly && (
          <div className="view-note">
            <Eye size={14} /> View only — this is the saved record. Nothing can be changed here.
          </div>
        )}
        <div className="section-label">Document</div>
        <div className="form-grid three">
          {rec ? (
            <Field label="Number">
              <input className="input" value={rec.docNo} readOnly />
            </Field>
          ) : (
            <DocNoField label="Number" no={doc.no} setNo={doc.setNo} />
          )}
          <Field label="Date">
            <input className="input" type="date" value={v.docDate} onChange={(e) => set('docDate', e.target.value)} />
          </Field>
          <Field label="Status" required>
            <select value={v.status} onChange={(e) => set('status', e.target.value)}>
              {cfg.statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        {FORM_SECTIONS.map((sec) => {
          const list = fields.filter((f) => sec.keys.includes(f.key));
          return list.length ? (
            <div key={sec.label}>
              <div className="section-label">{sec.label}</div>
              {grid(list)}
            </div>
          ) : null;
        })}
        {other.length > 0 && (
          <div>
            <div className="section-label">Other details</div>
            {grid(other)}
          </div>
        )}
        {remarks && (
          <div>
            <div className="section-label">Remarks</div>
            <Field label={remarks.label} full>
              {input(remarks)}
            </Field>
          </div>
        )}
        <div className="form-actions">
          {viewOnly ? (
            <>
              <button className="btn" onClick={onDone}>
                Close
              </button>
              {cfg.printable && rec && (
                <button className="btn btn-primary" onClick={() => printSalesRecord(rec)}>
                  <Printer size={15} /> Print
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn" onClick={onDone}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
                {rec ? 'Save Changes' : `Add ${cfg.singular}`}
              </button>
            </>
          )}
        </div>
      </Body>
    </div>
  );
}
