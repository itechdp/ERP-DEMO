import { dbMessage, supabase } from '../db/client';
import type { ProcessStage } from '../store/types';

/** One approved process: the planner's order (rank 1 = first) for starting `stage` of `jobNo`. */
export interface PlanItem {
  jobNo: string;
  stage: ProcessStage;
  rank: number;
  note: string;
  approvedBy: string;
  approvedAt: string;
}

const setupHint = (m: string) => /production_plan|production_settings|approve_production_plan|withdraw_production_plan|set_production_enforcement|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(setupHint(e.message) ? 'Heat Treatment Planning is not set up in the database yet. Run migration 50 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function fetchPlan(): Promise<{ items: PlanItem[]; enforce: boolean }> {
  const [p, s] = await Promise.all([supabase.from('v_production_plan').select('*').order('rank'), supabase.from('v_production_settings').select('enforce').maybeSingle()]);
  fail(p.error);
  return {
    items: (p.data ?? []).map((r) => ({ jobNo: r.job_no as string, stage: r.stage as ProcessStage, rank: Number(r.rank), note: (r.note as string) ?? '', approvedBy: (r.approved_by as string) ?? '', approvedAt: r.approved_at as string })),
    enforce: s.error ? false : (s.data?.enforce ?? true),
  };
}

export async function approvePlan(items: { jobNo: string; stage: ProcessStage; rank: number; note?: string }[], user: string) {
  const { error } = await supabase.rpc('approve_production_plan', { p_items: items.map((i) => ({ job_no: i.jobNo, stage: i.stage, rank: i.rank, note: i.note ?? '' })), p_user: user });
  fail(error);
}

export async function withdrawPlan(jobNo: string, stage: ProcessStage) {
  fail((await supabase.rpc('withdraw_production_plan', { p_job_no: jobNo, p_stage: stage })).error);
}

export async function setEnforcement(on: boolean) {
  fail((await supabase.rpc('set_production_enforcement', { p_on: on })).error);
}
