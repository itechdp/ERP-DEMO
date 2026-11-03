import * as api from '../db/api';
import { searchable, canSee, Write, Conf, searchableCol } from '../auth/access';
import { useMemo, useState } from 'react';
import { CheckCircle2, Eye, Play, Plus, Waypoints, Trash2 } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { jobDeleteReason } from '../store/deletable';
import { getJob, getProduct, parseMaterialKey, PROCESS_STAGES, STAGE_LABEL, stageRecords } from '../store/engine';
import type { ProcessStage, StageRecord } from '../store/types';
import { Badge, Empty, Field, FLOW_STEPS, InlineQty, JobLink, Modal, NumInput, PageHeader, QtyFlow, rowTone, Search, SummaryLine, FilterMenu, Confirm } from '../components/ui';
import { FifoPreview, tsFor } from '../components/NewJobModal';
import { nextStep } from '../components/workflow';
import { fmtNum, heatTempText, matches, todayISO } from '../components/format';
import { usePlan } from '../planning/usePlan';
import { useFurnaces } from '../furnaces/service';
import { useProductFlows } from '../products/flow';

/** why a waiting Heat Treatment batch cannot start: not approved yet, or no furnace assigned (when the plant has furnaces) */
export type Block = 'approval' | 'furnace' | null;
const BLOCK_TEXT: Record<Exclude<Block, null>, string> = { approval: 'Waiting for approval', furnace: 'Waiting for a furnace' };

const CFG: Record<ProcessStage, { title: string; from: string; to: string }> = {
  cutting: {
    title: 'Cutting',
    from: 'Raw Inventory',
    to: 'Forging',
  },
  forging: {
    title: 'Forging / Manufacturing',
    from: 'Cutting',
    to: 'Trimming',
  },
  trimming: {
    title: 'Trimming',
    from: 'Forging',
    to: 'Heat Treatment',
  },
  heatTreatment: {
    title: 'Heat Treatment',
    from: 'Trimming',
    to: 'QC',
  },
};

type Filter = 'all' | 'Pending' | 'Completed';

/** did the Forging form tick Skip Trimming / Skip Heat Treatment for this batch? (then it never reaches that stage) */
const batchSkips = (forging: { jobNo: string; params: Record<string, string | number> }[], jobNo: string, stage: ProcessStage) => {
  const f = forging.find((r) => r.jobNo === jobNo);
  return !!f && ((stage === 'trimming' && !!f.params.skipTrimming) || (stage === 'heatTreatment' && !!f.params.skipHeatTreatment));
};

export function StagePage({ stage }: { stage: ProcessStage }) {
  const { state, openAction, run } = useStore();
  const plan = usePlan();
  const fu = useFurnaces();
  const pflow = useProductFlows();
  const blockOf = (jobNo: string, st: ProcessStage): Block => (plan.blocked(jobNo, st) ? 'approval' : st === 'heatTreatment' && fu.hasFurnaces && !fu.loadOfJob(jobNo) ? 'furnace' : null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const cfg = CFG[stage];
  const step = FLOW_STEPS.find((s) => s.key === stage)!;
  // a batch that skipped this stage (ticked at Forging) never shows here — its skipped row only appears on the route card and traceability
  const recs = stageRecords(state, stage).filter((r) => !r.params.auto);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [productF, setProductF] = useState('all');

  // started-but-not-finished records (older data) count as pending: the card has no separate step
  const pending = recs.filter((r) => r.status !== 'Completed');
  const done = recs.filter((r) => r.status === 'Completed');
  const totIn = done.reduce((t, r) => t + r.input, 0);
  const totLoss = done.reduce((t, r) => t + r.loss, 0);
  const totOut = done.reduce((t, r) => t + r.output, 0);

  const rows = useMemo(() => {
    const order = { 'In Progress': 0, Pending: 1, Completed: 2 } as const;
    return recs
      .filter((r) => filter === 'all' || (filter === 'Completed' ? r.status === 'Completed' : r.status !== 'Completed'))
      .filter((r) => {
        const job = getJob(state, r.jobNo);
        const p = getProduct(state, job.productId);
        return (productF === 'all' || p.id === productF) && matches(q, r.jobNo, p.name, searchable(job.customer), searchableCol(r.machine, 'stage.machine'), searchableCol(r.operator, 'stage.operator'));
      })
      .sort((a, b) => order[a.status] - order[b.status] || (plan.find(a.jobNo, stage)?.rank ?? 1e9) - (plan.find(b.jobNo, stage)?.rank ?? 1e9) || (b.completedAt ?? b.receivedAt).localeCompare(a.completedAt ?? a.receivedAt));
  }, [recs, filter, q, productF, state, plan, stage]);

  // Jobs still upstream — they will arrive here later (demonstrates parallel stages)
  const idx = PROCESS_STAGES.indexOf(stage);
  const upstream = state.jobs
    .filter((j) => PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) > -1 && PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) < idx)
    .filter((j) => !batchSkips(state.forging, j.jobNo, stage))
    // a product that does not tick this process never reaches it (Product Master → Work to be done)
    .filter((j) => !((stage === 'trimming' && !pflow.of(j.productId).trimming) || (stage === 'heatTreatment' && !pflow.of(j.productId).heatTreatment)));

  return (
    <>
      <PageHeader
        eyebrow={`Workflow · Step ${FLOW_STEPS.indexOf(step) + 1} of 8`}
        title={cfg.title}
        flow={stage}
        actions={
          stage === 'cutting' && (
            <Write res="cutting"><button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}>
              <Plus size={16} /> New Job Card
            </button></Write>
          )
        }
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h3>{STAGE_LABEL[stage]} Jobs</h3>
          </div>
          {done.length > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: `PCS OK sent to ${cfg.to}`, value: fmtNum(totOut), tone: 'good' },
                  { label: `PCS rejection (${((totLoss / totIn) * 100).toFixed(2)}%)`, value: fmtNum(totLoss), tone: 'bad' },
                ]}
              />
            </div>
          )}
        </div>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search job, product, customer, machine…' : 'Search job, product, machine…'} />
          <FilterMenu
            groups={[
              {
                label: 'Status',
                value: filter,
                onChange: (v) => setFilter(v as Filter),
                options: [
                  { value: 'all', label: 'All', count: recs.length },
                  { value: 'Pending', label: 'Pending', count: pending.length },
                  { value: 'Completed', label: 'Completed', count: done.length },
                ],
              },
              { label: 'Product', value: productF, onChange: setProductF, options: [{ value: 'all', label: 'All products' }, ...state.products.map((p) => ({ value: p.id, label: p.name }))] },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty
            title={
              filter === 'all' && !q && !productF
                ? `No ${STAGE_LABEL[stage]} jobs yet`
                : filter === 'all'
                  ? 'No matching jobs'
                  : `No ${filter.toLowerCase()} ${STAGE_LABEL[stage]} jobs`
            }
            text={stage === 'cutting' ? 'Create a job card to start production.' : `Jobs appear here automatically once ${cfg.from} is completed.`}
            action={stage === 'cutting' && <Write res="cutting"><button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}><Plus size={15} /> New Job Card</button></Write>}
          />
        ) : (
          <div className="table-wrap">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Job Card No.</th>
                  <th>Item</th>
                  {stage === 'cutting' && <th>Material</th>}
                  {stage === 'heatTreatment' && <th className="r">Temp. (T1 / T2 / T3 / T4)</th>}
                  <th>Received → Rejection → OK</th>
                  <Conf col="stage.operator">
                    <th>Checked By</th>
                  </Conf>
                  <th>Status</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id} r={r} approval={plan.find(r.jobNo, stage)} block={r.status === 'Pending' ? blockOf(r.jobNo, stage) : null} onProcess={() => openAction({ kind: 'stage', stage, jobNo: r.jobNo })} deleteReason={jobDeleteReason(state, r.jobNo)} onDelete={() => setDeleting(r.jobNo)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {upstream.length > 0 && <UpstreamJobs jobNos={upstream.map((j) => j.jobNo)} />}
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

function Row({ r, approval, block, onProcess, deleteReason, onDelete }: { r: StageRecord; approval?: { rank: number }; block: Block; onProcess: () => void; deleteReason: string | null; onDelete: () => void }) {
  const { state, openTrace, toast } = useStore();
  const job = getJob(state, r.jobNo);
  const p = getProduct(state, job.productId);
  const mat = parseMaterialKey(job.materialKey);
  const canAct = r.status !== 'Completed';
  // Cutting only: is there enough of our own bar for this job card? (customer's material never uses our stock)
  const ownBar = (state.jobWork.find((w) => w.jobNo === r.jobNo)?.materialSource ?? 'own') === 'own';
  const barLeft = state.rawMaterials.filter((l) => `${l.material}|${l.od}` === job.materialKey).reduce((t, l) => t + l.availableQty, 0);
  const stockChip = r.stage === 'cutting' && r.status === 'Pending' && ownBar ? (barLeft <= 0 ? ['chip chip-hot', 'Not in stock'] : barLeft < r.input ? ['chip chip-wait', `Low in stock (${fmtNum(barLeft)} PCS)`] : null) : null;
  const act = () => {
    if (!canAct) return;
    if (block) return toast({ kind: 'info', title: block === 'approval' ? 'Not approved to start yet' : 'No furnace yet', message: block === 'approval' ? `${r.jobNo} must be approved in Heat Treatment Planning (with its rank) before ${STAGE_LABEL[r.stage]} can start.` : `${r.jobNo} needs a furnace: assign one in Heat Treatment Planning (on hold until one is free).` });
    onProcess();
  };
  return (
    <tr
      className={`${rowTone(r.status === 'Completed' ? 'Completed' : 'Pending')} ${canAct ? 'row-click' : ''}`}
      onClick={act}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          act();
        }
      }}
      tabIndex={canAct ? 0 : undefined}
      title={canAct ? `Enter quantity for ${r.jobNo}` : undefined}
    >
      <td>
        <JobLink jobNo={r.jobNo} />
      </td>
      <td className="strong nowrap">{p.name}</td>
      {r.stage === 'cutting' && (
        <td>
          <div className="nowrap">{mat.material}</div>
          <div className="sub">
            Ø{mat.od} · {r.params.cuttingLength} mm{job.pieceWeightG ? ` · ${job.pieceWeightG} g` : ''}
          </div>
        </td>
      )}
      {r.stage === 'heatTreatment' && <td className="r strong nowrap">{r.params.skipped ? '—' : heatTempText(r.params)}</td>}
      <td>
        {r.params.skipped ? (
          <span className="chip chip-skip">Not required — skipped</span>
        ) : r.status === 'Completed' ? (
          <InlineQty input={r.input} loss={r.loss} output={r.output} />
        ) : (
          <span className="inline-q">
            {fmtNum(r.input)} <span className="muted" style={{ fontWeight: 500 }}>PCS {r.stage === 'cutting' ? 'to cut' : 'received'}</span>
          </span>
        )}
      </td>
      <Conf col="stage.operator">
        <td>{r.operator || <span className="muted">—</span>}</td>
      </Conf>
      <td>
        <Badge status={r.status === 'Completed' ? 'Completed' : 'Pending'} />
        {r.status !== 'Completed' && approval && <div className="sub"><span className="chip chip-up">Approved #{approval.rank}</span></div>}
        {block && <div className="sub"><span className="chip chip-wait">{BLOCK_TEXT[block]}</span></div>}
        {stockChip && <div className="sub"><span className={stockChip[0]}>{stockChip[1]}</span></div>}
      </td>
      <td className="r nowrap">
        <div className="icon-actions">
          <button
            className="icon-btn"
            title="View"
            aria-label={`View ${r.jobNo}`}
            onClick={(e) => {
              e.stopPropagation();
              openTrace(r.jobNo);
            }}
          >
            <Eye size={16} />
          </button>
          <Write res="cutting">
            <button
              className="icon-btn danger"
              title={deleteReason ?? 'Delete job card'}
              aria-label={`Delete ${r.jobNo}`}
              disabled={!!deleteReason}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 size={16} />
            </button>
          </Write>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
/** One row of the route card: Inward Date, Received Qty, Rejection Qty, OK Qty, Checked By. */
export function StageModal({ stage, jobNo, onClose }: { stage: ProcessStage; jobNo: string; onClose: () => void }) {
  const { state, run, masters, busy } = useStore();
  const plan = usePlan();
  const fu = useFurnaces();
  const rec = stageRecords(state, stage).find((r) => r.jobNo === jobNo && r.status !== 'Completed');
  const job = getJob(state, jobNo);
  const p = getProduct(state, job.productId);
  const cfg = CFG[stage];

  const [received, setReceived] = useState(String(rec?.input ?? 0));
  const [rejection, setRejection] = useState('0');
  const [checkedBy, setCheckedBy] = useState(rec?.operator ?? '');
  const [date, setDate] = useState(todayISO());
  // T1–T4: the four temperatures recorded when a batch is heat-treated (each starts at the item's standard, or the saved value)
  const [temps, setTemps] = useState<string[]>(() => ['t1', 't2', 't3', 't4'].map((k) => String(rec?.params[k] ?? rec?.params.temperature ?? p.htTemperature)));
  const setTemp = (i: number, v: string) => setTemps((t) => t.map((x, j) => (j === i ? v : x)));
  // Forging only: send the batch past Trimming and / or Heat Treatment
  const [skipTrim, setSkipTrim] = useState(false);
  const [skipHT, setSkipHT] = useState(false);

  if (!rec) return null;
  // Cutting: the received qty is the cut qty, issued from raw stock (editable until issued)
  const editableInput = stage === 'cutting' && rec.status === 'Pending';
  const inN = editableInput ? Number(received) : rec.input;
  // Heat Treatment: nothing is mandatory — an empty rejection simply means none rejected
  const optional = stage === 'heatTreatment';
  const rejN = optional && rejection.trim() === '' ? 0 : Number(rejection);
  const ok = inN - rejN;
  // job work on the customer's material never touches our raw inventory
  const ownStock = (state.jobWork.find((w) => w.jobNo === jobNo)?.materialSource ?? 'own') === 'own';
  const rawAvail = state.rawMaterials.filter((l) => `${l.material}|${l.od}` === job.materialKey).reduce((t, l) => t + l.availableQty, 0);

  const errIn = editableInput ? (!(inN > 0) || !Number.isInteger(inN) ? 'Enter a whole quantity' : ownStock && inN > rawAvail ? `Only ${rawAvail} PCS in raw stock` : null) : null;
  const errRej = (!optional && rejection === '') || rejN < 0 || !Number.isInteger(rejN) ? 'Whole number' : rejN > inN ? `Cannot exceed ${inN}` : null;
  // T1–T4 are optional: leave one empty and it is simply not recorded; a value that is typed must be a positive number
  const tempErr = (v: string) => (stage === 'heatTreatment' && v.trim() !== '' && !(Number(v) > 0) ? 'Enter a positive temperature' : null);
  const errTemp = temps.some((v) => tempErr(v));
  // a process that is still waiting cannot start until Heat Treatment Planning has approved it
  const unapproved = rec.status === 'Pending' && plan.blocked(jobNo, stage);
  const noFurnace = rec.status === 'Pending' && !unapproved && stage === 'heatTreatment' && fu.hasFurnaces && !fu.loadOfJob(jobNo);
  const invalid = !!errIn || !!errRej || errTemp || unapproved || noFurnace;
  // where the batch goes next (Forging can skip Trimming and / or Heat Treatment)
  const to = stage === 'forging' ? (skipTrim ? (skipHT ? 'QC' : 'Heat Treatment') : 'Trimming') : cfg.to;

  const save = async () => {
    if (invalid) return;
    const done = await run(
      (now) =>
        api.completeStage(
          stage,
          jobNo,
          {
            inputQty: editableInput ? inN : undefined,
            loss: rejN,
            operator: checkedBy,
            params: stage === 'forging' ? (skipTrim || skipHT ? { ...(skipTrim ? { skipTrimming: 1 } : {}), ...(skipHT ? { skipHeatTreatment: 1 } : {}) } : undefined) : stage === 'heatTreatment' ? htParams(temps) : undefined,
          },
          tsFor(date, now),
        ),
      {
        title: `${STAGE_LABEL[stage]} saved`,
        message: ok > 0 ? `${jobNo}: ${inN} received − ${rejN} rejected = ${ok} OK, sent to ${to}.` : `${jobNo}: entire batch rejected.`,
      },
    );
    if (done) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={FLOW_STEPS.find((f) => f.key === stage)!.icon}
      title={`${STAGE_LABEL[stage]} — ${jobNo}`}
      subtitle={`${p.name} · ${parseMaterialKey(job.materialKey).material} Ø${parseMaterialKey(job.materialKey).od}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={invalid || busy} onClick={save}>
            <CheckCircle2 size={15} /> Save &amp; send {ok > 0 ? `${fmtNum(ok)} PCS ` : ''}to {to}
          </button>
        </>
      }
    >
      {noFurnace && (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          <div>
            <b>No furnace yet.</b> {jobNo} is on hold until a furnace is assigned in Heat Treatment Planning.
          </div>
        </div>
      )}
      {unapproved && (
        <div className="callout warn" style={{ marginBottom: 16 }}>
          <div>
            <b>Not approved to start yet.</b> Heat Treatment Planning must approve {jobNo} for {STAGE_LABEL[stage]} (with its rank) before it can be saved.
          </div>
        </div>
      )}
      {stage === 'forging' && (
        <div className="check-row" style={{ marginBottom: 16 }}>
          <label className={`check ${skipTrim ? 'on' : ''}`}>
            <input type="checkbox" checked={skipTrim} onChange={(e) => setSkipTrim(e.target.checked)} />
            Skip Trimming — this batch does not go to Trimming
          </label>
          <label className={`check ${skipHT ? 'on' : ''}`}>
            <input type="checkbox" checked={skipHT} onChange={(e) => setSkipHT(e.target.checked)} />
            Skip Heat Treatment — this batch does not go to Heat Treatment
          </label>
        </div>
      )}
      <div className="form-grid three">
        <Field label="Inward Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Received Qty" required={!optional} error={errIn} hint={editableInput ? (ownStock ? `Cut qty · ${fmtNum(rawAvail)} PCS in raw stock` : "Customer's material · not taken from our stock") : `OK qty from ${cfg.from}`}>
          <NumInput value={editableInput ? received : rec.input} onChange={setReceived} readOnly={!editableInput} bad={!!errIn} />
        </Field>
        <Field label="Rejection Qty" required={!optional} error={errRej}>
          <NumInput value={rejection} onChange={setRejection} bad={!!errRej} autoFocus={!editableInput} />
        </Field>
        <Field label="OK Qty" hint="Received − Rejection">
          <NumInput value={Number.isFinite(ok) && ok >= 0 ? ok : ''} readOnly />
        </Field>
        <Field label="Checked By">
          <select value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)}>
            <option value="">Select…</option>
            {masters.operators.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        {stage === 'heatTreatment' &&
          temps.map((t, i) => (
            <Field key={i} label={`T${i + 1} (optional)`} error={tempErr(t)} hint={i === 0 ? `${p.name} standard: ${p.htTemperature}°C` : undefined}>
              <NumInput value={t} onChange={(v) => setTemp(i, v)} suffix="°C" />
            </Field>
          ))}
      </div>

      <div style={{ marginTop: 18 }}>
        <QtyFlow input={Number.isFinite(inN) ? inN : 0} loss={Number.isFinite(rejN) ? rejN : 0} output={Number.isFinite(ok) && ok >= 0 ? ok : '—'} />
      </div>
      {editableInput && ownStock && <FifoPreview keyId={job.materialKey} qty={inN} />}
    </Modal>
  );
}

/** Jobs still at an earlier stage — shows why they are not here yet and lets the user finish that step. */
/** Heat-treatment temperatures that were entered: T1–T4, empty ones left out (the first one entered is also the single "temperature"). */
function htParams(temps: string[]) {
  const out: Record<string, number> = {};
  temps.forEach((v, i) => {
    if (v.trim() !== '' && Number(v) > 0) out[`t${i + 1}`] = Number(v);
  });
  const first = Object.values(out)[0];
  return first === undefined ? {} : { temperature: first, ...out };
}

function UpstreamJobs({ jobNos }: { jobNos: string[] }) {
  const { state, openAction, openTrace } = useStore();
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <div>
          <h3>Coming from earlier stages</h3>
          <div className="sub">They move here once their current stage is completed.</div>
        </div>
        <div className="right">
          <Waypoints size={18} className="muted" />
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl compact">
          <thead>
            <tr>
              <th>Job No.</th>
              <th>Product</th>
              <th>Now at</th>
              <th className="r">Qty</th>
              <th>Status</th>
              <th className="r">To move it forward</th>
            </tr>
          </thead>
          <tbody>
            {jobNos.map((jobNo) => {
              const job = getJob(state, jobNo);
              const st = job.currentStage as ProcessStage;
              const rec = stageRecords(state, st).find((r) => r.jobNo === jobNo && r.status !== 'Completed');
              const n = nextStep(state, jobNo);
              return (
                <tr key={jobNo} className={rowTone('Pending')}>
                  <td>
                    <JobLink jobNo={jobNo} />
                  </td>
                  <td className="strong nowrap">{getProduct(state, job.productId).name}</td>
                  <td className="strong">{STAGE_LABEL[st]}</td>
                  <td className="r qty-cell">{fmtNum(rec?.input ?? 0)}</td>
                  <td>{rec && <Badge status="Pending" />}</td>
                  <td className="r nowrap">
                    {n?.action && (
                      <button className={`btn btn-sm ${rec?.status === 'In Progress' ? 'btn-success' : 'btn-primary'}`} onClick={() => openAction(n.action!)}>
                        {rec?.status === 'In Progress' ? <CheckCircle2 size={13} /> : <Play size={13} />} {n.label}
                      </button>
                    )}
                    <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="View traceability" onClick={() => openTrace(jobNo)}>
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
