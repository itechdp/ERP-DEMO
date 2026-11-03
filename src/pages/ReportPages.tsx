import * as api from '../db/api';
import { Conf, Write, searchable, canSee, useAccess } from '../auth/access';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Eye, Package, Pencil, Plus, ScrollText, Waypoints, Trash2 } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { jobDeleteReason, productDeleteReason } from '../store/deletable';
import { jobSummary, PROCESS_STAGES, STAGE_LABEL } from '../store/engine';
import { MATERIAL_FAMILIES, MATERIAL_MASTER, findMaterial } from '../store/materials';
import { ADD_NEW, useAddMaterial } from '../masters/AddItem';
import { CustomerSelect } from '../masters/CustomerSelect';
import type { HardnessScale, Product } from '../store/types';
import { DEFAULT_FLOW, saveProductFlow, useProductFlows } from '../products/flow';
import { Badge, Empty, Field, JobLink, Modal, NumInput, PageHeader, Priority, rowTone, Search, Stepper, FilterMenu, Confirm } from '../components/ui';
import { fmtDate, fmtDateTime, fmtNum, matches, plural } from '../components/format';

// ------------------------------------------------------- Job Traceability ---
export function TraceabilityPage() {
  const { state, openTrace, run } = useStore();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'wip' | 'done'>('all');
  const [productF, setProductF] = useState('all');
  const [stageF, setStageF] = useState('all');
  const rows = state.jobs
    .map((j) => jobSummary(state, j.jobNo))
    .filter((s) => (f === 'all' ? true : f === 'wip' ? s.flowIndex >= 1 && s.flowIndex <= 6 : s.flowIndex === 7))
    .filter((s) => productF === 'all' || s.product.id === productF)
    .filter((s) => stageF === 'all' || s.job.currentStage === stageF)
    .filter((s) => matches(q, s.job.jobNo, s.product.name, searchable(s.job.customer), STAGE_LABEL[s.job.currentStage]))
    .reverse();
  const wip = state.jobs.filter((j) => !['dispatched', 'scrapped'].includes(j.currentStage)).length;

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Job Traceability"
      />
      <div className="card">
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search job, product, customer, stage…' : 'Search job, product, stage…'} />
          <FilterMenu
            groups={[
              {
                label: 'Status',
                value: f,
                onChange: (v) => setF(v as 'all' | 'wip' | 'done'),
                options: [
                  { value: 'all', label: 'All jobs', count: state.jobs.length },
                  { value: 'wip', label: 'In production / FG', count: wip },
                  { value: 'done', label: 'Dispatched', count: state.jobs.filter((j) => j.currentStage === 'dispatched').length },
                ],
              },
              { label: 'Product', value: productF, onChange: setProductF, options: [{ value: 'all', label: 'All products' }, ...state.products.map((p) => ({ value: p.id, label: p.name }))] },
              { label: 'Current stage', value: stageF, onChange: setStageF, options: [{ value: 'all', label: 'All stages' }, ...[...new Set(state.jobs.map((j) => j.currentStage))].map((s) => ({ value: s, label: STAGE_LABEL[s] ?? s }))] },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon={Waypoints} title="No jobs match" />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job No.</th>
                  <th>Product / Customer</th>
                  <th className="r">Raw Issued</th>
                  {PROCESS_STAGES.map((s) => (
                    <th key={s} className="r">
                      {STAGE_LABEL[s]}
                    </th>
                  ))}
                  <th className="r">QC Acc / Rej</th>
                  <th className="r">Dispatched</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.job.jobNo} className={rowTone(s.status)}>
                    <td>
                      <JobLink jobNo={s.job.jobNo} />
                      <div className="sub">{fmtDate(s.job.createdAt)}</div>
                    </td>
                    <td>
                      <div className="strong">{s.product.name}</div>
                      <div className="sub">
                        <Conf g="party_names">{s.job.customer} · </Conf>
                        <Priority p={s.job.priority} />
                      </div>
                    </td>
                    <td className="r qty-cell">{s.issuedQty ? fmtNum(s.issuedQty) : <span className="muted">—</span>}</td>
                    {PROCESS_STAGES.map((st) => {
                      const r = s.records[st];
                      return (
                        <td key={st} className="r nowrap">
                          {r?.status === 'Completed' ? (
                            <>
                              <span className="gain">{fmtNum(r.output)}</span>
                              {r.loss > 0 && <div className="sub loss">−{r.loss}</div>}
                            </>
                          ) : r ? (
                            <span className={r.status === 'Pending' ? 'chip chip-wait' : 'chip chip-run'}>{r.status === 'Pending' ? 'Waiting' : 'Running'}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="r nowrap">
                      {s.qc && s.qc.status !== 'QC Pending' ? (
                        <>
                          <span className="gain">{s.qc.accepted}</span> / <span className={s.qc.rejected ? 'loss' : 'muted'}>{s.qc.rejected}</span>
                        </>
                      ) : s.qc ? (
                        <span className="chip chip-wait">Waiting</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="r qty-cell">{s.dispatchedQty ? fmtNum(s.dispatchedQty) : <span className="muted">—</span>}</td>
                    <td>
                      <Stepper index={s.flowIndex} />
                    </td>
                    <td>
                      <Badge status={s.status} />
                    </td>
                    <td className="r nowrap">
                      <div className="icon-actions">
                        <button className="icon-btn" title="View" aria-label={`View ${s.job.jobNo}`} onClick={() => openTrace(s.job.jobNo)}>
                          <Eye size={16} />
                        </button>
                        <Write res="cutting">
                          <button className="icon-btn danger" title={jobDeleteReason(state, s.job.jobNo) ?? 'Delete job card'} aria-label={`Delete ${s.job.jobNo}`} disabled={!!jobDeleteReason(state, s.job.jobNo)} onClick={() => setDeleting(s.job.jobNo)}>
                            <Trash2 size={16} />
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
      </div>
      <Confirm
        open={!!deleting}
        title="Delete job card"
        message={deleting ? `Delete job card ${deleting}? It has not started in production, so nothing has been issued or entered against it.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run((ts) => api.deleteJob(deleting, ts), { title: 'Job card deleted', message: deleting })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

// ------------------------------------------------------- Quantity Ledger ---
export function LedgerPage() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [fromF, setFromF] = useState('all');
  const [toF, setToF] = useState('all');
  const [lossF, setLossF] = useState('all');
  const rows = state.movements
    .filter((m) => fromF === 'all' || m.from === fromF)
    .filter((m) => toF === 'all' || m.to === toF)
    .filter((m) => lossF === 'all' || (lossF === 'loss' ? m.loss > 0 : m.loss === 0))
    .filter((m) => matches(q, m.jobNo, m.from, m.to, m.note));
  const distinct = (pick: (m: (typeof state.movements)[number]) => string) => [...new Set(state.movements.map(pick))].sort().map((v) => ({ value: v, label: v }));
  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Quantity Movement Ledger"
      />
      <div className="card">
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Search job, stage, lot, vehicle…" />
          <FilterMenu
            groups={[
              { label: 'From', value: fromF, onChange: setFromF, options: [{ value: 'all', label: 'Any' }, ...distinct((m) => m.from)] },
              { label: 'To', value: toF, onChange: setToF, options: [{ value: 'all', label: 'Any' }, ...distinct((m) => m.to)] },
              { label: 'Loss', value: lossF, onChange: setLossF, options: [{ value: 'all', label: 'All movements' }, { value: 'loss', label: 'With loss' }, { value: 'none', label: 'No loss' }] },
            ]}
          />
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
            {plural(rows.length, 'movement')}
          </span>
        </div>
        {rows.length === 0 && <Empty icon={ScrollText} title="No quantity movements yet" text="Every inward, stage transfer, QC result and dispatch is recorded here." />}
        <div className="table-wrap" hidden={rows.length === 0}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Job No.</th>
                <th>From</th>
                <th />
                <th>To</th>
                <th className="r">Qty Moved</th>
                <th className="r">Loss</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="nowrap">{fmtDateTime(m.ts)}</td>
                  <td>{m.jobNo !== '—' ? <JobLink jobNo={m.jobNo} /> : <span className="muted">—</span>}</td>
                  <td>{m.from}</td>
                  <td>
                    <ArrowRight size={14} className="muted" />
                  </td>
                  <td className="strong">{m.to}</td>
                  <td className="r qty-cell">{fmtNum(m.qty)}</td>
                  <td className="r">{m.loss ? <span className="loss">−{m.loss}</span> : <span className="muted">0</span>}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {m.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------- Product Master ---
export function ProductsPage() {
  const { state, openAction, run } = useStore();
  const [deleting, setDeleting] = useState<Product | null>(null);
  const { canWrite } = useAccess();
  const mgmt = canWrite('products');
  const add = (
    <button className="btn btn-primary" onClick={() => openAction({ kind: 'product' })}>
      <Plus size={15} /> Add Product
    </button>
  );
  return (
    <>
      <PageHeader eyebrow="Masters" title="Product Master" actions={mgmt && state.products.length > 0 ? add : undefined} />
      <div className="card">
        {state.products.length === 0 ? (
          <Empty
            icon={Package}
            title="No products yet"
            text={mgmt ? 'Add the components you forge — code, raw material, cutting length, finished weight and heat-treatment settings. Job cards are created from these.' : 'The Director or Plant Head adds products here. Job cards are created from them.'}
            action={mgmt ? add : undefined}
          />
        ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Product</th>
                <th>Raw Material</th>
                <th className="r">Cut Length</th>
                <th className="r">Finished Wt.</th>
                <Conf col="product.die_no">
                  <th>Forging Die</th>
                </Conf>
                <th className="r">HT Temp.</th>
                <th>HT Process</th>
                <Conf g="party_names">
                  <th>Default Customer</th>
                </Conf>
                <Conf g="sales_rates">
                  <th className="r">Sales Rate</th>
                </Conf>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.products.map((p) => (
                <tr key={p.id}>
                  <td className="mono strong">{p.code}</td>
                  <td className="strong">{p.name}</td>
                  <td>
                    {p.material}
                    <div className="sub">OD {p.od} mm</div>
                  </td>
                  <td className="r num">{p.cuttingLength} mm</td>
                  <td className="r num">{p.finishedWeight} kg</td>
                  <Conf col="product.die_no">
                    <td className="mono">{p.dieNo}</td>
                  </Conf>
                  <td className="r strong nowrap">{p.htTemperature}°C</td>
                  <td>
                    {p.htProcess}
                    <div className="sub">
                      {p.htSoakMinutes} min · {p.htQuench}
                    </div>
                  </td>
                  <Conf g="party_names">
                    <td>{p.defaultCustomer || '—'}</td>
                  </Conf>
                  <Conf g="sales_rates">
                    <td className="r num nowrap">{p.salesRate ? `₹ ${p.salesRate.toLocaleString('en-IN')} / pc` : '—'}</td>
                  </Conf>
                  <td className="r nowrap">
                    <div className="icon-actions">
                      <button className="icon-btn" title="View" aria-label={`View ${p.code}`} onClick={() => openAction({ kind: 'product', id: p.id, view: true })}>
                        <Eye size={16} />
                      </button>
                      {mgmt && (
                        <>
                          <button className="icon-btn" title="Edit" aria-label={`Edit ${p.code}`} onClick={() => openAction({ kind: 'product', id: p.id })}>
                            <Pencil size={16} />
                          </button>
                          <button className="icon-btn danger" title={productDeleteReason(state, p.id) ?? 'Delete'} aria-label={`Delete ${p.code}`} disabled={!!productDeleteReason(state, p.id)} onClick={() => setDeleting(p)}>
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
      <Confirm
        open={!!deleting}
        title="Delete product"
        message={deleting ? `Delete ${deleting.code} · ${deleting.name}? No job card has been made from it.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run(() => api.deleteProduct(deleting.id), { title: 'Product deleted', message: `${deleting.code} · ${deleting.name}` })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

export function ProductModal({ id, viewOnly, onClose }: { id?: string; viewOnly?: boolean; onClose: () => void }) {
  const { state, run } = useStore();
  const { can } = useAccess();
  const cur = id ? state.products.find((p) => p.id === id) : undefined;
  const [f, setF] = useState({
    code: cur?.code ?? '',
    name: cur?.name ?? '',
    material: cur?.material ?? '',
    od: cur ? String(cur.od) : '',
    cuttingLength: cur ? String(cur.cuttingLength) : '',
    finishedWeight: cur ? String(cur.finishedWeight) : '',
    dieNo: cur?.dieNo ?? '',
    htTemperature: cur ? String(cur.htTemperature) : '',
    htSoakMinutes: cur ? String(cur.htSoakMinutes) : '',
    htProcess: cur?.htProcess ?? '',
    htQuench: cur?.htQuench ?? '',
    defaultCustomer: cur?.defaultCustomer ?? '',
    salesRate: cur?.salesRate ? String(cur.salesRate) : '',
  });
  // work to be done and hardness (Product Master): saved beside the product, read again when it opens
  const pf = useProductFlows();
  const [flow, setFlow] = useState(DEFAULT_FLOW);
  const [hMin, setHMin] = useState('');
  const [hMax, setHMax] = useState('');
  const flowLoaded = useRef(false);
  useEffect(() => {
    const saved = id ? pf.flows[id] : undefined;
    if (!saved || flowLoaded.current) return;
    flowLoaded.current = true;
    setFlow(saved);
    setHMin(saved.hardnessMin ? String(saved.hardnessMin) : '');
    setHMax(saved.hardnessMax ? String(saved.hardnessMax) : '');
  }, [pf.flows, id]);
  const hardnessOk = !flow.hardnessRequired || (Number(hMin) > 0 && Number(hMax) >= Number(hMin));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pickMaterial = (m: string) => setF((x) => ({ ...x, material: m, od: x.od || String(findMaterial(m)?.defaultOd ?? '') }));
  const addMaterial = useAddMaterial((n) => pickMaterial(n));
  const valid = f.code.trim() && f.name.trim() && f.material && Number(f.od) > 0 && Number(f.cuttingLength) > 0 && Number(f.finishedWeight) > 0 && Number(f.htTemperature) > 0 && Number(f.htSoakMinutes) > 0 && hardnessOk;
  const submit = async () => {
    const input: Omit<Product, 'id'> = {
      code: f.code,
      name: f.name,
      material: f.material,
      od: Number(f.od),
      cuttingLength: Number(f.cuttingLength),
      finishedWeight: Number(f.finishedWeight),
      dieNo: f.dieNo,
      htTemperature: Number(f.htTemperature),
      htSoakMinutes: Number(f.htSoakMinutes),
      htProcess: f.htProcess,
      htQuench: f.htQuench,
      defaultCustomer: f.defaultCustomer,
      salesRate: Number(f.salesRate) > 0 ? Number(f.salesRate) : undefined,
    };
    const flowToSave = { ...flow, hardnessMin: flow.hardnessRequired ? Number(hMin) : undefined, hardnessMax: flow.hardnessRequired ? Number(hMax) : undefined };
    if (await run(async () => { const pid = await api.saveProduct(input, state.products, id); await saveProductFlow(pid || id || '', flowToSave); return pid; }, { title: id ? 'Product updated' : 'Product added', message: `${f.code.trim()} · ${f.name.trim()}` })) onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Package}
      viewOnly={!!viewOnly && !!id}
      title={id ? (viewOnly ? 'View Product' : 'Edit Product') : 'Add Product'}
      subtitle="Job cards pick these values up automatically: cutting length, die, finished weight and heat-treatment settings."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid} onClick={submit}>
            {id ? 'Save Changes' : 'Add Product'}
          </button>
        </>
      }
    >
      <div className="section-label">Product</div>
      <div className="form-grid three">
        <Field label="Product Code" required>
          <input className="input mono" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. BB-45" autoFocus />
        </Field>
        <Field label="Product Name" required>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Brass Bush" />
        </Field>
        <Conf col="product.die_no">
          <Field label="Forging Die No.">
            <input className="input mono" value={f.dieNo} onChange={(e) => set('dieNo', e.target.value)} placeholder="e.g. D-BB45-01" />
          </Field>
        </Conf>
        <Field label="Raw Material" required>
          <select value={f.material} onChange={(e) => (e.target.value === ADD_NEW ? addMaterial.open() : pickMaterial(e.target.value))}>
            <option value="">Select material…</option>
            {MATERIAL_FAMILIES.map((fam) => (
              <optgroup key={fam} label={fam}>
                {MATERIAL_MASTER.filter((m) => m.family === fam).map((m) => (
                  <option key={m.material} value={m.material}>
                    {m.material}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={ADD_NEW}>+ Add new material…</option>
          </select>
          {addMaterial.modal}
        </Field>
        <Field label="Bar OD" required>
          <NumInput value={f.od} onChange={(v) => set('od', v)} suffix="mm" step="any" />
        </Field>
        <Field label="Cutting Length" required>
          <NumInput value={f.cuttingLength} onChange={(v) => set('cuttingLength', v)} suffix="mm" step="any" />
        </Field>
        <Field label="Finished Weight" required hint="Per piece, after forging / trimming">
          <NumInput value={f.finishedWeight} onChange={(v) => set('finishedWeight', v)} suffix="kg" step="any" />
        </Field>
      </div>
      <div className="section-label">Heat treatment</div>
      <div className="form-grid three">
        <Field label="Temperature" required>
          <NumInput value={f.htTemperature} onChange={(v) => set('htTemperature', v)} suffix="°C" />
        </Field>
        <Field label="Soak Time" required>
          <NumInput value={f.htSoakMinutes} onChange={(v) => set('htSoakMinutes', v)} suffix="min" />
        </Field>
        <Field label="Process">
          <input className="input" value={f.htProcess} onChange={(e) => set('htProcess', e.target.value)} placeholder="e.g. Normalising" />
        </Field>
        <Field label="Quench">
          <input className="input" value={f.htQuench} onChange={(e) => set('htQuench', e.target.value)} placeholder="e.g. Still air" />
        </Field>
      </div>
      <div className="section-label">Work to be done</div>
      <div className="check-row">
        <label className="check on" title="Every job starts with cutting">
          <input type="checkbox" checked disabled readOnly />
          Cutting
        </label>
        {([['forging', 'Forging'], ['trimming', 'Trimming'], ['heatTreatment', 'Heat Treatment']] as const).map(([k, label]) => (
          <label key={k} className={`check ${flow[k] ? 'on' : ''}`}>
            <input type="checkbox" checked={flow[k]} onChange={(e) => setFlow((x) => ({ ...x, [k]: e.target.checked }))} />
            {label}
          </label>
        ))}
      </div>
      <div className="text-xs muted" style={{ marginTop: 6 }}>A job of this product passes straight over any process left unticked. For example Cutting + Trimming only does Cutting, then Trimming.</div>
      <div className="section-label">Hardness</div>
      <label className={`check ${flow.hardnessRequired ? 'on' : ''}`}>
        <input type="checkbox" checked={flow.hardnessRequired} onChange={(e) => setFlow((x) => ({ ...x, hardnessRequired: e.target.checked }))} />
        This product needs a hardness check
      </label>
      {flow.hardnessRequired && (
        <div className="form-grid three" style={{ marginTop: 12 }}>
          <Field label="Required hardness — from" required>
            <NumInput value={hMin} onChange={setHMin} step="any" />
          </Field>
          <Field label="to" required>
            <NumInput value={hMax} onChange={setHMax} step="any" />
          </Field>
          <Field label="Scale">
            <select value={flow.hardnessScale} onChange={(e) => setFlow((x) => ({ ...x, hardnessScale: e.target.value as HardnessScale }))}>
              {(['HRB', 'HRC', 'HV', 'HB'] as const).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {(can('party_names') || can('sales_rates')) && (
        <>
          <div className="section-label">Commercial (confidential)</div>
          <div className="form-grid">
            {can('party_names') && (
              <Field label="Default Customer">
                <CustomerSelect value={f.defaultCustomer} onChange={(name) => set('defaultCustomer', name)} />
              </Field>
            )}
            {can('sales_rates') && (
              <Field label="Sales Rate" hint="₹ per piece">
                <NumInput value={f.salesRate} onChange={(v) => set('salesRate', v)} suffix="₹" step="any" />
              </Field>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
