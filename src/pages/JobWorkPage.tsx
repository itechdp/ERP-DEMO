import * as api from '../db/api';
import { useMemo, useState } from 'react';
import { Eye, Handshake, Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { Conf, Write, canSee, searchable, useAccess } from '../auth/access';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { CustomerSelect } from '../masters/CustomerSelect';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { STAGE_LABEL } from '../store/engine';
import { jobWorkDeleteReason } from '../store/deletable';
import { Confirm, Empty, Field, FilterMenu, JobLink, Modal, NumInput, PageHeader, Search, Tabs } from '../components/ui';
import { JobCardReport } from '../jobwork/JobCardReport';
import { useStock } from '../stock/service';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { BASIS_LABEL, chargeText, printJobWorkReceipt, processText } from '../jobwork/print';
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
  const [tab0, setTab] = useState<'batches' | 'report'>('batches');
  const ta = useTabAccess('job_work', ['batches', 'report'] as const);
  const tab = ta.pick(tab0);

  const jobOf = (w: JobWork) => state.jobs.find((j) => j.jobNo === w.jobNo);
  const list = useMemo(() => [...state.jobWork].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.jobNo.localeCompare(a.jobNo)), [state.jobWork]);
  const rows = list
    .filter((w) => stageF === 'all' || jobOf(w)?.currentStage === stageF)
    .filter((w) => srcF === 'all' || w.materialSource === srcF)
    .filter((w) => matches(q, w.jobNo, w.challanNo, w.itemDescription, state.products.find((p) => p.id === jobOf(w)?.productId)?.name, searchable(jobOf(w)?.customer)));
  const pg = usePaged(rows, rows.length);
  const stages = [...new Set(list.map((w) => jobOf(w)?.currentStage).filter(Boolean))] as string[];

  const add = (
    <button className="btn btn-primary" onClick={() => openAction({ kind: 'jobWork' })}>
      <Plus size={15} /> Receive Parts
    </button>
  );

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Job Work In" actions={list.length > 0 ? <><ListButtons doc={() => ({ filename: 'Job-Work-In', title: 'Job Work In', form: FORM_FORMATS.report, rows: rows.map((w) => ({ job: w.jobNo, challan: w.challanNo, date: w.challanDate, item: w.itemDescription, customer: canSee('party_names') ? jobOf(w)?.customer : '', qty: w.receivedQty, weight: w.receivedWeight, source: w.materialSource === 'customer' ? 'Customer material' : 'Our material', stage: jobOf(w)?.currentStage })), cols: [{ label: 'Job No.', key: 'job' }, { label: 'Challan No.', key: 'challan' }, { label: 'Challan Date', key: 'date', kind: 'date' }, { label: 'Item', key: 'item', width: 28 }, { label: 'Customer', key: 'customer', width: 24 }, { label: 'Received (PCS)', key: 'qty', kind: 'num' }, { label: 'Weight (KG)', key: 'weight', kind: 'num' }, { label: 'Material', key: 'source', width: 18 }, { label: 'Now at', key: 'stage' }], totals: ['qty', 'weight'] })} /><Write res="job_work">{add}</Write></> : undefined} />
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} items={ta.only([{ value: 'batches', label: 'Job Work In', count: list.length }, { value: 'report', label: 'Job Card Report' }])} />
      </div>
      {tab === 'report' ? (
        <JobCardReport />
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
                            <div className="strong">{p?.name ?? '—'}</div>
                            {w.itemDescription && <div className="sub">{w.itemDescription}</div>}
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
        <Field label="Item Description" full>
          <input className="input" value={f.itemDescription} onChange={(e) => set('itemDescription', e.target.value)} />
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
/** Receive a customer's parts: what came in, which processes to do, whose material, QC, and how it is charged. */
export function JobWorkForm({ onClose }: { onClose: () => void }) {
  const { state, run, busy } = useStore();
  const { can } = useAccess();
  const [f, setF] = useState({ customer: '', challanNo: '', challanDate: todayISO(), productId: '', itemDescription: '', qty: '', weight: '', dueDate: '' });
  const [proc, setProc] = useState<Proc>({ cutting: false, forging: false, trimming: false, heatTreatment: true });
  const [source, setSource] = useState<'customer' | 'own'>('customer');
  const [qcRequired, setQcRequired] = useState(true);
  const [basis, setBasis] = useState<JobWork['chargeBasis']>('none');
  const [rate, setRate] = useState('');
  const [pRates, setPRates] = useState<Record<string, string>>({});
  const doc = useDocNo('job', true);
  const st = useStock();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const product = state.products.find((p) => p.id === f.productId);
  const qtyN = Number(f.qty);
  const anyProcess = proc.cutting || proc.forging || proc.trimming || proc.heatTreatment;
  const src = source; // our own stock: raw bar when Cutting is ticked, otherwise our stock of parts (Product Master) that are ready for the first process
  const firstKey = PROCESSES.find((x) => proc[x.key])?.key;
  const ownAvail = !product ? 0 : proc.cutting ? state.rawMaterials.filter((l) => l.material === product.material && l.od === product.od).reduce((t, l) => t + l.availableQty, 0) : firstKey ? st.semiOf(product.id, firstKey)?.available ?? 0 : 0;

  const errQty = f.qty === '' ? null : !(qtyN > 0) || !Number.isInteger(qtyN) ? 'Enter a whole number of pieces' : src === 'own' && qtyN > ownAvail ? (proc.cutting ? `Only ${fmtNum(ownAvail)} PCS of ${product?.material} OD ${product?.od} mm in our stock` : `Only ${fmtNum(ownAvail)} PCS of ${product?.name} in our stock, ready for ${PROCESSES.find((x) => x.key === firstKey)?.label ?? 'the first process'}`) : null;
  const valid = !!f.productId && qtyN > 0 && Number.isInteger(qtyN) && anyProcess && (!can('party_names') || f.customer.trim() !== '') && !errQty;
  const first = PROCESSES.find((x) => proc[x.key]);

  const submit = async () => {
    const processRates: Record<string, number> = {};
    for (const x of PROCESSES) if (proc[x.key] && Number(pRates[x.key]) > 0) processRates[x.key] = Number(pRates[x.key]);
    const input: api.JobWorkInput = {
      productId: f.productId,
      customer: f.customer,
      challanNo: f.challanNo,
      challanDate: f.challanDate,
      itemDescription: f.itemDescription,
      receivedQty: qtyN,
      receivedWeight: Number(f.weight) > 0 ? Number(f.weight) : undefined,
      materialSource: src,
      processes: proc,
      qcRequired,
      chargeBasis: can('sales_rates') ? basis : 'none',
      rate: can('sales_rates') && (basis === 'piece' || basis === 'kg') && Number(rate) > 0 ? Number(rate) : undefined,
      processRates: can('sales_rates') && basis === 'process' ? processRates : undefined,
      dueDate: f.dueDate,
    };
    if (await withDocNo(doc.custom, () => run((ts) => api.createJobWork(input, ts), { title: 'Parts received', message: `${fmtNum(qtyN)} PCS of ${product?.name} — job card created at ${first?.label}.` }))) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Handshake}
      title="Receive Parts for Job Work"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            <Handshake size={15} /> Receive Parts
          </button>
        </>
      }
    >
      <div className="section-label">Parts received</div>
      <div className="form-grid three">
        <DocNoField label="Job Card No." no={doc.no} setNo={doc.setNo} />
        <Field label="Customer" required={can('party_names')}>
          <CustomerSelect value={f.customer} onChange={(name) => set('customer', name)} required={can('party_names')} />
        </Field>
        <Field label="Customer Challan No.">
          <input className="input" value={f.challanNo} onChange={(e) => set('challanNo', e.target.value)} placeholder="Their delivery challan" />
        </Field>
        <Field label="Challan Date">
          <input className="input" type="date" max={todayISO()} value={f.challanDate} onChange={(e) => set('challanDate', e.target.value)} />
        </Field>
        <Field label="Item" required hint="From the Product Master — it gives the cutting length, die and heat-treatment settings">
          <select value={f.productId} onChange={(e) => set('productId', e.target.value)}>
            <option value="">Select item…</option>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity Received" required error={errQty}>
          <NumInput value={f.qty} onChange={(v) => set('qty', v)} bad={!!errQty} />
        </Field>
        <Field label="Weight Received" hint="Optional — used when charging per kg">
          <NumInput value={f.weight} onChange={(v) => set('weight', v)} suffix="KG" step="any" />
        </Field>
        <Field label="Item Description" full>
          <input className="input" value={f.itemDescription} onChange={(e) => set('itemDescription', e.target.value)} placeholder="Customer's part name / drawing no. / remarks" />
        </Field>
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
        <Field label="Material" hint={src === 'own' ? (proc.cutting ? `${product ? fmtNum(ownAvail) + ' PCS in our stock · ' : ''}issued oldest-first when Cutting starts` : `${product ? fmtNum(ownAvail) + ' PCS of our parts ready for ' + (first?.label ?? 'the first process') + ' · ' : ''}taken from the product's stock in Product Master`) : 'Nothing is taken from our stock'}>
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
            Creates a job card of <b>{fmtNum(qtyN)} PCS</b> {product?.name} that starts at <b>{first.label}</b>
            {PROCESSES.some((x) => !proc[x.key]) ? ` — ${PROCESSES.filter((x) => !proc[x.key]).map((x) => x.label).join(', ')} are skipped` : ''}.{' '}
            {chargeText({ jobNo: '', challanNo: '', challanDate: '', itemDescription: '', receivedQty: qtyN, materialSource: src, processes: proc, qcRequired, chargeBasis: can('sales_rates') ? basis : 'none', rate: Number(rate) || undefined, processRates: Object.fromEntries(Object.entries(pRates).map(([k, v]) => [k, Number(v) || 0])), billableQty: qtyN, createdAt: '' })}
          </div>
        </div>
      )}
    </Modal>
  );
}
