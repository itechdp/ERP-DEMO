import { Conf, Write } from '../auth/access';
import { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowDownToLine,
  ChevronRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Crop,
  Factory,
  Flame,
  Hammer,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { fgAvailable, isToday, jobSummary, lotAvailableWeight, materialKey, PROCESS_STAGES, STAGE_LABEL, stageRecords } from '../store/engine';
import type { Activity } from '../store/types';
import { Badge, Empty, FLOW_STEPS, go, JobLink, Kpi, PageHeader, Priority, rowTone, Stepper } from '../components/ui';
import { nextStep, pendingSteps } from '../components/workflow';
import { useFollowups } from '../followups/useFollowups';
import { BellRing } from 'lucide-react';
import { AnimatedNum } from '../components/motion';
import { fmtKg, fmtNum, plural, timeAgo, todayISO } from '../components/format';

const FEED_ICON: Record<Activity['kind'], typeof Play> = {
  inward: ArrowDownToLine,
  job: Plus,
  start: Play,
  complete: CheckCircle2,
  qc: ClipboardCheck,
  fg: PackageCheck,
  dispatch: Truck,
  reject: XCircle,
};

export function Dashboard({ navigate }: { navigate: (r: string) => void }) {
  const { state, openTrace, openAction, refresh, loadedAt } = useStore();
  const [showAll, setShowAll] = useState(false);
  const waiting = pendingSteps(state).length;
  const { due: followDue, loading: followLoading } = useFollowups();

  const d = useMemo(() => {
    const s = state;
    const rawQty = s.rawMaterials.reduce((t, l) => t + l.availableQty, 0);
    const rawKg = s.rawMaterials.reduce((t, l) => t + lotAvailableWeight(l), 0);
    const issued = s.jobs.reduce((t, j) => t + j.issues.reduce((a, i) => a + i.qty, 0), 0);
    const stage = Object.fromEntries(
      PROCESS_STAGES.map((st) => {
        const recs = stageRecords(s, st);
        const open = recs.filter((r) => r.status !== 'Completed');
        const done = recs.filter((r) => r.status === 'Completed');
        return [
          st,
          {
            jobs: open.length,
            pending: open.filter((r) => r.status === 'Pending').length,
            wip: open.reduce((t, r) => t + r.input, 0),
            input: done.reduce((t, r) => t + r.input, 0),
            out: done.reduce((t, r) => t + r.output, 0),
            loss: done.reduce((t, r) => t + r.loss, 0),
          },
        ];
      }),
    ) as Record<string, { jobs: number; pending: number; wip: number; input: number; out: number; loss: number }>;
    const qcOpen = s.qc.filter((r) => r.status === 'QC Pending');
    const qcDone = s.qc.filter((r) => r.status !== 'QC Pending');
    // customers' parts (job work) are not our finished goods
    const ownFg = s.finishedGoods.filter((f) => !s.jobWork.some((w) => w.jobNo === f.jobNo));
    const fgAvail = ownFg.reduce((t, f) => t + fgAvailable(f), 0);
    const fgReserved = ownFg.reduce((t, f) => t + f.reservedQty, 0);
    const fgIn = ownFg.reduce((t, f) => t + f.qty, 0);
    const shipped = s.dispatches.filter((x) => x.status === 'Dispatched');
    const today = shipped.filter((x) => isToday(x.dispatchedAt));
    return {
      rawQty,
      rawKg,
      issued,
      stage,
      qc: {
        jobs: qcOpen.length,
        wip: qcOpen.reduce((t, r) => t + r.input, 0),
        input: qcDone.reduce((t, r) => t + r.input, 0),
        acc: qcDone.reduce((t, r) => t + r.accepted, 0),
        rej: qcDone.reduce((t, r) => t + r.rejected, 0),
      },
      fgAvail,
      fgReserved,
      fgIn,
      dispatched: shipped.reduce((t, x) => t + x.qty, 0),
      todayQty: today.reduce((t, x) => t + x.qty, 0),
      todayCount: today.length,
      active: s.jobs.filter((j) => j.currentStage !== 'dispatched' && j.currentStage !== 'scrapped'),
    };
  }, [state]);

  const jobs = (showAll ? state.jobs : d.active).map((j) => jobSummary(state, j.jobNo)).sort((a, b) => b.flowIndex - a.flowIndex || a.job.jobNo.localeCompare(b.job.jobNo));

  // Flow nodes: Raw → Dispatch
  const flow = [
    { qty: d.rawQty, sub: `${fmtKg(Math.round(d.rawKg * 10) / 10)} in stock`, foot: `${fmtNum(d.issued)} issued`, jobs: 0, loss: 0 },
    ...PROCESS_STAGES.map((st) => ({
      qty: d.stage[st].wip,
      sub: `${d.stage[st].jobs} job${d.stage[st].jobs === 1 ? '' : 's'} at stage`,
      foot: `${fmtNum(d.stage[st].out)} output to date`,
      jobs: d.stage[st].jobs,
      loss: d.stage[st].loss,
    })),
    { qty: d.qc.wip, sub: `${d.qc.jobs} job${d.qc.jobs === 1 ? '' : 's'} awaiting`, foot: `${fmtNum(d.qc.acc)} approved`, jobs: d.qc.jobs, loss: d.qc.rej },
    { qty: d.fgAvail + d.fgReserved, sub: `${fmtNum(d.fgAvail)} available`, foot: `${fmtNum(d.fgIn)} received`, jobs: 0, loss: 0 },
    { qty: d.dispatched, sub: `${fmtNum(d.todayQty)} today`, foot: plural(state.dispatches.filter((x) => x.status === 'Dispatched').length, 'dispatch', 'dispatches'), jobs: 0, loss: 0 },
  ];

  const lossRows = [
    ...PROCESS_STAGES.map((st) => ({ label: STAGE_LABEL[st], loss: d.stage[st].loss, input: d.stage[st].input })),
    { label: 'QC Rejection', loss: d.qc.rej, input: d.qc.input },
  ];
  const maxLoss = Math.max(1, ...lossRows.map((r) => r.loss));

  const rawGroups = useMemo(() => {
    const m = new Map<string, { label: string; od: number; qty: number; inward: number }>();
    for (const l of state.rawMaterials) {
      const k = materialKey(l.material, l.od);
      const g = m.get(k) ?? { label: l.material, od: l.od, qty: 0, inward: 0 };
      g.qty += l.availableQty;
      g.inward += l.inwardQty;
      m.set(k, g);
    }
    return [...m.values()];
  }, [state.rawMaterials]);

  return (
    <>
      <PageHeader
        eyebrow="Main Menu"
        title="Dashboard"
        actions={
          <>
            <span className="live" title="The screen is read again when you return to it after a couple of minutes, and after anything you save">
              <ActivityIcon size={15} /> Updated {loadedAt ? new Date(loadedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
            <button className="btn btn-subtle" onClick={() => void refresh()}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="cutting"><button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}>
              <Plus size={16} /> New Job Card
            </button></Write>
          </>
        }
      />

      <div className="kpis k5">
        <Kpi label="Raw Material Stock" value={d.rawQty} unit="PCS" hint={fmtKg(Math.round(d.rawKg * 10) / 10)} icon={Boxes} tone="blue" onClick={() => navigate('raw-inventory')} />
        <Kpi label="Active Production Jobs" value={d.active.length} unit="jobs" hint={`${fmtNum(d.active.reduce((t, j) => t + jobSummary(state, j.jobNo).currentQty, 0))} PCS in process · ${plural(state.jobs.length, 'job')} total`} icon={Factory} tone="violet" trend={waiting ? <span className="chip chip-high">{waiting} need action</span> : undefined} onClick={() => navigate('traceability')} />
        <Kpi label="Finished Goods" value={d.fgAvail} unit="PCS" hint={`${fmtNum(d.fgReserved)} more packed for dispatch`} icon={PackageCheck} tone="green" onClick={() => navigate('finished-goods')} />
        <Kpi label="Follow-ups Due" value={followLoading ? 0 : followDue.length} icon={BellRing} tone={followDue.some((f) => f.due && f.due < todayISO()) ? 'red' : 'violet'} hint="tomorrow, today or overdue" onClick={() => navigate('follow-ups')} />
        <Kpi label="Today's Dispatch" value={d.todayQty} unit="PCS" hint={`${d.todayCount} dispatch${d.todayCount === 1 ? '' : 'es'} today`} icon={Truck} tone="teal" onClick={() => navigate('dispatch')} />
      </div>
      <div className="kpis k5">
        <Kpi label="At Cutting" value={d.stage.cutting.jobs} unit="jobs" hint={`${fmtNum(d.stage.cutting.wip)} PCS`} icon={Scissors} tone="amber" onClick={() => navigate('cutting')} />
        <Kpi label="At Forging" value={d.stage.forging.jobs} unit="jobs" hint={`${fmtNum(d.stage.forging.wip)} PCS`} icon={Hammer} tone="amber" onClick={() => navigate('forging')} />
        <Kpi label="At Trimming" value={d.stage.trimming.jobs} unit="jobs" hint={`${fmtNum(d.stage.trimming.wip)} PCS`} icon={Crop} tone="amber" onClick={() => navigate('trimming')} />
        <Kpi label="At Heat Treatment" value={d.stage.heatTreatment.jobs} unit="jobs" hint={`${fmtNum(d.stage.heatTreatment.wip)} PCS`} icon={Flame} tone="amber" onClick={() => navigate('heat-treatment')} />
        <Kpi label="QC Pending" value={d.qc.jobs} unit="jobs" hint={`${fmtNum(d.qc.wip)} PCS to inspect`} icon={ShieldCheck} tone="amber" onClick={() => navigate('qc')} />
      </div>

      {/* ---------------- Production flow ---------------- */}
      <div className="card mb-lg">
        <div className="card-head">
          <div>
            <h3>Production Flow — Raw Material to Dispatch</h3>
          </div>
          <div className="right">
            <span className="chip">Output = Input − Loss</span>
          </div>
        </div>
        <div className="flow">
          {FLOW_STEPS.map((s, i) => {
            const n = flow[i];
            const I = s.icon;
            const has = n.jobs > 0;
            return (
              <button key={s.key} className={`flow-node ${has || i === 0 ? 'has' : ''} ${i >= 6 ? 'end' : ''} ${has ? 'flowing' : ''}`} onClick={() => navigate(s.route)} title={`Open ${s.label}`}>
                <div className="flow-ic">
                  <I size={24} />
                  {has && <span className="badge-n">{n.jobs}</span>}
                </div>
                <div className="flow-name">{s.label}</div>
                <div className="flow-qty">
                  <AnimatedNum value={n.qty} />
                  <small>PCS</small>
                </div>
                <div className="flow-sub">{n.sub}</div>
                <div className="flow-sub">{n.foot}</div>
                {n.loss > 0 && <div className="flow-loss">−{fmtNum(n.loss)} loss</div>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------- Jobs ---------------- */}
      <div className="mb-lg">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>{showAll ? 'All Production Jobs' : 'Active Production Jobs'}</h3>
            </div>
            <div className="right">
              <button className="btn btn-sm" onClick={() => setShowAll((x) => !x)}>
                {showAll ? 'Active only' : 'Show all jobs'}
              </button>
            </div>
          </div>
          {jobs.length === 0 ? (
            <Empty
              icon={Factory}
              title={state.jobs.length ? 'No active jobs' : 'No production jobs yet'}
              text={
                state.jobs.length
                  ? 'Every job has been dispatched. Create a new job to keep production moving.'
                  : 'Raw material stock is ready. Create the first job and take it from Cutting to Dispatch.'
              }
              action={
                <Write res="cutting"><button className="btn btn-primary" onClick={() => openAction({ kind: 'newJob' })}>
                  <Plus size={15} /> New Job Card
                </button></Write>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="tbl compact">
                <thead>
                  <tr>
                    <th>Job Number</th>
                    <th>Product</th>
                    <th className="r">Planned Qty</th>
                    <th>Current Stage</th>
                    <th className="r">Current Qty</th>
                    <th>Status</th>
                    <th>Next Action</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.job.jobNo} className={rowTone(j.status)}>
                      <td>
                        <JobLink jobNo={j.job.jobNo} />
                        {j.job.priority !== 'Normal' && (
                          <div style={{ marginTop: 4 }}>
                            <Priority p={j.job.priority} />
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="strong nowrap">{j.product.name}</div>
                        <Conf g="party_names">
                          <div className="sub nowrap">{j.job.customer}</div>
                        </Conf>
                      </td>
                      <td className="r num">{fmtNum(j.job.plannedQty)}</td>
                      <td>
                        <div className="strong nowrap" style={{ marginBottom: 6 }}>{STAGE_LABEL[j.job.currentStage]}</div>
                        <Stepper index={j.flowIndex} />
                      </td>
                      <td className="r qty-cell">
                        {fmtNum(j.currentQty)}
                        {j.totalLoss > 0 && <div className="sub loss">−{j.totalLoss} loss</div>}
                      </td>
                      <td>
                        <Badge status={j.status} />
                      </td>
                      <td className="nowrap">
                        <NextActionButton jobNo={j.job.jobNo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {/* ---------------- Loss + raw stock ---------------- */}
      <div className="dash-grid-3 mb-lg">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Recent Activity</h3>
            </div>
            <div className="right">
              <ActivityIcon size={16} className="muted" />
            </div>
          </div>
          {state.activity.length === 0 && <Empty icon={ActivityIcon} title="No activity yet" text="Inward, production, QC and dispatch events will appear here." />}
          <ul className="feed">
            {state.activity.slice(0, 6).map((a) => {
              const I = FEED_ICON[a.kind];
              return (
                <li key={a.id}>
                  <span className={`feed-ic ${a.kind}`}>
                    <I size={15} />
                  </span>
                  <div>
                    <div className="tx">
                      {a.jobNo ? (
                        <>
                          <button className="btn-link mono" style={{ fontSize: 12.5 }} onClick={() => openTrace(a.jobNo!)}>
                            {a.jobNo}
                          </button>{' '}
                          {a.text.replace(a.jobNo, '').trim()}
                        </>
                      ) : (
                        a.text
                      )}
                    </div>
                    <div className="tm">{timeAgo(a.ts)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Loss / Rejection by Stage</h3>
            </div>
          </div>
          <div className="card-body">
            {lossRows.every((r) => r.input === 0) ? (
              <Empty icon={XCircle} title="No completed batches" text="Loss per stage appears here once batches are completed." />
            ) : (
              <div className="bars">
                {lossRows.map((r) => {
                  const pct = r.input ? (r.loss / r.input) * 100 : 0;
                  return (
                    <div className="bar-row" key={r.label}>
                      <span className="strong">{r.label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(r.loss / maxLoss) * 100}%` }} />
                      </div>
                      <span className="val">
                        {fmtNum(r.loss)} PCS
                        <small>{pct.toFixed(2)}% of input</small>
                      </span>
                      <span className="tip">
                        {r.label}: {r.loss} lost of {fmtNum(r.input)} processed ({pct.toFixed(2)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Raw Material Position</h3>
            </div>
            <div className="right">
              <button className="btn btn-sm" onClick={() => navigate('raw-inventory')}>
                View inventory
              </button>
            </div>
          </div>
          {rawGroups.length === 0 && (
            <Empty
              icon={Boxes}
              title="No raw material in stock"
              text="Add a raw material inward to start."
              action={
                <Write res="raw_inventory"><button className="btn btn-sm btn-primary" onClick={() => openAction({ kind: 'inward' })}>
                  <Plus size={14} /> Add Inward
                </button></Write>
              }
            />
          )}
          <div className="stock-list">
            {rawGroups.map((g) => (
              <div className="stock-row" key={g.label + g.od}>
                <div>
                  <span className="strong">{g.label}</span> <span className="muted nowrap">· OD {g.od} mm</span>
                </div>
                <div className="num strong">
                  {fmtNum(g.qty)} <span className="muted" style={{ fontWeight: 500 }}>/ {fmtNum(g.inward)} PCS</span>
                </div>
                <div className="meter">
                  <i style={{ width: `${g.inward > 0 ? Math.min(100, (g.qty / g.inward) * 100) : 0}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </>
  );
}

/** One-click "do the next thing" for a job — opens the right form right here on the dashboard. */
function NextActionButton({ jobNo }: { jobNo: string }) {
  const { state, openAction } = useStore();
  const n = nextStep(state, jobNo);
  if (!n) return <span className="muted">Completed</span>;
  return (
    <button
      className="btn btn-sm btn-soft"
      onClick={() => (n.action ? openAction(n.action) : n.route && go(n.route))}
      title={n.detail}
    >
      {n.label} <ChevronRight size={14} />
    </button>
  );
}
