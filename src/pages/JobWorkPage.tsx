import * as api from '../db/api';
import { useMemo, useState } from 'react';
import { Eye, Handshake, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { Conf, Write, canSee, searchable, useAccess } from '../auth/access';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { CustomerSelect } from '../masters/CustomerSelect';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { STAGE_LABEL } from '../store/engine';
import { MATERIAL_FAMILIES } from '../store/materials';
import { jobWorkDeleteReason } from '../store/deletable';
import { Confirm, Empty, Field, FilterMenu, JobLink, Modal, NumInput, PageHeader, Search, Tabs } from '../components/ui';
import { JobCardReport } from '../jobwork/JobCardReport';
import { useStock } from '../stock/service';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { BASIS_LABEL, printJobWorkReceipt, processText } from '../jobwork/print';
import { PartyInventory, lineText } from '../jobwork/PartyInventory';
import { inr } from '../sales/print';
import type { JobWork } from '../store/types';
import { useTabAccess } from '../auth/tabs';
import { DocButtons } from '../export/docOutput';
import * as docs from '../export/documents';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';
import { usePaged } from '../components/Pager';

type Proc = JobWork['processes'];
const PROCESSES: { key: keyof Proc; label: string }[] = [
  { key: 'cutting', label: 'Cutting' },
  { key: 'forging', label: 'Forging' },
  { key: 'trimming', label: 'Trimming' },
  { key: 'heatTreatment', label: 'Heat Treatment' },
];

// ============================================================== the list ===
/** Workflow → Job Work: customers' parts that come in for only some of the processes. */
export function JobWorkPage() {
  const { state, openAction, openTrace, run } = useStore();
  const [q, setQ] = useState('');
  const [stageF, setStageF] = useState('all');
  const [srcF, setSrcF] = useState('all');
  const [deleting, setDeleting] = useState<JobWork | null>(null);
  const [editing, setEditing] = useState<JobWork | null>(null);
  const [tab0, setTab] = useState<'batches' | 'party' | 'report'>('batches');
  const ta = useTabAccess('job_work', ['batches', 'party', 'report'] as const);
  const tab = ta.pick(tab0);

  const jobOf = (w: JobWork) => state.jobs.find((j) => j.jobNo === w.jobNo);
  const list = useMemo(() => [...state.jobWork].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.jobNo.localeCompare(a.jobNo)), [state.jobWork]);
  const rows = list
    .filter((w) => stageF === 'all' || jobOf(w)?.currentStage === stageF)
    .filter((w) => srcF === 'all' || w.materialSource === srcF)
    .filter((w) => matches(q, w.jobNo, w.receiptNo, w.challanNo, w.itemDescription, w.itemName, w.material, state.products.find((p) => p.id === jobOf(w)?.productId)?.name, searchable(jobOf(w)?.customer)));
  const pg = usePaged(rows, rows.length);
  const stages = [...new Set(list.map((w) => jobOf(w)?.currentStage).filter(Boolean))] as string[];

  const add = (
    <button className="btn btn-primary" onClick={() => openAction({ kind: 'jobWork' })}>
      <Plus size={15} /> Receive Parts
    </button>
  );

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Job Work In" actions={list.length > 0 ? <><ListButtons doc={() => ({ filename: 'Job-Work-In', title: 'Job Work In', form: FORM_FORMATS.report, rows: rows.map((w) => ({ job: w.jobNo, challan: w.challanNo, date: w.challanDate, item: lineText(w) || w.itemDescription, customer: canSee('party_names') ? jobOf(w)?.customer : '', qty: w.receivedQty, weight: w.receivedWeight, source: w.materialSource === 'customer' ? 'Customer material' : 'Our material', stage: jobOf(w)?.currentStage })), cols: [{ label: 'Job No.', key: 'job' }, { label: 'Challan No.', key: 'challan' }, { label: 'Challan Date', key: 'date', kind: 'date' }, { label: 'Item', key: 'item', width: 28 }, { label: 'Customer', key: 'customer', width: 24 }, { label: 'Received (PCS)', key: 'qty', kind: 'num' }, { label: 'Weight (KG)', key: 'weight', kind: 'num' }, { label: 'Material', key: 'source', width: 18 }, { label: 'Now at', key: 'stage' }], totals: ['qty', 'weight'] })} /><Write res="job_work">{add}</Write></> : undefined} />
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} items={ta.only([{ value: 'batches', label: 'Job Work In', count: list.length }, { value: 'party', label: 'Party Inventory' }, { value: 'report', label: 'Job Card Report' }])} />
      </div>
      {tab === 'report' ? (
        <JobCardReport />
      ) : tab === 'party' ? (
        <PartyInventory />
      ) : (
      <div className="card">
        {list.length === 0 ? (
          <Empty icon={Handshake} title="No job work yet" text="Customers' parts received for only some of the processes appear here." action={<Write res="job_work">{add}</Write>} />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search job, customer, challan, item…' : 'Search job, challan, item…'} />
              <FilterMenu
                groups={[
                  { label: 'Now at', value: stageF, onChange: setStageF, options: [{ value: 'all', label: 'All stages' }, ...stages.map((s) => ({ value: s, label: STAGE_LABEL[s as keyof typeof STAGE_LABEL] ?? s, count: list.filter((w) => jobOf(w)?.currentStage === s).length }))] },
                  { label: 'Material', value: srcF, onChange: setSrcF, options: [{ value: 'all', label: 'All' }, { value: 'customer', label: "Customer's material" }, { value: 'own', label: 'Our material' }] },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <Empty icon={Handshake} title="No matches" text="Try a different search or filter." />
            ) : (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Job No.</th>
                      <Conf g="party_names">
                        <th>Customer</th>
                      </Conf>
                      <th>Challan</th>
                      <th>Item</th>
                      <th className="r">Received</th>
                      <th>Work</th>
                      <th>Material</th>
                      <th>Now at</th>
                      <Conf g="sales_rates">
                        <th className="r">Charges</th>
                      </Conf>
                      <th className="act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((w) => {
                      const job = jobOf(w);
                      const p = state.products.find((x) => x.id === job?.productId);
                      const reason = jobWorkDeleteReason(state, w.jobNo);
                      return (
                        <tr key={w.jobNo}>
                          <td className="nowrap">
                            <JobLink jobNo={w.jobNo} />
                          </td>
                          <Conf g="party_names">
                            <td className="strong">{job?.customer || '—'}</td>
                          </Conf>
                          <td>
                            <div className="mono">{w.challanNo || '—'}</div>
                            <div className="sub">{w.challanDate ? fmtDate(w.challanDate) : ''}</div>
                          </td>
                          <td>
                            {lineText(w) ? (
                              <>
                                <div className="strong">{lineText(w)}</div>
                                <div className="sub">→ {p?.name ?? '—'}{w.receiptNo && w.receiptNo !== w.jobNo ? ` · receipt ${w.receiptNo}` : ''}</div>
                              </>
                            ) : (
                              <>
                                <div className="strong">{p?.name ?? '—'}</div>
                                {w.itemDescription && <div className="sub">{w.itemDescription}</div>}
                              </>
                            )}
                          </td>
                          <td className="r num nowrap">
                            {fmtNum(w.receivedQty)} PCS
                            {w.receivedWeight ? <div className="sub">{w.receivedWeight} KG</div> : null}
                          </td>
                          <td>
                            <div>{processText(w)}</div>
                            {!w.qcRequired && <div className="sub">No QC</div>}
                          </td>
                          <td>{w.materialSource === 'own' ? 'Ours' : "Customer's"}</td>
                          <td className="nowrap">{job ? STAGE_LABEL[job.currentStage] : '—'}</td>
                          <Conf g="sales_rates">
                            <td className="r num nowrap">
                              {w.chargeBasis === 'none' ? (
                                '—'
                              ) : (
                                <>
                                  {w.amount != null ? <b>{inr(w.amount)}</b> : '—'}
                                  <div className="sub">{BASIS_LABEL[w.chargeBasis]}</div>
                                </>
                              )}
                            </td>
                          </Conf>
                          <td className="r nowrap">
                            <div className="icon-actions">
                              <button className="icon-btn" title="View" aria-label={`View ${w.jobNo}`} onClick={() => openTrace(w.jobNo)}>
                                <Eye size={16} />
                              </button>
                              <DocButtons compact only="excel" build={(u) => docs.jobWorkReceiptSpec(state, w, u)} />
                              <button className="icon-btn" title="Print receipt challan" aria-label={`Print ${w.jobNo}`} onClick={() => printJobWorkReceipt(state, w)}>
                                <Printer size={16} />
                              </button>
                              <Write res="job_work">
                                <button className="icon-btn" title="Edit details" aria-label={`Edit ${w.jobNo}`} onClick={() => setEditing(w)}>
                                  <Pencil size={16} />
                                </button>
                                <button className="icon-btn danger" title={reason ?? 'Delete'} aria-label={`Delete ${w.jobNo}`} disabled={!!reason} onClick={() => setDeleting(w)}>
                                  <Trash2 size={16} />
                                </button>
                              </Write>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pg.pager}
              </div>
            )}
          </>
        )}
      </div>
      )}
      {editing && <JobWorkEdit w={editing} onClose={() => setEditing(null)} />}
      <Confirm
        open={!!deleting}
        title="Delete job-work batch"
        message={deleting ? `Delete ${deleting.jobNo}? No work has started on it, so the receipt and its job card are removed.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run((ts) => api.deleteJobWork(deleting.jobNo, ts), { title: 'Job-work batch deleted', message: deleting.jobNo })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

// ============================================================== edit a received batch ===
/** Correct the challan, description, weight, customer, due date and charges. Quantity, processes and material stay as received (they drive stock). */
function JobWorkEdit({ w, onClose }: { w: JobWork; onClose: () => void }) {
  const { state, run, busy } = useStore();
  const { can } = useAccess();
  const job = state.jobs.find((j) => j.jobNo === w.jobNo);
  const [f, setF] = useState({ customer: job?.customer ?? '', challanNo: w.challanNo, challanDate: w.challanDate ?? '', itemDescription: w.itemDescription, weight: w.receivedWeight ? String(w.receivedWeight) : '', dueDate: job?.dueDate ?? '' });
  const [basis, setBasis] = useState<JobWork['chargeBasis']>(w.chargeBasis);
  const [rate, setRate] = useState(w.rate ? String(w.rate) : '');
  const [pRates, setPRates] = useState<Record<string, string>>(Object.fromEntries(Object.entries(w.processRates ?? {}).map(([k, v]) => [k, String(v)])));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const valid = !can('party_names') || f.customer.trim() !== '';

  const submit = async () => {
    const processRates: Record<string, number> = {};
    for (const x of PROCESSES) if (w.processes[x.key] && Number(pRates[x.key]) > 0) processRates[x.key] = Number(pRates[x.key]);
    const input = {
      customer: f.customer,
      challanNo: f.challanNo,
      challanDate: f.challanDate,
      itemDescription: f.itemDescription,
      receivedWeight: Number(f.weight) > 0 ? Number(f.weight) : undefined,
      dueDate: f.dueDate,
      chargeBasis: can('sales_rates') ? basis : w.chargeBasis,
      rate: can('sales_rates') && (basis === 'piece' || basis === 'kg') && Number(rate) > 0 ? Number(rate) : undefined,
      processRates: can('sales_rates') && basis === 'process' ? processRates : undefined,
    };
    if (await run((ts) => api.editJobWork(w.jobNo, input, ts), { title: 'Job work updated', message: w.jobNo })) onClose();
  };

  return (
    <Modal
      dialog
      open
      onClose={onClose}
      size="lg"
      icon={Pencil}
      title={`Edit ${w.jobNo}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            Save changes
          </button>
        </>
      }
    >
      <div className="callout info" style={{ marginBottom: 16 }}>
        <Pencil size={16} />
        <div>
          Quantity ({fmtNum(w.receivedQty)} PCS), processes and material source stay as received because they drive stock. To change those, delete the batch (before work starts) and receive it again.
        </div>
      </div>
      <div className="form-grid three">
        <Field label="Customer" required={can('party_names')}>
          <CustomerSelect value={f.customer} onChange={(name) => set('customer', name)} required={can('party_names')} />
        </Field>
        <Field label="Customer Challan No.">
          <input className="input" value={f.challanNo} onChange={(e) => set('challanNo', e.target.value)} />
        </Field>
        <Field label="Challan Date">
          <input className="input" type="date" max={todayISO()} value={f.challanDate} onChange={(e) => set('challanDate', e.target.value)} />
        </Field>
        <Field label="Weight Received">
          <NumInput value={f.weight} onChange={(v) => set('weight', v)} suffix="KG" step="any" />
        </Field>
        <Field label="Due Date">
          <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      {can('sales_rates') && (
        <>
          <div className="section-label">Charges (confidential)</div>
          <div className="form-grid three">
            <Field label="Charged">
              <select value={basis} onChange={(e) => setBasis(e.target.value as JobWork['chargeBasis'])}>
                <option value="none">Not recorded</option>
                <option value="piece">Per piece</option>
                <option value="kg">Per kg</option>
                <option value="process">Per process</option>
              </select>
            </Field>
            {(basis === 'piece' || basis === 'kg') && (
              <Field label={basis === 'piece' ? 'Rate per piece' : 'Rate per kg'}>
                <NumInput value={rate} onChange={setRate} suffix={basis === 'piece' ? '₹ / pc' : '₹ / kg'} step="any" />
              </Field>
            )}
            {basis === 'process' &&
              PROCESSES.filter((x) => w.processes[x.key]).map((x) => (
                <Field key={x.key} label={`${x.label} — per piece`}>
                  <NumInput value={pRates[x.key] ?? ''} onChange={(v) => setPRates((r) => ({ ...r, [x.key]: v }))} suffix="₹ / pc" step="any" />
                </Field>
              ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ============================================================== the form ===
/** one line of the receipt as typed */
interface LineIn { item: string; material: string; size: string; productId: string; auto: boolean; qty: string; weight: string }
const blankLine = (): LineIn => ({ item: 'Round Bar', material: '', size: '', productId: '', auto: true, qty: '', weight: '' });

/**
 * Receive a customer's material for job work: one receipt (challan) with one or more lines — e.g. 70 mm Round Bar 100 KG and
 * 25 mm Round Bar 150 KG. Each line becomes its own job card; the processes, material source, QC, due date and charges are the
 * same for the whole receipt. The customer's material is tracked in Job Work → Party Inventory, never in our Raw Material Inventory.
 */
export function JobWorkForm({ onClose }: { onClose: () => void }) {
  const { state, run, busy } = useStore();
  const { can } = useAccess();
  const [f, setF] = useState({ customer: '', challanNo: '', challanDate: todayISO(), dueDate: '' });
  const [lines, setLines] = useState<LineIn[]>([blankLine()]);
  const [proc, setProc] = useState<Proc>({ cutting: false, forging: false, trimming: false, heatTreatment: true });
  const [source, setSource] = useState<'customer' | 'own'>('customer');
  const [qcRequired, setQcRequired] = useState(true);
  const [basis, setBasis] = useState<JobWork['chargeBasis']>('none');
  const [rate, setRate] = useState('');
  const [pRates, setPRates] = useState<Record<string, string>>({});
  const doc = useDocNo('job', true);
  const st = useStock();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const anyProcess = proc.cutting || proc.forging || proc.trimming || proc.heatTreatment;
  const src = source; // our own stock: raw bar when Cutting is ticked, otherwise our stock of parts (Product Master) that are ready for the first process
  const firstKey = PROCESSES.find((x) => proc[x.key])?.key;
  const first = PROCESSES.find((x) => proc[x.key]);

  // the product a line's job card makes: picked by hand, or found from the material and size when exactly one product matches
  const matchProduct = (material: string, size: string) => {
    const m = material.trim().toLowerCase();
    const od = Number(size);
    if (!m && !(od > 0)) return '';
    const hits = state.products.filter((p) => (!m || p.material.toLowerCase().includes(m)) && (!(od > 0) || p.od === od));
    return hits.length === 1 ? hits[0].id : '';
  };
  const setLine = (i: number, patch: Partial<LineIn>) =>
    setLines((ls) =>
      ls.map((l, k) => {
        if (k !== i) return l;
        const n = { ...l, ...patch };
        if (('material' in patch || 'size' in patch) && n.auto) n.productId = matchProduct(n.material, n.size);
        return n;
      }),
    );
  const ownAvailOf = (productId: string) => {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return 0;
    return proc.cutting ? state.rawMaterials.filter((l) => l.material === product.material && l.od === product.od).reduce((t, l) => t + l.availableQty, 0) : firstKey ? st.semiOf(product.id, firstKey)?.available ?? 0 : 0;
  };
  const lineErr = (l: LineIn): string | null => {
    const q = Number(l.qty);
    if (!l.item.trim()) return 'Enter the item';
    if (!l.productId) return 'Choose the product it is made into';
    if (l.qty === '' || !(q > 0) || !Number.isInteger(q)) return 'Enter a whole number of pieces';
    if (src === 'customer' && !(Number(l.weight) > 0)) return 'Enter the weight in KG';
    if (l.size !== '' && !(Number(l.size) > 0)) return 'Size must be above 0';
    if (src === 'own' && q > ownAvailOf(l.productId)) return `Only ${fmtNum(ownAvailOf(l.productId))} PCS in our stock`;
    return null;
  };
  const errs = lines.map(lineErr);
  const totalQty = lines.reduce((t, l) => t + (Number(l.qty) || 0), 0);
  const totalKg = Math.round(lines.reduce((t, l) => t + (Number(l.weight) || 0), 0) * 1000) / 1000;
  const valid = lines.length > 0 && errs.every((e) => !e) && anyProcess && (!can('party_names') || f.customer.trim() !== '');
  // material names already known: Material Master families and materials, and what earlier receipts used
  const materialHints = useMemo(() => [...new Set([...MATERIAL_FAMILIES, ...state.jobWork.map((w) => w.material ?? '')].filter(Boolean))].sort(), [state.jobWork]);

  const submit = async () => {
    const processRates: Record<string, number> = {};
    for (const x of PROCESSES) if (proc[x.key] && Number(pRates[x.key]) > 0) processRates[x.key] = Number(pRates[x.key]);
    const header = {
      customer: f.customer,
      challanNo: f.challanNo,
      challanDate: f.challanDate,
      materialSource: src,
      processes: proc,
      qcRequired,
      chargeBasis: can('sales_rates') ? basis : ('none' as const),
      rate: can('sales_rates') && (basis === 'piece' || basis === 'kg') && Number(rate) > 0 ? Number(rate) : undefined,
      processRates: can('sales_rates') && basis === 'process' ? processRates : undefined,
      dueDate: f.dueDate,
    };
    const body: api.JobWorkLine[] = lines.map((l) => ({ itemName: l.item, material: l.material, sizeMm: Number(l.size) > 0 ? Number(l.size) : undefined, productId: l.productId, receivedQty: Number(l.qty), receivedWeight: Number(l.weight) > 0 ? Number(l.weight) : undefined }));
    // a typed job number only makes sense for a one-line receipt; several lines are numbered automatically
    const custom = lines.length === 1 ? doc.custom : undefined;
    const ok = await withDocNo(custom, () =>
      run((ts) => api.receiveJobWork(header, body, ts), {
        title: 'Material received',
        message: `${lines.length} line${lines.length === 1 ? '' : 's'} · ${fmtNum(totalQty)} PCS${totalKg ? ` · ${totalKg} KG` : ''} — ${lines.length === 1 ? 'a job card was' : `${lines.length} job cards were`} created at ${first?.label}.`,
      }),
    );
    if (ok) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Handshake}
      title="Receive Material for Job Work"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            <Handshake size={15} /> Receive {lines.length > 1 ? `${lines.length} Items` : 'Material'}
          </button>
        </>
      }
    >
      <div className="section-label">Receipt</div>
      <div className="form-grid three">
        {lines.length === 1 ? (
          <DocNoField label="Job Card No." no={doc.no} setNo={doc.setNo} />
        ) : (
          <Field label="Job Card No." hint="One job card per line, numbered automatically">
            <input className="input" readOnly value={`${lines.length} job cards`} />
          </Field>
        )}
        <Field label="Customer" required={can('party_names')}>
          <CustomerSelect value={f.customer} onChange={(name) => set('customer', name)} required={can('party_names')} />
        </Field>
        <Field label="Customer Challan No.">
          <input className="input" value={f.challanNo} onChange={(e) => set('challanNo', e.target.value)} placeholder="Their delivery challan" />
        </Field>
        <Field label="Challan Date">
          <input className="input" type="date" max={todayISO()} value={f.challanDate} onChange={(e) => set('challanDate', e.target.value)} />
        </Field>
      </div>

      <div className="section-label">Items received</div>
      <datalist id="jw-items">
        {['Round Bar', 'Hex Bar', 'Square Bar', 'Flat Bar', 'Billet', 'Forged Parts', 'Machined Parts'].map((x) => <option key={x} value={x} />)}
      </datalist>
      <datalist id="jw-materials">
        {materialHints.map((x) => <option key={x} value={x} />)}
      </datalist>
      <div className="table-wrap">
        <table className="tbl form-tbl">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ minWidth: 130 }}>Item *</th>
              <th style={{ minWidth: 120 }}>Material</th>
              <th style={{ width: 100 }}>Size (mm)</th>
              <th style={{ width: 110 }} className="r">Qty (PCS) *</th>
              <th style={{ width: 120 }} className="r">Weight (KG){src === 'customer' ? ' *' : ''}</th>
              <th style={{ minWidth: 170 }}>Made into (job card) *</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="center muted">{i + 1}</td>
                <td><input list="jw-items" value={l.item} onChange={(e) => setLine(i, { item: e.target.value })} placeholder="Round Bar" /></td>
                <td><input list="jw-materials" value={l.material} onChange={(e) => setLine(i, { material: e.target.value })} placeholder="e.g. Brass" /></td>
                <td><input type="number" min="0" step="any" className="right" value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} placeholder="e.g. 70" /></td>
                <td><input type="number" min="0" step="1" className="right" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                <td><input type="number" min="0" step="any" className="right" value={l.weight} onChange={(e) => setLine(i, { weight: e.target.value })} /></td>
                <td>
                  <select value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value, auto: false })} title="The product this line's job card makes — it gives the cutting length, die and heat-treatment settings">
                    <option value="">Select product…</option>
                    {state.products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} · Ø{p.od}</option>
                    ))}
                  </select>
                  {errs[i] && <div className="text-xs" style={{ color: 'var(--crit)', marginTop: 4 }}>{errs[i]}</div>}
                </td>
                <td className="center">
                  <button type="button" className="icon-btn danger" title="Remove this line" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  <Plus size={14} /> Add Item
                </button>
              </td>
              <td className="r num strong">{fmtNum(totalQty)}</td>
              <td className="r num strong">{totalKg ? `${totalKg} KG` : '—'}</td>
              <td colSpan={2} className="text-xs muted">{lines.length} line{lines.length === 1 ? '' : 's'}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="section-label">Work to be done</div>
      <div className="check-row">
        {PROCESSES.map((x) => (
          <label key={x.key} className={`check ${proc[x.key] ? 'on' : ''}`}>
            <input type="checkbox" checked={proc[x.key]} onChange={(e) => setProc((p) => ({ ...p, [x.key]: e.target.checked }))} />
            {x.label}
          </label>
        ))}
      </div>
      <div className="form-grid three" style={{ marginTop: 16 }}>
        <Field label="Material" hint={src === 'own' ? (proc.cutting ? 'Our raw bar — issued oldest-first when Cutting starts' : "Our parts — taken from the product's stock in Product Master") : "The customer's — kept in Party Inventory, never in our stock"}>
          <select value={src} onChange={(e) => setSource(e.target.value as 'customer' | 'own')}>
            <option value="customer">Customer's material</option>
            <option value="own">Our material</option>
          </select>
        </Field>
        <Field label="Quality Check">
          <label className={`check ${qcRequired ? 'on' : ''}`}>
            <input type="checkbox" checked={qcRequired} onChange={(e) => setQcRequired(e.target.checked)} />
            QC and hardness report required
          </label>
        </Field>
        <Field label="Due Date">
          <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>
      {can('sales_rates') && (
        <>
          <div className="section-label">Charges (confidential)</div>
          <div className="form-grid three">
            <Field label="Charged">
              <select value={basis} onChange={(e) => setBasis(e.target.value as JobWork['chargeBasis'])}>
                <option value="none">Not recorded</option>
                <option value="piece">Per piece</option>
                <option value="kg">Per kg</option>
                <option value="process">Per process</option>
              </select>
            </Field>
            {(basis === 'piece' || basis === 'kg') && (
              <Field label={basis === 'piece' ? 'Rate per piece' : 'Rate per kg'}>
                <NumInput value={rate} onChange={setRate} suffix={basis === 'piece' ? '₹ / pc' : '₹ / kg'} step="any" />
              </Field>
            )}
            {basis === 'process' &&
              PROCESSES.filter((x) => proc[x.key]).map((x) => (
                <Field key={x.key} label={`${x.label} — per piece`}>
                  <NumInput value={pRates[x.key] ?? ''} onChange={(v) => setPRates((r) => ({ ...r, [x.key]: v }))} suffix="₹ / pc" step="any" />
                </Field>
              ))}
          </div>
        </>
      )}
      {valid && first && (
        <div className="callout info" style={{ marginTop: 16 }}>
          <Handshake size={16} />
          <div>
            Creates {lines.length === 1 ? 'a job card' : <b>{lines.length} job cards</b>} ({fmtNum(totalQty)} PCS{totalKg ? `, ${totalKg} KG` : ''}) that start at <b>{first.label}</b>
            {PROCESSES.some((x) => !proc[x.key]) ? ` — ${PROCESSES.filter((x) => !proc[x.key]).map((x) => x.label).join(', ')} are skipped` : ''}.
          </div>
        </div>
      )}
    </Modal>
  );
}
