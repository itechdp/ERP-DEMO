// "What should happen next to this job?" — drives the Next Step buttons on the
// dashboard, the traceability drawer and the notification bell.
import { fgAvailable, getJob, jobSummary, STAGE_LABEL, stageRecords } from '../store/engine';
import type { Action } from '../store/StoreContext';
import type { ERPState } from '../store/types';

export interface NextStep {
  jobNo: string;
  /** Button text, e.g. "Complete Forging" */
  label: string;
  /** One line of context, e.g. "196 PCS on machine" */
  detail: string;
  /** FLOW_STEPS key of the stage that acts next */
  stageKey: string;
  action?: Action;
  /** Used when the step is finished on a page rather than in a form */
  route?: string;
}

export function nextStep(s: ERPState, jobNo: string): NextStep | null {
  const job = getJob(s, jobNo);
  const st = job.currentStage;
  if (st === 'cutting' || st === 'forging' || st === 'trimming' || st === 'heatTreatment' || st === 'cnc' || st === 'vmc') {
    const r = stageRecords(s, st).find((x) => x.jobNo === jobNo && x.status !== 'Completed');
    if (!r) return null;
    return {
      jobNo,
      label: `Enter ${STAGE_LABEL[st]}`,
      detail: `${r.input} PCS received at ${STAGE_LABEL[st]}`,
      stageKey: st,
      action: { kind: 'stage', stage: st, jobNo },
    };
  }
  if (st === 'qc') {
    const r = s.qc.find((x) => x.jobNo === jobNo && x.status === 'QC Pending');
    return r ? { jobNo, label: 'Enter QC', detail: `${r.input} PCS awaiting inspection`, stageKey: 'qc', action: { kind: 'qc', jobNo } } : null;
  }
  if (st === 'finishedGoods') {
    const lots = s.finishedGoods.filter((f) => f.jobNo === jobNo);
    const open = lots.find((f) => fgAvailable(f) > 0);
    if (open) return { jobNo, label: 'Dispatch Goods', detail: `${fgAvailable(open)} PCS available in Finished Goods`, stageKey: 'finishedGoods', action: { kind: 'dispatch', fgId: open.id } };
    const packed = lots.reduce((t, f) => t + f.reservedQty, 0);
    if (packed) return { jobNo, label: 'Confirm Dispatch', detail: `${packed} PCS packed, waiting for vehicle`, stageKey: 'dispatched', route: 'dispatch' };
  }
  return null;
}

const PRIORITY = { Urgent: 0, High: 1, Normal: 2 } as const;

/** Every job that is waiting for someone to act, most urgent and most advanced first. */
export function pendingSteps(s: ERPState): NextStep[] {
  return s.jobs
    .map((j) => ({ j, n: nextStep(s, j.jobNo), idx: jobSummary(s, j.jobNo).flowIndex }))
    .filter((x): x is { j: typeof x.j; n: NextStep; idx: number } => !!x.n)
    .sort((a, b) => PRIORITY[a.j.priority] - PRIORITY[b.j.priority] || b.idx - a.idx)
    .map((x) => x.n);
}
