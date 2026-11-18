import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Modal } from '../components/ui';
import { isoOf, dueEvents, time12, type CalEvent } from './logic';
import { fetchEvents } from './service';

const KEY = 'forgeflow.calendar.reminded';
const loadSeen = (): Set<number> => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); } };
const saveSeen = (s: Set<number>) => { try { localStorage.setItem(KEY, JSON.stringify([...s].slice(-300))); } catch { /* storage blocked: it may remind again after a reload */ } };

/**
 * Pop-up reminder at the time of a meeting or task. Mounted once for the whole app (not only the dashboard), so it also
 * appears while the person is on another page. Each event reminds once; one that was due long ago (app was closed) does not.
 */
export function CalendarReminders() {
  const { role } = useAccess();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [popup, setPopup] = useState<CalEvent[]>([]);
  const seen = useRef<Set<number>>(loadSeen());

  const load = useCallback(async () => {
    try {
      const t = new Date();
      const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1); // yesterday too: a late-night event can be due just after midnight
      setEvents(await fetchEvents(role, isoOf(y), isoOf(t)));
    } catch { /* no calendar table yet, or offline: simply no reminders */ }
  }, [role]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    const onFocus = () => document.visibilityState !== 'hidden' && void load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    const check = () => {
      const due = dueEvents(events, new Date(), seen.current);
      if (!due.length) return;
      due.forEach((e) => seen.current.add(e.id));
      saveSeen(seen.current);
      setPopup((cur) => [...cur, ...due.filter((e) => !cur.some((c) => c.id === e.id))]);
    };
    check();
    const t = window.setInterval(check, 10_000);
    return () => window.clearInterval(t);
  }, [events]);

  return (
    <Modal dialog open={popup.length > 0} title={popup.length > 1 ? 'Reminders' : 'Reminder'} icon={BellRing} onClose={() => setPopup([])}
      footer={<button className="btn btn-primary" onClick={() => setPopup([])}>Got it</button>}>
      <ul className="cal-rem">
        {popup.map((e) => (
          <li key={e.id}>
            <span className={`chip cal-kind ${e.kind}`}>{e.kind === 'task' ? 'Task' : 'Meeting'}</span>
            <div><div className="strong">{e.title}</div><div className="muted">Scheduled for {time12(e.time)}</div></div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
