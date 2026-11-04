import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dbMessage } from '../db/client';
import { loadERPState, loadMasters, type Masters } from '../db/load';
import { useAccess } from '../auth/access';
import type { ERPState, ProcessStage } from './types';
import { actionParent, actionToHash, closeForm, hashToAction, openForm } from './forms';

/** A shop-floor action that opens its form wherever the user is (page, dashboard, drawer, bell menu). */
export type Action =
  | { kind: 'newJob' }
  | { kind: 'jobWork' }
  | { kind: 'product'; id?: string; /** show the record read-only (same form, nothing editable) */ view?: boolean }
  | { kind: 'inward'; material?: string; od?: number; /** a lot to correct (edit) instead of a new inward */ id?: string; view?: boolean }
  | { kind: 'stage'; stage: ProcessStage; jobNo: string }
  | { kind: 'qc'; jobNo: string }
  | { kind: 'hardness'; id?: string; jobNo?: string; view?: boolean }
  | { kind: 'dispatch'; fgId: string };

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
}

/** which page an action belongs to — the page whose Write access it needs */
export function actionPage(a: Action): { key: string; label: string } | null {
  switch (a.kind) {
    case 'newJob':
      return { key: 'cutting', label: 'Cutting' };
    case 'jobWork':
      return { key: 'job_work', label: 'Job Work In' };
    case 'product':
      return { key: 'products', label: 'Product Master' };
    case 'inward':
      return { key: 'raw_inventory', label: 'Raw Inventory' };
    case 'stage':
      return a.stage === 'heatTreatment' ? { key: 'heat_treatment', label: 'Heat Treatment' } : { key: a.stage, label: a.stage[0].toUpperCase() + a.stage.slice(1) };
    case 'qc':
    case 'hardness':
      return { key: 'qc', label: 'Quality Control' };
    case 'dispatch':
      return { key: 'dispatch', label: 'Dispatch' };
    default:
      return null;
  }
}

interface StoreValue {
  /** Everything the screens read — loaded from Supabase (confidential columns already withheld by the database). */
  state: ERPState;
  /** dropdown lists (suppliers / customers are empty for roles without access) */
  masters: Masters;
  /** re-reads everything from the database */
  refresh: () => Promise<void>;
  /** when the data on screen was last read from the database (ms) */
  loadedAt: number;
  /**
   * Runs one database action (a single transaction on the server). On success the data is re-read and a toast shown;
   * on failure the database's own message is shown. Resolves to true on success.
   */
  run: (fn: (nowIso: string) => Promise<unknown>, success?: { title: string; message?: string }) => Promise<boolean>;
  /** true while an action is being saved: the buttons that start one are disabled, and a second push is ignored */
  busy: boolean;
  toast: (t: Omit<Toast, 'id'>) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  traceJob: string | null;
  openTrace: (jobNo: string | null) => void;
  action: Action | null;
  openAction: (a: Action | null) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { logout, canWrite, canRead, reloadAccess } = useAccess();
  const [data, setData] = useState<{ state: ERPState; masters: Masters } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [traceJob, setTraceJob] = useState<string | null>(null);
  // a form is a page with its own address (see forms.ts); only the hardness sheet viewer is still a pop-up
  const [overlay, setOverlay] = useState<Action | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);
  const hashAction = useMemo(() => {
    const [route, q = ''] = hash.replace(/^#\/?/, '').split('?');
    return hashToAction(route, new URLSearchParams(q));
  }, [hash]);
  const action = overlay ?? hashAction;
  const seq = useRef(0);
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);
  // while an action is being saved the row icons are greyed out (styles.css), so a second push cannot happen
  useEffect(() => {
    document.body.toggleAttribute('data-busy', busy);
    return () => document.body.removeAttribute('data-busy');
  }, [busy]);

  const [loadedAt, setLoadedAt] = useState(0);
  const loadedRef = useRef(0);
  const fetchAll = useCallback(async () => {
    const [state, masters] = await Promise.all([loadERPState(), loadMasters()]);
    setData({ state, masters });
    loadedRef.current = Date.now();
    setLoadedAt(loadedRef.current);
  }, []);

  // other people work in the system too: when this tab is looked at again after 2 minutes, what is on screen is read again
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && !runningRef.current && loadedRef.current && Date.now() - loadedRef.current > 120_000) void fetchAll().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
    };
  }, [fetchAll]);

  const load = useCallback(() => {
    setLoadError('');
    fetchAll().catch((e) => setLoadError(dbMessage(e)));
  }, [fetchAll]);
  useEffect(load, [load]);

  // Navigating to another page closes any open form or job drawer.
  useEffect(() => {
    const close = () => {
      setOverlay(null);
      setTraceJob(null);
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-1), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'error' ? 6000 : 4000);
    },
    [dismiss],
  );

  const run = useCallback<StoreValue['run']>(
    async (fn, success) => {
      // an action is already being saved (a double click, or a second button): the second push is ignored, so nothing is saved twice
      if (runningRef.current) return false;
      runningRef.current = true;
      setBusy(true);
      try {
        try {
          await fn(new Date().toISOString());
        } catch (e) {
          toast({ kind: 'error', title: 'Action not allowed', message: dbMessage(e) });
          return false;
        }
        try {
          await fetchAll();
        } catch (e) {
          toast({ kind: 'error', title: 'Saved, but the screen could not refresh', message: dbMessage(e) });
          return true;
        }
        void reloadAccess();
        if (success) toast({ kind: 'success', ...success });
        return true;
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [fetchAll, toast, reloadAccess],
  );

  const refresh = useCallback(() => fetchAll().catch((e) => toast({ kind: 'error', title: 'Could not refresh', message: dbMessage(e) })), [fetchAll, toast]);

  const guardedOpen = useCallback(
    (a: Action | null) => {
      if (a) {
        const res = actionPage(a);
        if (res && !(('view' in a && a.view) ? canRead(res.key) : canWrite(res.key))) {
          toast({ kind: 'error', title: 'View only', message: `You can view ${res.label} but not change it. Ask the Director or Plant Head for Write access.` });
          return;
        }
      }
      if (!a) {
        if (hashAction) closeForm(actionParent(hashAction));
        else setOverlay(null);
        return;
      }
      const to = actionToHash(a);
      if (to) openForm(to);
      else setOverlay(a);
    },
    [canWrite, canRead, toast, hashAction],
  );

  const value = useMemo(
    () =>
      data && {
        state: data.state,
        masters: data.masters,
        refresh,
        loadedAt,
        run,
        busy,
        toast,
        toasts,
        dismiss,
        traceJob,
        openTrace: setTraceJob,
        action,
        openAction: guardedOpen,
      },
    [data, refresh, loadedAt, run, busy, toast, toasts, dismiss, traceJob, action, guardedOpen],
  );

  if (!value) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ gridTemplateColumns: '1fr', maxWidth: 440, padding: 36, textAlign: 'center' }}>
          {loadError ? (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Could not load the plant data</h2>
              <p className="muted" style={{ margin: '0 0 18px', wordBreak: 'break-word' }}>{loadError}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={load}>
                  Try again
                </button>
                <button className="btn" onClick={() => void logout()}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Loading plant data…</h2>
              <p className="muted" style={{ margin: 0 }}>Reading from the database.</p>
            </>
          )}
        </div>
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
