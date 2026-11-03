import { useCallback, useEffect, useState } from 'react';
import { dbMessage, supabase } from '../db/client';
import { useStore } from '../store/StoreContext';

export interface Furnace {
  id: number;
  name: string;
  active: boolean;
}
export interface FurnaceLoad {
  id: number;
  furnaceId: number;
  jobNo: string;
  shift: '' | 'AM' | 'PM';
  cycleNo: string;
  startedAt: string;
  durationMinutes: number;
  endsAt: string;
  releasedAt?: string;
  loadedBy: string;
}

const notSetUp = (m: string) => /v_furnaces|v_furnace_loads|save_furnace|delete_furnace|assign_furnace|release_furnace_load|set_furnace_timer|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'Furnaces are not set up in the database yet. Run migrations 52 and 53 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function fetchFurnaces(): Promise<{ furnaces: Furnace[]; loads: FurnaceLoad[] }> {
  const [f, l] = await Promise.all([supabase.from('v_furnaces').select('*').order('name'), supabase.from('v_furnace_loads').select('*').is('released_at', null)]);
  fail(f.error);
  fail(l.error);
  return {
    furnaces: (f.data ?? []).map((r) => ({ id: Number(r.id), name: r.name as string, active: !!r.active })),
    loads: (l.data ?? []).map((r) => ({
      id: Number(r.id),
      furnaceId: Number(r.furnace_id),
      jobNo: r.job_no as string,
      shift: (r.shift as '' | 'AM' | 'PM') ?? '',
      cycleNo: (r.cycle_no as string) ?? '',
      startedAt: r.started_at as string,
      durationMinutes: Number(r.duration_minutes),
      endsAt: r.ends_at as string,
      loadedBy: (r.loaded_by as string) ?? '',
    })),
  };
}

export async function saveFurnace(id: number | null, name: string, active: boolean) {
  fail((await supabase.rpc('save_furnace', { p_id: id, p_name: name, p_active: active })).error);
}
export async function deleteFurnace(id: number) {
  fail((await supabase.rpc('delete_furnace', { p_id: id })).error);
}
export async function assignFurnace(jobNo: string, furnaceId: number, shift: string, minutes: number, cycleNo: string, user: string) {
  fail((await supabase.rpc('assign_furnace', { p_job_no: jobNo, p_furnace_id: furnaceId, p_shift: shift, p_minutes: minutes, p_cycle_no: cycleNo, p_user: user })).error);
}
export async function setFurnaceTimer(loadId: number, minutesFromNow: number) {
  fail((await supabase.rpc('set_furnace_timer', { p_load_id: loadId, p_minutes_from_now: minutesFromNow })).error);
}
export async function releaseFurnaceLoad(id: number) {
  fail((await supabase.rpc('release_furnace_load', { p_load_id: id })).error);
}

/**
 * The furnaces and what is loaded in them. A load whose timer has run out counts as free (it is released for good the next time a
 * batch is loaded or Heat Treatment is completed). Re-read on every store reload and once a minute so the timers stay current.
 */
export function useFurnaces() {
  const { state } = useStore();
  const [data, setData] = useState<{ furnaces: Furnace[]; loads: FurnaceLoad[] }>({ furnaces: [], loads: [] });
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    try {
      setData(await fetchFurnaces());
    } catch {
      setData({ furnaces: [], loads: [] });
    }
    setNow(Date.now());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, state]);
  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const active = data.furnaces.filter((f) => f.active);
  /** the load that is still running in a furnace (null = free) */
  const runningIn = (furnaceId: number) => data.loads.find((l) => l.furnaceId === furnaceId && Date.parse(l.endsAt) > now) ?? null;
  const loadOfJob = (jobNo: string) => data.loads.find((l) => l.jobNo === jobNo) ?? null;
  const free = active.filter((f) => !runningIn(f.id));
  /** when the next furnace frees up (ms), or null if one is free now / there are no furnaces */
  const nextFreeAt = () => {
    if (!active.length || free.length) return null;
    return Math.min(...active.map((f) => Date.parse(runningIn(f.id)!.endsAt)));
  };
  return { ...data, active, free, runningIn, loadOfJob, nextFreeAt, now, refresh, hasFurnaces: active.length > 0 };
}

export const fmtTime = (iso: string | number) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const fmtLeft = (endsAt: string, now: number) => {
  const m = Math.max(0, Math.round((Date.parse(endsAt) - now) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''} left` : `${m} min left`;
};
