import { useMemo, useState } from 'react';
import { CheckCircle2, Flame, Undo2 } from 'lucide-react';
import { Write, canSee, currentUserName, searchable, useAccess } from '../auth/access';
import { Empty, JobLink, PageHeader, Search } from '../components/ui';
import { fmtDate, fmtNum, matches } from '../components/format';
import { approvePlan, setEnforcement, withdrawPlan } from '../planning/service';
import { PRIORITY_LEVELS, clampPriority, jobPriority, priorityChip, priorityName } from '../planning/priority';
import { AssignModal } from '../furnaces/AssignModal';
import { fmtLeft, fmtTime, releaseFurnaceLoad, useFurnaces } from '../furnaces/service';
import { useProductFlows } from '../products/flow';
import { usePlan } from '../planning/usePlan';
import { PROCESS_STAGES, STAGE_LABEL, getJob, getProduct } from '../store/engine';
import { useStore } from '../store/StoreContext';
import type { Job, ProcessStage, StageRecord } from '../store/types';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';

type Stock = { tone: 'good' | 'warn' | 'bad'; label: string; sub?: string };
/** `r` is the Heat Treatment order (pieces are waiting there); without it the batch is still at an earlier process. */
type Row = { jobNo: string; job: Job; r?: StageRecord; qty: number; stock: Stock };

const HT: ProcessStage = 'heatTreatment';

/** did Forging tick "Skip Heat Treatment" for this batch? or does the product / job-work batch not include it? */
const skipsHT = (s: ReturnType<typeof useStore>['state'], jobNo: string, productDoesHT: boolean) =>
  !productDoesHT || !!s.forging.find((r) => r.jobNo === jobNo)?.params.skipHeatTreatment || s.jobWork.some((w) => w.jobNo === jobNo && !w.processes.heatTreatment);

/**
 * Workflow → Heat Treatment Planning. The batches that go into heat treatment, the stock of pieces waiting for it, their priority
 * (1 Urgent, 2 High, 3 Normal — the order they run in) and the furnace each one is loaded in. With the switch on, Heat Treatment cannot
 * start on a batch until it is approved here.
 *  · Ready        — the pieces are already at Heat Treatment (the earlier process is finished)
 *  · Not in stock — the batch is still at an earlier process; it can be approved once its pieces arrive
 */
export function PlanningPage() {
  const { state, toast } = useStore();
  const { canWrite } = useAccess();
  const mayApprove = canWrite('production_planning');
  const plan = usePlan();
  const fu = useFurnaces();
  const pf = useProductFlows();
  const [assigning, setAssigning] = useState<Row | null>(null);
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const rows: Row[] = useMemo(() => {
    const here: Row[] = state.heatTreatment
      .filter((r) => r.status !== 'Completed' && !r.params.auto && !r.params.skipped)
      .map((r) => ({ jobNo: r.jobNo, job: getJob(state, r.jobNo), r, qty: r.input, stock: { tone: 'good', label: r.status === 'In Progress' ? 'In the furnace' : 'Ready' } as Stock }));
    // batches still at an earlier process: no pieces in stock for heat treatment yet
    const coming: Row[] = state.jobs
      .filter((j) => PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) > -1 && PROCESS_STAGES.indexOf(j.currentStage as ProcessStage) < PROCESS_STAGES.indexOf(HT))
      .filter((j) => !skipsHT(state, j.jobNo, pf.of(j.productId).heatTreatment))
      .map((j) => ({ jobNo: j.jobNo, job: j, qty: j.plannedQty, stock: { tone: 'bad', label: 'Not in stock', sub: `at ${STAGE_LABEL[j.currentStage as ProcessStage]}` } as Stock }));
    const level = (x: Row) => {
      const ap = plan.find(x.jobNo, HT);
      return ap ? clampPriority(ap.rank) : jobPriority(x.job);
    };
    // batches that have arrived first; then by priority (1 Urgent first), then by due date
    return [...here, ...coming].sort((a, b) => {
      if (!!a.r !== !!b.r) return a.r ? -1 : 1;
      return level(a) - level(b) || (a.job.dueDate || '9').localeCompare(b.job.dueDate || '9');
    });
  }, [state, plan, pf]);

  const shown = rows.filter((x) => matches(q, x.jobNo, getProduct(state, x.job.productId).name, searchable(x.job.customer)));
  const waiting = rows.filter((x) => x.r).length;

  const act = async (fn: () => Promise<void>, done: { title: string; message?: string }) => {
    setBusy(true);
    try {
      await fn();
      await plan.refresh();
      toast({ kind: 'success', ...done });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not update the plan', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  /** the priority shown for a row: what is being picked, else the approved one, else the job's own */
  const levelOf = (x: Row) => draft[x.jobNo] ?? clampPriority(plan.find(x.jobNo, HT)?.rank ?? jobPriority(x.job));

  const approveRow = (x: Row) => {
    const n = levelOf(x);
    void act(() => approvePlan([{ jobNo: x.jobNo, stage: HT, rank: n }], currentUserName()), { title: `Approved — ${priorityName(n)} priority`, message: x.jobNo });
  };

  // approve every batch that is ready and not approved yet, each with the priority shown for it
  const approveReady = () => {
    const items = shown.filter((x) => x.r && !plan.find(x.jobNo, HT)).map((x) => ({ jobNo: x.jobNo, stage: HT, rank: levelOf(x) }));
    if (!items.length) return toast({ kind: 'info', title: 'Nothing to approve', message: 'Every batch that is ready is already approved.' });
    void act(() => approvePlan(items, currentUserName()), { title: `${items.length} batch${items.length === 1 ? '' : 'es'} approved`, message: 'Each with the priority shown.' });
  };

  const toneChip = { good: 'chip chip-up', warn: 'chip chip-wait', bad: 'chip chip-hot' } as const;

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Heat Treatment Planning" actions={shown.length > 0 ? <ListButtons doc={() => ({ filename: 'Heat-Treatment-Planning', title: 'Heat Treatment Planning', form: FORM_FORMATS.report, rows: shown.map((x) => ({ job: x.jobNo, product: getProduct(state, x.job.productId).name, customer: canSee('party_names') ? x.job.customer : '', qty: x.qty, due: x.job.dueDate, stock: x.stock.label, priority: priorityName(levelOf(x)), approval: plan.find(x.jobNo, HT) ? 'Approved' : 'Waiting' })), cols: [{ label: 'Job No.', key: 'job' }, { label: 'Product', key: 'product', width: 26 }, { label: 'Customer', key: 'customer', width: 24 }, { label: 'Qty (PCS)', key: 'qty', kind: 'num' }, { label: 'Due', key: 'due', kind: 'date' }, { label: 'Stock', key: 'stock' }, { label: 'Priority', key: 'priority' }, { label: 'Approval', key: 'approval' }] })} /> : undefined} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 18px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }} className="text-sm">
            Set each batch's <b>priority</b> (Urgent, High or Normal) and approve it. A batch is <b>Ready</b> when its pieces are at Heat Treatment; a batch still at an earlier process shows <b>Not in stock</b> and
            can be approved once its pieces arrive. {waiting} waiting now.
          </div>
          <Write res="production_planning">
            <label className={`check ${plan.enforce ? 'on' : ''}`} title="When on, Heat Treatment cannot start on a batch until it is approved here">
              <input type="checkbox" checked={plan.enforce} disabled={busy} onChange={(e) => void act(() => setEnforcement(e.target.checked), { title: e.target.checked ? 'Approval is now required to start Heat Treatment' : 'Heat Treatment can start without approval' })} />
              Approval required to start Heat Treatment
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={approveReady}>
              <CheckCircle2 size={15} /> Approve all ready
            </button>
          </Write>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search job, item, customer…' : 'Search job, item…'} />
        </div>
        {shown.length === 0 ? (
          <Empty icon={Flame} title="Nothing for heat treatment" text="Batches that are waiting for heat treatment, or on their way to it, appear here." />
        ) : (
          <div className="table-wrap">
            <table className="tbl compact plan-tbl">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="r">Qty</th>
                  <th>Priority</th>
                  <th>Stock</th>
                  <th>Approval</th>
                  <th>Furnace</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((x) => {
                  const ap = plan.find(x.jobNo, HT);
                  const lvl = levelOf(x);
                  return (
                    <tr key={x.jobNo}>
                      <td>
                        <JobLink jobNo={x.jobNo} />
                        <div className="sub">
                          {getProduct(state, x.job.productId).name}
                          {canSee('party_names') && x.job.customer ? ` · ${x.job.customer}` : ''}
                        </div>
                      </td>
                      <td className="r num">{x.r ? fmtNum(x.qty) : <span className="muted">~{fmtNum(x.qty)}</span>}</td>
                      <td className="nowrap">
                        {mayApprove && x.r ? (
                          <select className="pri-select" value={lvl} onChange={(e) => setDraft((d) => ({ ...d, [x.jobNo]: Number(e.target.value) }))} aria-label={`Priority for ${x.jobNo}`}>
                            {PRIORITY_LEVELS.map((p) => (
                              <option key={p.n} value={p.n}>
                                {p.n} · {p.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={priorityChip(lvl)}>{lvl} · {priorityName(lvl)}</span>
                        )}
                        <div className="sub">{x.job.dueDate ? `Due ${fmtDate(x.job.dueDate)}` : 'No due date'}</div>
                      </td>
                      <td className="nowrap">
                        <span className={toneChip[x.stock.tone]}>{x.stock.label}</span>
                        {x.stock.sub && <div className="sub">{x.stock.sub}</div>}
                      </td>
                      <td className="nowrap">
                        {ap ? (
                          <>
                            <span className="chip chip-up">Approved</span>
                            <div className="sub">{ap.approvedBy}</div>
                          </>
                        ) : x.r ? (
                          <span className={plan.enforce ? 'chip chip-wait' : 'chip'}>{plan.enforce ? 'Waiting' : 'Not approved'}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="nowrap">{x.r ? <FurnaceCell row={x} fu={fu} /> : <span className="muted">—</span>}</td>
                      <td className="r nowrap">
                        {x.r && (
                          <div className="icon-actions">
                            <Write res="furnaces">
                              {fu.loadOfJob(x.jobNo) ? (
                                <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => void act(() => releaseFurnaceLoad(fu.loadOfJob(x.jobNo)!.id).then(() => fu.refresh()), { title: 'Furnace released', message: x.jobNo })}>
                                  Release
                                </button>
                              ) : (
                                fu.hasFurnaces &&
                                fu.free.length > 0 && (
                                  <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => setAssigning(x)}>
                                    Assign furnace
                                  </button>
                                )
                              )}
                            </Write>
                            <Write res="production_planning">
                              <button className="btn btn-subtle btn-sm" disabled={busy} onClick={() => approveRow(x)}>
                                {ap ? 'Update' : 'Approve'}
                              </button>
                              {ap && x.r.status !== 'In Progress' && (
                                <button className="icon-btn" title="Withdraw approval" aria-label={`Withdraw ${x.jobNo}`} disabled={busy} onClick={() => void act(() => withdrawPlan(x.jobNo, HT), { title: 'Approval withdrawn', message: x.jobNo })}>
                                  <Undo2 size={15} />
                                </button>
                              )}
                            </Write>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {assigning && <AssignModal jobNo={assigning.jobNo} fu={fu} onClose={() => setAssigning(null)} onDone={async () => { setAssigning(null); await fu.refresh(); }} />}
    </>
  );
}

type Fu = ReturnType<typeof useFurnaces>;

/** which furnace a batch is in and until when, or why it is on hold (information only — the buttons are in Action) */
function FurnaceCell({ row, fu }: { row: Row; fu: Fu }) {
  const load = fu.loadOfJob(row.jobNo);
  if (load) {
    const f = fu.furnaces.find((x) => x.id === load.furnaceId);
    return (
      <div className="furn-cell">
        <span className="chip chip-run">{f?.name ?? 'Furnace'}</span>
        <div className="sub">
          until {fmtTime(load.endsAt)} · {fmtLeft(load.endsAt, fu.now)}
          {load.shift ? ` · ${load.shift}` : ''}
        </div>
      </div>
    );
  }
  if (!fu.hasFurnaces) return <span className="muted">No furnaces</span>;
  if (fu.free.length === 0) {
    const t = fu.nextFreeAt();
    return (
      <div className="furn-cell">
        <span className="chip chip-wait">On hold</span>
        <div className="sub">free {t ? `at ${fmtTime(t)}` : 'soon'}</div>
      </div>
    );
  }
  return (
    <div className="furn-cell">
      <span className="chip">Not assigned</span>
      <div className="sub">{fu.free.length} free</div>
    </div>
  );
}
