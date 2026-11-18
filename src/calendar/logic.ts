// Pure calendar rules (no screen, no database), so they can be tested on their own: npm run test:calendar
export type EventKind = 'meeting' | 'task';

export interface CalEvent {
  id: number;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  kind: EventKind;
  /** the role the event belongs to (same list as the sign-in roles) */
  roleId: string;
  /** who created it */
  userId: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** the database sends 09:30:00; the screen works with 09:30 */
export const hhmm = (t: string) => t.slice(0, 5);

/** 14:05 → 02:05 pm */
export function time12(t: string) {
  const [h, m] = hhmm(t).split(':').map(Number);
  return `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(m)} ${h >= 12 ? 'pm' : 'am'}`;
}

export interface Cell { iso: string; day: number; inMonth: boolean }

/** Six weeks, Monday first, always 42 cells so the grid never changes height. month is 0-11. */
export function monthGrid(year: number, month: number): Cell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const out: Cell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    out.push({ iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return out;
}

/** events of each day, earliest first */
export function groupByDate(events: CalEvent[]): Map<string, CalEvent[]> {
  const m = new Map<string, CalEvent[]>();
  for (const e of events) m.set(e.date, [...(m.get(e.date) ?? []), e]);
  for (const list of m.values()) list.sort((a, b) => hhmm(a.time).localeCompare(hhmm(b.time)) || a.id - b.id);
  return m;
}

export const startOf = (e: CalEvent) => new Date(`${e.date}T${hhmm(e.time)}:00`);

/** An event that was due a long time ago (the app was closed) is not shown as a reminder any more. */
export const REMIND_GRACE_MIN = 30;

/** Events whose time has arrived (and not longer ago than the grace period) that were not reminded yet. */
export function dueEvents(events: CalEvent[], now: Date, reminded: ReadonlySet<number>): CalEvent[] {
  return events
    .filter((e) => {
      const ms = now.getTime() - startOf(e).getTime();
      return ms >= 0 && ms <= REMIND_GRACE_MIN * 60_000 && !reminded.has(e.id);
    })
    .sort((a, b) => startOf(a).getTime() - startOf(b).getTime());
}
