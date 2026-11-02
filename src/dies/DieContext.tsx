// ---------------------------------------------------------------------------
// Die Management state — loaded from Supabase (v_main_dies, v_dies, die_history, die_maintenance, die_issues).
//
// Every change is one database function (save_main_die, save_die, replace_die, record_maintenance, issue_die, return_die):
// it validates, writes the die AND its history line in one transaction. The history timeline is written by database
// triggers, so every path logs the same events. Pictures go to the private `die-images` bucket.
// Nothing is ever deleted: dies are Retired / Damaged, main dies are made Inactive.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../store/StoreContext';
import { useAccess } from '../auth/access';
import { dbMessage } from '../db/client';
import { loadDieData } from '../db/load';
import * as api from '../db/api';
import { emptyDieData } from './seed';
import { closeForm, dieUiParent, dieUiToHash, hashToDieUi, openForm } from '../store/forms';
import { KIND_LABEL, KIND_PREFIX, type Die, type DieData, type DieKind, type DieStatus, type Dims, type MainDie } from './types';

// ------------------------------------------------------------------ input ---
/** What the die form edits. Pictures are data URLs here (or the signed link of an existing picture); the API uploads new ones. */
export interface DieInput {
  mainCode: string;
  material: string;
  top: Dims;
  bottom: Dims;
  topWeight?: number;
  bottomWeight?: number;
  makingDate: string;
  maker: string;
  drawingNo: string;
  revision: string;
  topUrl: string;
  bottomUrl: string;
  status: DieStatus;
  remarks: string;
  location: string;
  cost?: number;
  pieces: number;
}
export type MainInput = Omit<MainDie, 'code' | 'demo'>;

export type DieUI =
  | { kind: 'main-form'; code?: string }
  | { kind: 'die-form'; dieKind: DieKind; code?: string; mainCode?: string }
  | { kind: 'die-view'; dieKind: DieKind; code: string }
  | { kind: 'replace'; dieKind: DieKind; code: string }
  | { kind: 'maintenance'; dieKind: DieKind; code: string }
  | { kind: 'issue'; dieKind: DieKind; code: string }
  | { kind: 'return'; dieKind: DieKind; code: string };

interface DieStore {
  data: DieData;
  ui: DieUI | null;
  openUI: (u: DieUI | null) => void;
  /** Each resolves to the saved code, or null when the database refused it (a toast explains why). */
  saveMain: (input: MainInput, code?: string) => Promise<string | null>;
  saveDie: (kind: DieKind, input: DieInput, code?: string) => Promise<string | null>;
  replaceDie: (kind: DieKind, oldCode: string, input: DieInput, oldStatus: DieStatus, reason: string) => Promise<string | null>;
  recordMaintenance: (kind: DieKind, code: string, v: { date: string; remarks: string; status: DieStatus }) => Promise<boolean>;
  issueDie: (kind: DieKind, code: string, v: { date: string; issuedTo: string; remarks: string }) => Promise<boolean>;
  returnDie: (kind: DieKind, code: string, v: { date: string; pieces: number; remarks: string; status: DieStatus }) => Promise<boolean>;
  diesOf: (kind: DieKind) => Die[];
  findDie: (kind: DieKind, code: string) => Die | undefined;
  /** next code the database will assign (preview only — the database decides) */
  nextMainCode: () => string;
  /** suggested part code for a new main die: EAF-PRT-0001 … (editable) */
  nextPartCode: () => string;
  nextDieCode: (kind: DieKind) => string;
}

/** which page a die form needs Write access on */
export const dieUiResource = (u: DieUI) => (u.kind === 'main-form' ? { key: 'die_master', label: 'Die Master' } : u.dieKind === 'forging' ? { key: 'forging_dies', label: 'Forging Die Master' } : { key: 'trimming_dies', label: 'Trimming Die Master' });

const Ctx = createContext<DieStore | null>(null);

const collKey = (k: DieKind) => (k === 'forging' ? 'forgingDies' : 'trimmingDies') as 'forgingDies' | 'trimmingDies';
const nextCode = (prefix: string, codes: string[]) => {
  const max = codes.reduce((m, c) => Math.max(m, Number(c.split('-').pop()) || 0), 0);
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
};

export function DieProvider({ children }: { children: ReactNode }) {
  const { toast } = useStore();
  const { canWrite } = useAccess();
  const [data, setData] = useState<DieData>(emptyDieData);
  // die forms are pages with their own address (see store/forms.ts); only the die viewer is still a pop-up
  const [overlay, setOverlay] = useState<DieUI | null>(null);
  const [hash, setHash] = useState(() => window.location.hash);
  const hashUi = useMemo(() => {
    const [route, q = ''] = hash.replace(/^#\/?/, '').split('?');
    return hashToDieUi(route, new URLSearchParams(q));
  }, [hash]);
  const ui = overlay ?? hashUi;

  const reload = useCallback(async () => setData(await loadDieData()), []);

  useEffect(() => {
    reload().catch((e) => toast({ kind: 'error', title: 'Could not load dies', message: dbMessage(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    const close = () => {
      setOverlay(null);
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  /** Runs a database call; on success refreshes the die data and shows the toast, on failure shows the database's message. */
  const act = useCallback(
    async <T,>(fn: () => Promise<T>, success: { title: string; message?: string } | ((r: T) => { title: string; message?: string })): Promise<{ ok: true; value: T } | { ok: false }> => {
      let value: T;
      try {
        value = await fn();
      } catch (e) {
        toast({ kind: 'error', title: 'Cannot save', message: dbMessage(e) });
        return { ok: false };
      }
      try {
        await reload();
      } catch (e) {
        toast({ kind: 'error', title: 'Saved, but the screen could not refresh', message: dbMessage(e) });
      }
      toast({ kind: 'success', ...(typeof success === 'function' ? success(value) : success) });
      return { ok: true, value };
    },
    [reload, toast],
  );

  const saveMain: DieStore['saveMain'] = async (input, code) => {
    const r = await act(() => api.saveMainDie(input, code), (saved) => ({ title: code ? 'Main die updated' : 'Main die added', message: `${saved} · ${input.name.trim()}` }));
    return r.ok ? r.value : null;
  };

  const saveDie: DieStore['saveDie'] = async (kind, input, code) => {
    const cur = code ? data[collKey(kind)].find((x) => x.code === code) : undefined;
    const r = await act(() => api.saveDie(kind, input, code, cur), (saved) => ({ title: code ? `${KIND_LABEL[kind]} die updated` : `${KIND_LABEL[kind]} die added`, message: `${saved} saved for ${input.mainCode}.` }));
    return r.ok ? r.value : null;
  };

  const replaceDie: DieStore['replaceDie'] = async (kind, oldCode, input, oldStatus, reason) => {
    const other = kind === 'forging' ? 'trimming' : 'forging';
    const r = await act(() => api.replaceDie(kind, oldCode, input, oldStatus, reason), (newCode) => ({
      title: `${newCode} created as replacement`,
      message: `${oldCode} kept as ${oldStatus}. ${KIND_LABEL[other]} dies of this component are unchanged.`,
    }));
    return r.ok ? r.value : null;
  };

  const recordMaintenance: DieStore['recordMaintenance'] = async (_kind, code, v) =>
    (await act(() => api.recordMaintenance(code, v), { title: 'Maintenance recorded', message: code })).ok;

  const issueDie: DieStore['issueDie'] = async (_kind, code, v) =>
    (await act(() => api.issueDie(code, v), { title: 'Die issued', message: `${code} → ${v.issuedTo.trim()}` })).ok;

  const returnDie: DieStore['returnDie'] = async (_kind, code, v) =>
    (await act(() => api.returnDie(code, v), { title: 'Die returned', message: `${code} · ${v.pieces} pieces added to its count` })).ok;

  const value: DieStore = {
    data,
    ui,
    openUI: (u) => {
      if (u && u.kind !== 'die-view') {
        const res = dieUiResource(u);
        if (!canWrite(res.key)) {
          toast({ kind: 'error', title: 'View only', message: `You can view ${res.label} but not change it. Ask the Director or Plant Head for Write access.` });
          return;
        }
      }
      if (!u) {
        if (hashUi) closeForm(dieUiParent(hashUi));
        else setOverlay(null);
        return;
      }
      const to = dieUiToHash(u);
      setOverlay(null);
      if (to) openForm(to);
      else setOverlay(u);
    },
    saveMain,
    saveDie,
    replaceDie,
    recordMaintenance,
    issueDie,
    returnDie,
    diesOf: (k) => data[collKey(k)],
    findDie: (k, c) => data[collKey(k)].find((x) => x.code === c),
    nextMainCode: () => nextCode('EAF', data.mainDies.map((m) => m.code)),
    nextPartCode: () => nextCode('EAF-PRT', data.mainDies.map((m) => m.partCode).filter((c) => /^EAF-PRT-\d+$/i.test(c))),
    nextDieCode: (k) => nextCode(KIND_PREFIX[k], data[collKey(k)].map((x) => x.code)),
  };
  // value identity changes with data, which is exactly when consumers need to re-render
  return <Ctx.Provider value={useMemo(() => value, [data, ui, hashUi])}>{children}</Ctx.Provider>; // eslint-disable-line react-hooks/exhaustive-deps
}

export function useDies() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDies outside DieProvider');
  return v;
}
