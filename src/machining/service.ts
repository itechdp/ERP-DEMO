import { useCallback, useEffect, useState } from 'react';
import { useAccess } from '../auth/access';
import { dbMessage, supabase } from '../db/client';

/** Workflow → Machinery → CNC and VMC: the machines, and the log of jobs run on them. One set of code serves both pages. */
export type MachineKind = 'cnc' | 'vmc';
export type MachineStatus = 'Available' | 'Running' | 'Maintenance' | 'Breakdown';
export type RunStatus = 'Running' | 'Done' | 'Stopped';
export interface Machine {
  id: number;
  kind: MachineKind;
  name: string;
  makeModel: string;
  controller: string;
  axes: string;
  status: MachineStatus;
  notes: string;
  active: boolean;
}
export interface Run {
  id: number;
  machineId: number;
  machineName: string;
  jobNo: string;
  part: string;
  programNo: string;
  operator: string;
  qtyPlanned: number;
  qtyDone: number;
  startedAt: string;
  endedAt: string;
  cycleSec?: number;
  status: RunStatus;
  remarks: string;
}
export type MachineInput = Pick<Machine, 'name' | 'makeModel' | 'controller' | 'axes' | 'notes' | 'active'>;
export interface StartInput {
  machineId: number;
  jobNo: string;
  part: string;
  programNo: string;
  operator: string;
  qtyPlanned: number;
  remarks: string;
}

const notSetUp = (m: string) => /v_machining|machining_machine|machining_run|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'CNC / VMC are not set up in the database yet. Run migration 73 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function fetchMachines(kind: MachineKind): Promise<Machine[]> {
  const { data, error } = await supabase.from('v_machining_machines').select('*').eq('kind', kind).order('name');
  fail(error);
  return (data ?? []).map((r) => ({ id: Number(r.id), kind, name: r.name as string, makeModel: (r.make_model as string) ?? '', controller: (r.controller as string) ?? '', axes: (r.axes as string) ?? '', status: r.status as MachineStatus, notes: (r.notes as string) ?? '', active: !!r.active }));
}
export async function fetchRuns(kind: MachineKind): Promise<Run[]> {
  const { data, error } = await supabase.from('v_machining_runs').select('*').eq('kind', kind).order('started_at', { ascending: false }).order('id', { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    machineId: Number(r.machine_id),
    machineName: (r.machine_name as string) ?? '',
    jobNo: (r.job_no as string) ?? '',
    part: (r.part as string) ?? '',
    programNo: (r.program_no as string) ?? '',
    operator: (r.operator as string) ?? '',
    qtyPlanned: Number(r.qty_planned ?? 0),
    qtyDone: Number(r.qty_done ?? 0),
    startedAt: (r.started_at as string) ?? '',
    endedAt: (r.ended_at as string) ?? '',
    cycleSec: r.cycle_sec == null ? undefined : Number(r.cycle_sec),
    status: r.status as RunStatus,
    remarks: (r.remarks as string) ?? '',
  }));
}

export async function saveMachine(kind: MachineKind, id: number | null, i: MachineInput) {
  const { data, error } = await supabase.rpc('save_machining_machine', { p_id: id, p_payload: { kind, name: i.name, make_model: i.makeModel, controller: i.controller, axes: i.axes, notes: i.notes, active: i.active } });
  fail(error);
  return Number(data);
}
export const setMachineStatus = async (id: number, status: Exclude<MachineStatus, 'Running'>) => fail((await supabase.rpc('set_machining_machine_status', { p_id: id, p_status: status })).error);
export const deleteMachine = async (id: number) => fail((await supabase.rpc('delete_machining_machine', { p_id: id })).error);
export const startRun = async (i: StartInput, user: string) =>
  fail((await supabase.rpc('start_machining_run', { p_payload: { machine_id: i.machineId, job_no: i.jobNo, part: i.part, program_no: i.programNo, operator: i.operator, qty_planned: i.qtyPlanned, remarks: i.remarks }, p_user: user })).error);
export const finishRun = async (id: number, qtyDone: number, status: 'Done' | 'Stopped', remarks: string) => fail((await supabase.rpc('finish_machining_run', { p_id: id, p_qty_done: qtyDone, p_status: status, p_remarks: remarks })).error);
export const deleteRun = async (id: number) => fail((await supabase.rpc('delete_machining_run', { p_id: id })).error);

export function useMachining(kind: MachineKind) {
  const { canRead } = useAccess();
  const allowed = canRead(kind);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      const [m, r] = await Promise.all([fetchMachines(kind), fetchRuns(kind)]);
      setMachines(m);
      setRuns(r);
      setError(null);
    } catch (e) {
      setMachines([]);
      setRuns([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoaded(true);
  }, [allowed, kind]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { machines, runs, loaded, error, reload };
}

/** how long a run took, as "2 h 15 min" (a run still going is measured up to now) */
export function runTime(r: Pick<Run, 'startedAt' | 'endedAt'>): string {
  if (!r.startedAt) return '—';
  const mins = Math.max(0, Math.round(((r.endedAt ? Date.parse(r.endedAt) : Date.now()) - Date.parse(r.startedAt)) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}
