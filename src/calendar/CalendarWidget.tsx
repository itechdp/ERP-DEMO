import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { ROLES, useAccess } from '../auth/access';
import { fmtDate, todayISO } from '../components/format';
import { addEvent, currentUserId, deleteEvent, fetchEvents } from './service';
import { groupByDate, monthGrid, time12, type CalEvent, type EventKind } from './logic';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The calendar page: meetings and tasks of the signed-in person's role. Click a day to see it and add an event. `onChanged` tells the dashboard card to refresh. */
export function CalendarPanel({ onChanged }: { onChanged?: () => void }) {
  const { role } = useAccess();
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
  const today = todayISO();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState(today);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [me, setMe] = useState('');
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('10:00');
  const [kind, setKind] = useState<EventKind>('meeting');
  const [busy, setBusy] = useState(false);

  const grid = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const byDate = useMemo(() => groupByDate(events), [events]);

  const load = useCallback(async () => {
    try {
      setEvents(await fetchEvents(role, grid[0].iso, grid[41].iso));
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [role, grid]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void currentUserId().then(setMe); }, []);
  // other people of the same role may add events: pick them up now and then
  useEffect(() => {
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const step = (d: number) => setYm(({ y, m }) => { const n = new Date(y, m + d, 1); return { y: n.getFullYear(), m: n.getMonth() }; });
  const pick = (iso: string) => {
    setSelected(iso);
    setDate(iso);
    const d = new Date(iso + 'T00:00:00');
    if (d.getMonth() !== ym.m || d.getFullYear() !== ym.y) setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  const goToday = () => { setYm({ y: now.getFullYear(), m: now.getMonth() }); pick(today); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || !time) { setErr('Enter a title, a date and a time.'); return; }
    setBusy(true);
    try {
      await addEvent(role, { title, date, time, kind });
      setTitle('');
      setSelected(date);
      const d = new Date(date + 'T00:00:00');
      setYm({ y: d.getFullYear(), m: d.getMonth() });
      await load();
      onChanged?.();
      setErr('');
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };
  const remove = async (id: number) => {
    try { await deleteEvent(id); await load(); onChanged?.(); } catch (x) { setErr((x as Error).message); }
  };

  const day = byDate.get(selected) ?? [];

  return (
    <div>
      <div className="cal-toolbar">
        <div className="sub">Meetings and tasks for {roleLabel}</div>
        <div className="right">
          <button className="btn btn-sm" onClick={goToday}>Today</button>
          <button className="btn btn-sm btn-subtle" onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={15} /></button>
          <span className="cal-month">{MONTHS[ym.m]} {ym.y}</span>
          <button className="btn btn-sm btn-subtle" onClick={() => step(1)} aria-label="Next month"><ChevronRight size={15} /></button>
        </div>
      </div>
      <div className="cal-body">
        <div>
          <div className="cal-grid cal-dow">{DAYS.map((d) => <span key={d}>{d}</span>)}</div>
          <div className="cal-grid">
            {grid.map((c) => {
              const list = byDate.get(c.iso) ?? [];
              return (
                <button
                  key={c.iso}
                  type="button"
                  className={`cal-day${c.inMonth ? '' : ' out'}${c.iso === today ? ' today' : ''}${c.iso === selected ? ' sel' : ''}`}
                  onClick={() => pick(c.iso)}
                  aria-label={`${fmtDate(c.iso)}${list.length ? `, ${list.length} event${list.length === 1 ? '' : 's'}` : ''}`}
                >
                  <span className="n">{c.day}</span>
                  {list.length > 0 && (
                    <span className="dots">
                      {list.slice(0, 3).map((e) => <i key={e.id} className={e.kind} />)}
                      {list.length > 3 && <small>+{list.length - 3}</small>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cal-side">
          <h4>{fmtDate(selected)}{selected === today ? ' · Today' : ''}</h4>
          {err && <div className="tool-err">{err}</div>}
          {day.length === 0 ? (
            <div className="muted cal-none">No meetings or tasks on this day.</div>
          ) : (
            <ul className="cal-list">
              {day.map((e) => (
                <li key={e.id}>
                  <span className="cal-time">{time12(e.time)}</span>
                  <span className="cal-title">{e.title}</span>
                  <span className={`chip cal-kind ${e.kind}`}>{e.kind === 'task' ? 'Task' : 'Meeting'}</span>
                  {e.userId === me && (
                    <button className="btn btn-sm btn-subtle" onClick={() => void remove(e.id)} title="Delete this event" aria-label="Delete this event"><Trash2 size={13} /></button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={submit} className="cal-form">
            <div className="field cal-f-title"><label>Title <span className="req">*</span></label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Production review" required /></div>
            <div className="field"><label>Date <span className="req">*</span></label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="field"><label>Time <span className="req">*</span></label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
            <div className="field"><label>Type</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)}><option value="meeting">Meeting</option><option value="task">Task</option></select>
            </div>
            <button className="btn btn-primary cal-add" disabled={busy}><Plus size={15} /> Add Event</button>
          </form>
        </div>
      </div>
    </div>
  );
}
