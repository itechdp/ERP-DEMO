import { dbMessage, supabase } from '../db/client';

type R = Record<string, any>;
const s = (v: unknown) => (v == null ? '' : String(v));
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(dbMessage(e as never));
};

export const URGENCIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export const TASK_STATUSES = ['Open', 'In Progress', 'On Hold', 'Done', 'Cancelled'] as const;

export interface Task {
  id: number;
  docNo: string;
  docDate: string;
  title: string;
  urgency: string;
  status: string;
  assignee: string;
  assignedTo: string | null;
  assignedBy: string;
  refNo: string;
  dueDate: string | null;
  remarks: string;
  createdAt: string;
  assignedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  /** seconds the task has spent On Hold (finished holds), and when the current hold began */
  heldSeconds: number;
  holdStartedAt: string | null;
  mine: boolean;
}

const mapTask = (r: R): Task => ({
  id: Number(r.id), docNo: s(r.doc_no), docDate: s(r.doc_date), title: s(r.title), urgency: s(r.priority), status: s(r.status), assignee: s(r.assignee),
  assignedTo: r.assigned_to ?? null, assignedBy: s(r.assigned_by), refNo: s(r.ref_no), dueDate: r.due_date ?? null, remarks: s(r.remarks), createdAt: s(r.created_at),
  assignedAt: r.assigned_at ?? null, startedAt: r.started_at ?? null, completedAt: r.completed_at ?? null, heldSeconds: Number(r.held_seconds ?? 0), holdStartedAt: r.hold_started_at ?? null, mine: !!r.mine,
});

export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from('v_tasks').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
  if (error) throw new Error(/v_tasks|schema cache|does not exist/i.test(error.message) ? 'Tasks are not set up in the database yet. Run migration 39 in the Supabase SQL editor.' : dbMessage(error));
  return ((data ?? []) as R[]).map(mapTask);
}

export async function setTaskStatus(id: number, status: string) {
  fail((await supabase.rpc('set_task_status', { p_id: id, p_status: status })).error);
}

export interface AssignableUser { id: string; name: string; role: string }
export async function fetchAssignableUsers(): Promise<AssignableUser[]> {
  const { data, error } = await supabase.from('v_assignable_users').select('*').order('full_name');
  if (error) return []; // migration 39 not run yet: the form falls back to a free-text name
  return ((data ?? []) as R[]).map((r) => ({ id: s(r.id), name: s(r.full_name), role: s(r.role) }));
}

// ------------------------------------------------------------ notifications
export interface AppNotification { id: number; kind: string; title: string; message: string; link: string; urgency: string; createdAt: string; seenAt: string | null }

/** the latest notifications of the signed-in person, seen and unseen, newest first */
export async function fetchRecent(): Promise<AppNotification[]> {
  const { data, error } = await supabase.rpc('my_notifications', { p_unseen_only: false });
  if (error) return []; // not installed yet — nothing to show
  return ((data ?? []) as R[]).map((r) => ({ id: Number(r.id), kind: s(r.kind), title: s(r.title), message: s(r.message), link: s(r.link), urgency: s(r.urgency), createdAt: s(r.created_at), seenAt: r.seen_at ?? null }));
}

export async function markSeen(ids: number[]) {
  if (ids.length) await supabase.rpc('mark_notifications_seen', { p_ids: ids });
}

// ------------------------------------------------------------ time helpers
const ms = (a: string | null, b: string | null) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);

/** from when the work began (started, else assigned) until it was finished — or until now while it is still running */
export function taskTimeTaken(t: Task, now = Date.now()): number | null {
  const from = t.startedAt ?? t.assignedAt;
  if (!from) return null;
  // the time spent On Hold does not count (finished holds, and the hold that is still going)
  const held = t.heldSeconds * 1000 + (t.status === 'On Hold' && t.holdStartedAt ? Math.max(0, now - new Date(t.holdStartedAt).getTime()) : 0);
  if (t.completedAt) return Math.max(0, (ms(from, t.completedAt) ?? 0) - held);
  if (t.status === 'Done' || t.status === 'Cancelled') return null;
  return Math.max(0, now - new Date(from).getTime() - held);
}
export const taskTimeToStart = (t: Task) => ms(t.assignedAt, t.startedAt);
export const taskTurnaround = (t: Task) => ms(t.assignedAt, t.completedAt);

export function fmtDuration(v: number | null): string {
  if (v == null) return '—';
  const mins = Math.max(0, Math.round(v / 60000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', !d || m ? `${m}m` : ''].filter(Boolean).join(' ');
}

/** whole days past the due date (0 when on time or no due date); a finished task is measured at its completion */
export function taskOverdueDays(t: Task, now = Date.now()): number {
  if (!t.dueDate || t.status === 'Cancelled') return 0;
  const end = t.completedAt ? new Date(t.completedAt).getTime() : t.status === 'Done' ? now : now;
  const due = new Date(t.dueDate + 'T23:59:59').getTime();
  return end > due ? Math.ceil((end - due) / 86400000) : 0;
}
