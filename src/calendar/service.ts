// Calendar events. Table: calendar_events (migration 77).
// The role is passed with every read and every add (userRole). That is a convenience: the database itself only ever returns
// and accepts the signed-in person's own role (row-level security), so a changed request cannot reach another role's events.
import { supabase } from '../db/client';
import type { Role } from '../auth/access';
import { hhmm, type CalEvent, type EventKind } from './logic';

type Row = { id: number; title: string; date: string; time: string; kind: EventKind; role_id: string; user_id: string };
const COLS = 'id, title, date, time, kind, role_id, user_id';
const toEvent = (r: Row): CalEvent => ({ id: r.id, title: r.title, date: r.date, time: hhmm(r.time), kind: r.kind, roleId: r.role_id, userId: r.user_id });

/** Events of this role between two days (both included), earliest first. */
export async function fetchEvents(userRole: Role, from: string, to: string): Promise<CalEvent[]> {
  const { data, error } = await supabase
    .from('calendar_events')
    .select(COLS)
    .eq('role_id', userRole)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('time', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toEvent);
}

export async function addEvent(userRole: Role, e: { title: string; date: string; time: string; kind: EventKind }): Promise<void> {
  const { error } = await supabase.from('calendar_events').insert({ title: e.title.trim(), date: e.date, time: e.time, kind: e.kind, role_id: userRole });
  if (error) throw new Error(error.message);
}

export async function deleteEvent(id: number): Promise<void> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** the signed-in person's id (read from the stored session, no request is made) */
export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? '';
}
