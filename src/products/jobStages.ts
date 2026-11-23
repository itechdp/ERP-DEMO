import { PROCESS_STAGES, stageRecords } from '../store/engine';
import type { ERPState, ProcessStage } from '../store/types';
import type { ProductFlow } from './flow';

/**
 * The processes a job really goes through, in order — the ones to show on its traceability and route card.
 *  · a process it has a record for counts, unless that record is a skip ("Not required — skipped")
 *  · a process it has not reached yet counts only when it is planned: Skip Trimming / Skip Heat Treatment ticked at Forging, the
 *    job-work batch's own ticks (Cutting – Heat Treatment), otherwise the product's ticks in Product Master (when known)
 */
export function jobStages(s: ERPState, jobNo: string, flow?: Pick<ProductFlow, ProcessStage>): ProcessStage[] {
  const rec = (st: ProcessStage) => stageRecords(s, st).find((r) => r.jobNo === jobNo);
  const forging = rec('forging');
  const jw = s.jobWork.find((w) => w.jobNo === jobNo);
  return PROCESS_STAGES.filter((st) => {
    const r = rec(st);
    if (r) return !r.params.skipped;
    if (st === 'trimming' && forging?.params.skipTrimming) return false;
    if (st === 'heatTreatment' && forging?.params.skipHeatTreatment) return false;
    if (jw && st !== 'cnc' && st !== 'vmc') return !!jw.processes[st];
    return flow ? flow[st] : true;
  });
}
