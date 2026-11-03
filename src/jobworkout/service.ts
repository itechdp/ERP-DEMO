import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAccess } from '../auth/access';
import { dbMessage, supabase } from '../db/client';

/** Work we gave to somebody else (Workflow → Job Work Out). Entries only — our own inventory is never touched. */
export type OutStatus = 'Sent' | 'Received' | 'Cancelled';
export interface JobWorkOut {
  id: number;
  outNo: string;
  outDate: string;
  vendor: string;
  contact: string;
  phone: string;
  jobNo: string;
  item: string;
  process: string;
  qty: number;
  uom: string;
  challanNo: string;
  dueDate: string;
  remindDays: number;
  charges?: number;
  status: OutStatus;
  receivedOn: string;
  receivedQty?: number;
  remarks: string;
  createdBy: string;
}
export type OutInput = Omit<JobWorkOut, 'id' | 'status' | 'receivedOn' | 'receivedQty' | 'createdBy'>;

const notSetUp = (m: string) => /v_job_work_out|save_job_work_out|set_job_work_out_status|delete_job_work_out|job_work_out_reminders|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'Job Work Out is not set up in the database yet. Run migration 57 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function fetchJobWorkOut(): Promise<JobWorkOut[]> {
  const { data, error } = await supabase.from('v_job_work_out').select('*').order('out_date', { ascending: false }).order('id', { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    outNo: r.out_no as string,
    outDate: (r.out_date as string) ?? '',
    vendor: (r.vendor as string) ?? '',
    contact: (r.contact as string) ?? '',
    phone: (r.phone as string) ?? '',
    jobNo: (r.job_no as string) ?? '',
    item: (r.item as string) ?? '',
    process: (r.process as string) ?? '',
    qty: Number(r.qty),
    uom: (r.uom as string) ?? 'PCS',
    challanNo: (r.challan_no as string) ?? '',
    dueDate: (r.due_date as string) ?? '',
    remindDays: Number(r.remind_days ?? 2),
    charges: r.charges == null ? undefined : Number(r.charges),
    status: r.status as OutStatus,
    receivedOn: (r.received_on as string) ?? '',
    receivedQty: r.received_qty == null ? undefined : Number(r.received_qty),
    remarks: (r.remarks as string) ?? '',
    createdBy: (r.created_by as string) ?? '',
  }));
}

export async function saveJobWorkOut(id: number | null, i: OutInput, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_job_work_out', {
    p_id: id,
    p_payload: {
      out_no: i.outNo, out_date: i.outDate || null, vendor: i.vendor, contact: i.contact, phone: i.phone, job_no: i.jobNo, item: i.item, process: i.process, qty: i.qty,
      uom: i.uom, challan_no: i.challanNo, due_date: i.dueDate || null, remind_days: i.remindDays, charges: i.charges ?? null, remarks: i.remarks,
    },
    p_user: user,
  });
  fail(error);
  return Number(data);
}

export async function setJobWorkOutStatus(id: number, status: OutStatus, receivedOn?: string, receivedQty?: number) {
  fail((await supabase.rpc('set_job_work_out_status', { p_id: id, p_status: status, p_received_on: receivedOn || null, p_received_qty: receivedQty ?? null })).error);
}

export async function deleteJobWorkOut(id: number) {
  fail((await supabase.rpc('delete_job_work_out', { p_id: id })).error);
}

// ------------------------------------------------------------------ due dates
const day = (iso: string) => Date.parse(iso.slice(0, 10) + 'T00:00:00');
/** whole days from today to the due date: 0 = today, negative = late; null when there is no due date */
export function daysLeft(j: Pick<JobWorkOut, 'dueDate'>): number | null {
  if (!j.dueDate) return null;
  const t = new Date();
  const local = Date.parse(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T00:00:00`);
  return Math.round((day(j.dueDate) - local) / 86400000);
}
export const dueLabel = (n: number) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'Due today' : `Due in ${n} day${n === 1 ? '' : 's'}`);
/** an open entry whose reminder window has started (or that is already late) */
export const needsReminder = (j: JobWorkOut) => {
  const n = j.status === 'Sent' ? daysLeft(j) : null;
  return n !== null && n <= j.remindDays;
};

/**
 * The job-work-out entries the signed-in person may see, with the ones that need a reminder.
 * Once an hour it also asks the database to send the reminder notifications (once a day per entry) — it quietly does nothing until migration 57 is run.
 */
export function useJobWorkOut() {
  const { canRead, user } = useAccess();
  const allowed = canRead('job_work_out');
  const [items, setItems] = useState<JobWorkOut[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      setItems(await fetchJobWorkOut());
      setError(null);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoaded(true);
  }, [allowed]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!allowed || !user) return;
    const ask = () => void supabase.rpc('job_work_out_reminders').then(() => undefined, () => undefined);
    ask();
    const t = window.setInterval(ask, 3600_000);
    return () => window.clearInterval(t);
  }, [allowed, user]);

  const due = useMemo(() => items.filter(needsReminder).sort((a, b) => (daysLeft(a) ?? 0) - (daysLeft(b) ?? 0)), [items]);
  return { items, due, loaded, error, reload };
}
