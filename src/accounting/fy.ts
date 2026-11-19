// ---------------------------------------------------------------------------
// Indian Financial Year: 1 April (startYear) → 31 March (startYear + 1).
// All date maths works on "YYYY-MM-DD" strings only — never new Date() on a date — so a date never shifts across 1 April by time zone.
// ---------------------------------------------------------------------------
import { useSyncExternalStore } from 'react';

export type FyRange = { startYear: number; label: string; start: string; end: string };

/** A voucher's effective date: its own date, else the day it was created. */
export const dateOf = (specific: string | null | undefined, createdAt: string) => (specific || createdAt || '').slice(0, 10);

export function fyRange(startYear: number): FyRange {
  return { startYear, start: `${startYear}-04-01`, end: `${startYear + 1}-03-31`, label: `01/04/${startYear} - 31/03/${startYear + 1}` };
}

/** which FY start-year a "YYYY-MM-DD" date falls into */
export function fyStartYearOf(dateStr: string): number {
  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  return month >= 4 ? year : year - 1;
}

export const fyOf = (dateStr: string) => fyRange(fyStartYearOf(dateStr));

/** today as YYYY-MM-DD in local time */
export const todayDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const currentFy = () => fyOf(todayDate());

export const inFy = (dateStr: string, range: FyRange) => dateStr >= range.start && dateStr <= range.end;

/** every FY from the one holding `earliestDate` up to the current one, newest first */
export function listFinancialYears(earliestDate: string | null): FyRange[] {
  const current = currentFy();
  const first = earliestDate ? Math.min(fyStartYearOf(earliestDate), current.startYear) : current.startYear;
  const years: FyRange[] = [];
  for (let y = current.startYear; y >= first; y--) years.push(fyRange(y));
  return years;
}

/** rows dated before range.start and rows within [start, end] */
export function splitByFy<T extends { date: string }>(rows: T[], range: FyRange): { before: T[]; within: T[] } {
  const before: T[] = [];
  const within: T[] = [];
  for (const row of rows) {
    if (row.date < range.start) before.push(row);
    else if (row.date <= range.end) within.push(row);
  }
  return { before, within };
}

/** the calendar day before (UTC maths, no time-zone drift) */
export function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** a date plus n days (UTC maths) */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A range ending the day before `range.start` — the balances "as of" it are each account's OPENING balance for `range`. */
export const openingCutoff = (range: FyRange): FyRange => ({ startYear: range.startYear, start: range.start, end: dayBefore(range.start), label: '' });

/** an arbitrary from/to range shaped like an FY (custom date filters) */
export const customDateRange = (from: string, to: string): FyRange => ({ startYear: fyStartYearOf(from), start: from, end: to, label: `${from} to ${to}` });

/** two-digit FY code used in voucher numbers: 2026 → "2627" */
export const fyShort = (range: FyRange) => `${String(range.startYear).slice(-2)}${String(range.startYear + 1).slice(-2)}`;

/** a new voucher's default date in the selected FY: today if that FY is the current one, else its last day */
export const defaultVoucherDate = (range: FyRange) => (range.startYear === currentFy().startYear ? todayDate() : range.end);

// ------------------------------------------------------ the selected FY ---
// Shared by every accounting page and remembered on this device (the header's FY selector).
const KEY = 'forgeflow.acc.fy';
const listeners = new Set<() => void>();
const readStored = (): number | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
};
let selected: FyRange = (() => {
  const y = readStored();
  return y && y > 1990 && y <= currentFy().startYear ? fyRange(y) : currentFy();
})();

export function setSelectedFy(fy: FyRange) {
  selected = fy;
  try {
    localStorage.setItem(KEY, String(fy.startYear));
  } catch {
    /* private mode — the choice just is not remembered */
  }
  listeners.forEach((l) => l());
}

export function useFy(): [FyRange, (fy: FyRange) => void] {
  const fy = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selected,
  );
  return [fy, setSelectedFy];
}
