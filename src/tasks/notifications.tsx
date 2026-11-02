import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchRecent, markSeen, type AppNotification } from './service';

const POLL_MS = 20000;

interface Value {
  /** the latest notifications, newest first (seen and unseen) — the bell's history */
  all: AppNotification[];
  unseen: number;
  /** the unseen ones that have not been shown as a popup yet */
  popups: AppNotification[];
  /** mark these as seen (a popup dismissed, an entry opened) */
  read: (ids: number[]) => void;
  readAll: () => void;
}

const Ctx = createContext<Value | null>(null);

/**
 * One source for the popups and the bell. It reads the notifications at start (so anything missed while signed out pops up),
 * then every few seconds and whenever the person comes back to the tab.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = useState<AppNotification[]>([]);
  const [popups, setPopups] = useState<AppNotification[]>([]);
  const popped = useRef(new Set<number>());

  const check = useCallback(async () => {
    const list = await fetchRecent();
    setAll(list);
    const fresh = list.filter((n) => !n.seenAt && !popped.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => popped.current.add(n.id));
    setPopups((cur) => [...[...fresh].reverse(), ...cur].slice(0, 5));
  }, []);

  useEffect(() => {
    void check();
    const t = window.setInterval(() => void check(), POLL_MS);
    const onFocus = () => document.visibilityState !== 'hidden' && void check();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [check]);

  const read = useCallback((ids: number[]) => {
    const now = new Date().toISOString();
    setAll((cur) => cur.map((n) => (ids.includes(n.id) && !n.seenAt ? { ...n, seenAt: now } : n)));
    setPopups((cur) => cur.filter((n) => !ids.includes(n.id)));
    void markSeen(ids);
  }, []);

  const value = useMemo<Value>(
    () => ({
      all,
      unseen: all.filter((n) => !n.seenAt).length,
      popups,
      read,
      readAll: () => read(all.filter((n) => !n.seenAt).map((n) => n.id)),
    }),
    [all, popups, read],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotifications() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useNotifications outside NotificationProvider');
  return v;
}
