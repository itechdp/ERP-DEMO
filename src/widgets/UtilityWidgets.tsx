import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Calculator, CalendarDays, Check, Copy, History as HistoryIcon, Pencil, Plus, Scale, Trash2, Wallet, X } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Kpi, Modal } from '../components/ui';
import { CalendarPanel } from '../calendar/CalendarWidget';
import { fetchEvents } from '../calendar/service';
import { isoOf, startOf, time12, type CalEvent } from '../calendar/logic';
import { fmtDate, fmtKg, todayISO } from '../components/format';
import { addMaterialLog, addPettyCash, deleteMaterialLog, deletePettyCash, fetchMaterialLog, fetchPettyCash, updateMaterialLog, updatePettyCash, type MaterialLogRow, type PettyCashRow } from './service';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Loads a list once, reloads after a change, and keeps an error message. */
function useRows<T>(load: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(async () => {
    try { setRows(await load()); setErr(''); } catch (e) { setErr((e as Error).message); setRows((r) => r ?? []); }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  return { rows: rows ?? [], loaded: rows !== null, err, setErr, reload };
}

/**
 * Three small cards that sit under the dashboard boxes, same look. Clicking one opens its tool in a pop-up.
 * Standalone: nothing here touches inventory or accounting. A failed load only shows inside the pop-up.
 */
export function UtilityWidgets() {
  const [open, setOpen] = useState<'calc' | 'cash' | 'log' | 'cal' | null>(null);
  const { role } = useAccess();
  const [today, setToday] = useState<CalEvent[]>([]);
  const loadToday = useCallback(async () => {
    const t = isoOf(new Date());
    try { setToday(await fetchEvents(role, t, t)); } catch { setToday([]); } // no calendar table yet: the card just shows 0
  }, [role]);
  useEffect(() => {
    void loadToday();
    const id = window.setInterval(() => void loadToday(), 60_000);
    return () => window.clearInterval(id);
  }, [loadToday]);
  const next = today.find((e) => startOf(e).getTime() >= Date.now());
  const cash = useRows<PettyCashRow>(fetchPettyCash);
  const log = useRows<MaterialLogRow>(fetchMaterialLog);
  const cashTotal = cash.rows.reduce((t, r) => t + r.amount, 0);
  const kgTotal = log.rows.reduce((t, r) => t + r.weightKg, 0);
  const close = () => { setOpen(null); void loadToday(); };

  return (
    <>
      <div className="kpis k5">
        <Kpi label="Tap to open" value="Calculator" icon={Calculator} tone="blue" onClick={() => setOpen('calc')} />
        <Kpi label="Petty Cash Tracker" value={inr(cashTotal)} icon={Wallet} tone="green" hint={`${cash.rows.length} entr${cash.rows.length === 1 ? 'y' : 'ies'} · total amount`} onClick={() => setOpen('cash')} />
        <Kpi label="Quick Material Log" value={kgTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })} unit="KG" icon={Scale} tone="amber" hint={`${log.rows.length} unload${log.rows.length === 1 ? '' : 's'} · not added to stock`} onClick={() => setOpen('log')} />
        <Kpi label="Calendar" value={today.length} unit="events" icon={CalendarDays} tone="violet" hint={next ? `Next: ${time12(next.time)} · ${next.title}` : today.length ? 'No more events today' : 'Meetings & tasks · tap to open'} onClick={() => setOpen('cal')} />
      </div>

      <Modal open={open === 'calc'} title="Calculator" icon={Calculator} onClose={close}><CalculatorTool /></Modal>
      <Modal open={open === 'cash'} title="Petty Cash Tracker" icon={Wallet} onClose={close}><PettyCashTool {...cash} total={cashTotal} /></Modal>
      <Modal open={open === 'cal'} title="Calendar" subtitle="Meetings and tasks for your role. Click a day to see it or add an event." icon={CalendarDays} onClose={close}><CalendarPanel onChanged={() => void loadToday()} /></Modal>
      <Modal open={open === 'log'} title="Quick Material Log" subtitle="A scratchpad for truck unloads. It does not change stock." icon={Scale} onClose={close}><MaterialLogTool {...log} /></Modal>
    </>
  );
}


/** From / To date filter. Pick the same day in both (or only "From") to see a single day. */
function useDateFilter<T extends { date: string }>(rows: T[]) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const shown = rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
  const on = !!(from || to);
  const bar = (
    <div className="tool-filter">
      <label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="From date" /></label>
      <label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" /></label>
      <button type="button" className="btn btn-sm" onClick={() => { const t = todayISO(); setFrom(t); setTo(t); }}>Today</button>
      {on && <button type="button" className="btn btn-sm btn-subtle" onClick={() => { setFrom(''); setTo(''); }}><X size={13} /> Clear</button>}
      <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>{on ? `Showing ${shown.length} of ${rows.length} entries` : `${rows.length} entries`}</span>
    </div>
  );
  return { shown, on, bar };
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** One saved entry per row: No., Date, Time, Description, Amount, Edit / Delete. Edit turns the row's cells into inputs. */
function EntryTable({ rows, loaded, emptyText, err, valueLabel, valueStep, textLabel, show: showVal, getText, getValue, onSave, onDelete, footer }: {
  rows: { id: number; date: string; createdAt: string }[]; loaded: boolean; emptyText?: string; err: string; valueLabel: string; valueStep: string; textLabel: string;
  show: (id: number) => string; getText: (id: number) => string; getValue: (id: number) => number;
  onSave: (id: number, date: string, value: number, text: string) => Promise<void>; onDelete: (id: number) => Promise<void>; footer?: React.ReactNode;
}) {
  const [editId, setEditId] = useState<number | null>(null);
  const [d, setD] = useState('');
  const [v, setV] = useState('');
  const [t, setT] = useState('');
  const [bad, setBad] = useState('');
  const start = (id: number, date: string) => { setEditId(id); setD(date); setV(String(getValue(id))); setT(getText(id)); setBad(''); };
  const save = async (id: number) => {
    const n = parseFloat(v);
    if (!d || !(n > 0) || !t.trim()) { setBad(`Enter a date, a ${valueLabel.toLowerCase()} above 0 and a ${textLabel.toLowerCase()}.`); return; }
    try { await onSave(id, d, n, t); setEditId(null); } catch (x) { setBad((x as Error).message); }
  };
  return (
    <>
      {bad && <div className="tool-err">{bad}</div>}
      <div className="table-wrap">
        <table className="tbl compact">
          <thead>
            <tr><th>#</th><th>Date</th><th>Time</th><th>{textLabel}</th><th className="r">{valueLabel}</th><th className="r">Action</th></tr>
          </thead>
          <tbody>
            {loaded && rows.length === 0 && !err && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>{emptyText ?? 'No entries yet.'}</td></tr>}
            {rows.map((r, i) =>
              editId === r.id ? (
                <tr key={r.id}>
                  <td className="muted">{rows.length - i}</td>
                  <td><input type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label="Date" /></td>
                  <td className="muted nowrap">{timeOf(r.createdAt)}</td>
                  <td><input value={t} onChange={(e) => setT(e.target.value)} aria-label={textLabel} /></td>
                  <td><input type="number" min="0.01" step={valueStep} className="r" value={v} onChange={(e) => setV(e.target.value)} aria-label={valueLabel} style={{ textAlign: 'right' }} /></td>
                  <td className="r nowrap">
                    <button className="btn btn-sm btn-primary" title="Save" aria-label="Save" onClick={() => void save(r.id)}><Check size={13} /></button>{' '}
                    <button className="btn btn-sm btn-subtle" title="Cancel" aria-label="Cancel" onClick={() => setEditId(null)}><X size={13} /></button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td className="muted">{rows.length - i}</td>
                  <td className="nowrap">{fmtDate(r.date)}</td>
                  <td className="muted nowrap">{timeOf(r.createdAt)}</td>
                  <td className="strong">{getText(r.id)}</td>
                  <td className="r num strong nowrap">{showVal(r.id)}</td>
                  <td className="r nowrap">
                    <button className="btn btn-sm btn-subtle" title="Edit entry" aria-label="Edit entry" onClick={() => start(r.id, r.date)}><Pencil size={13} /></button>{' '}
                    <button className="btn btn-sm btn-subtle" title="Delete entry" aria-label="Delete entry" onClick={() => void onDelete(r.id)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
          {footer}
        </table>
      </div>
    </>
  );
}

/* ---------------- Calculator ---------------- */
// A real expression calculator (no eval): brackets, × ÷ before + −, powers, √, and % that works like a phone calculator
// (200 + 10% = 220, 200 × 10% = 20). Keyboard input, memory keys and a saved history.

/** Evaluates an expression written with + − × ÷ ^ ( ) % √. Throws an Error with a plain message when it cannot. */
function evaluate(src: string): number {
  let s = src.replace(/[+−×÷^√(]+$/, ''); // a dangling operator is ignored while typing
  if (!s) throw new Error('empty');
  const open = (s.match(/\(/g) ?? []).length - (s.match(/\)/g) ?? []).length;
  if (open > 0) s += ')'.repeat(open);
  const toks = s.match(/\d+\.?\d*|\.\d+|[+−×÷^()%√]/g) ?? [];
  let i = 0;
  const peek = () => toks[i];
  type R = { v: number; pct: boolean };
  const bad = () => new Error('Incomplete expression');
  const expr = (): R => {
    let l = term();
    while (peek() === '+' || peek() === '−') {
      const o = toks[i++];
      const r = term();
      const rv = r.pct ? l.v * r.v : r.v; // "200 + 10%" means 10% of 200
      l = { v: o === '+' ? l.v + rv : l.v - rv, pct: false };
    }
    return l;
  };
  const term = (): R => {
    let l = unary();
    while (peek() === '×' || peek() === '÷') {
      const o = toks[i++];
      const r = unary();
      if (o === '÷' && r.v === 0) throw new Error('Cannot divide by zero');
      l = { v: o === '×' ? l.v * r.v : l.v / r.v, pct: false };
    }
    return l;
  };
  const unary = (): R => {
    if (peek() === '−') { i++; return { v: -unary().v, pct: false }; }
    if (peek() === '+') { i++; return unary(); }
    return power();
  };
  const power = (): R => {
    const b = postfix();
    if (peek() === '^') { i++; return { v: Math.pow(b.v, unary().v), pct: false }; }
    return b;
  };
  const postfix = (): R => {
    let r = primary();
    while (peek() === '%') { i++; r = { v: r.v / 100, pct: true }; }
    return r;
  };
  const primary = (): R => {
    const t = toks[i++];
    if (t === undefined) throw bad();
    if (t === '(') { const r = expr(); if (toks[i++] !== ')') throw bad(); return { v: r.v, pct: false }; }
    if (t === '√') { const a = primary(); if (a.v < 0) throw new Error('Invalid input'); return { v: Math.sqrt(a.v), pct: false }; }
    const n = parseFloat(t);
    if (Number.isNaN(n)) throw bad();
    return { v: n, pct: false };
  };
  const out = expr();
  if (i !== toks.length || !Number.isFinite(out.v)) throw bad();
  return parseFloat(out.v.toPrecision(12));
}

/** a number as plain text the expression can hold again (no exponent, real minus sign) */
const plain = (n: number) => {
  let t = String(parseFloat(n.toPrecision(12)));
  if (/e/i.test(t)) t = n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
  return t.replace('-', '−');
};
const nice = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 10 });
const tryEval = (e: string): number | null => { try { return evaluate(e); } catch { return null; } };

interface CalcHist { expr: string; result: string; at: number }
const HIST_KEY = 'forgeflow.calc.history';
const loadHist = (): CalcHist[] => { try { const v = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveHist = (h: CalcHist[]) => { try { localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch { /* storage blocked: history just lasts for this visit */ } };

const isOp = (c: string) => '+−×÷^'.includes(c);
const endsValue = (e: string) => /[\d)%]$/.test(e);

function CalculatorTool() {
  const [expr, setExpr] = useState('');
  const [done, setDone] = useState(false); // the screen shows an answer: a digit starts over, an operator carries on from it
  const [msg, setMsg] = useState('');
  const [mem, setMem] = useState<number | null>(null);
  const [hist, setHist] = useState<CalcHist[]>(loadHist);
  const [copied, setCopied] = useState(false);
  const [showHist, setShowHist] = useState(false);

  const shownValue = tryEval(expr);
  const typingPlain = /^−?[\d.]+$/.test(expr); // just a number being typed: show it as typed

  const press = (k: string) => {
    setMsg('');
    let e = expr;
    const fresh = done;
    const startNew = () => { e = ''; };
    const set = (n: string, wasDone = false) => { setExpr(n); setDone(wasDone); };

    if (/^[0-9]$/.test(k)) {
      if (fresh) startNew();
      if (/[)%]$/.test(e)) e += '×';
      e = /(^|[^\d.])0$/.test(e) ? e.slice(0, -1) + k : e + k;
      return set(e);
    }
    if (k === '.') {
      if (fresh) startNew();
      if (/[)%]$/.test(e)) e += '×';
      if ((e.match(/[\d.]+$/)?.[0] ?? '').includes('.')) return; // one dot per number
      return set(/[\d]$/.test(e) ? e + '.' : e + '0.');
    }
    if (isOp(k)) {
      if (!e) return k === '−' ? set('−') : undefined;
      const last = e[e.length - 1];
      if (last === '(') return k === '−' ? set(e + '−') : undefined;
      if (isOp(last)) {
        if (k === '−' && '×÷^'.includes(last)) return set(e + '−'); // 5 × −3
        return set(e.slice(0, -1) + k);
      }
      return set(e + k);
    }
    switch (k) {
      case 'C': return set('');
      case '⌫': return set(e.slice(0, -1));
      case '(': {
        if (fresh) startNew();
        return set((endsValue(e) ? e + '×' : e) + '(');
      }
      case ')': {
        const open = (e.match(/\(/g) ?? []).length - (e.match(/\)/g) ?? []).length;
        return open > 0 && endsValue(e) ? set(e + ')') : undefined;
      }
      case '%': return endsValue(e) && !/\(/.test(e.slice(-1)) ? set(e + '%') : undefined;
      case 'x²': return e && endsValue(e) ? set(fresh ? `(${e})^2` : e + '^2') : undefined;
      case '√': {
        if (fresh && e) return set(`√(${e})`);
        return set((endsValue(e) ? e + '×' : e) + '√(');
      }
      case '1/x': return e && endsValue(e) ? set(`1÷(${e})`) : undefined;
      case '±': {
        if (!e || isOp(e.slice(-1)) || e.endsWith('(')) return set(e + (e ? '(−' : '−'));
        if (fresh || /^−?[\d.]+$/.test(e)) return set(e.startsWith('−') ? e.slice(1) : '−' + e);
        const neg = e.match(/\(−([\d.]+)$/);
        if (neg) return set(e.slice(0, neg.index) + neg[1]);
        const num = e.match(/[\d.]+$/);
        if (num) return set(e.slice(0, num.index) + '(−' + num[0]);
        return undefined;
      }
      case '=': {
        if (!e || done) return undefined;
        try {
          const v = evaluate(e);
          const closed = e.replace(/[+−×÷^√(]+$/, '') + ')'.repeat(Math.max(0, (e.match(/\(/g) ?? []).length - (e.match(/\)/g) ?? []).length));
          if (!typingPlain) {
            const h = [{ expr: closed, result: plain(v), at: Date.now() }, ...hist].slice(0, 50);
            setHist(h); saveHist(h);
          }
          return set(plain(v), true);
        } catch (x) { setMsg((x as Error).message === 'empty' ? '' : (x as Error).message); return undefined; }
      }
      case 'MC': return setMem(null);
      case 'MR': {
        if (mem === null) return undefined;
        if (fresh) startNew();
        const t = mem < 0 ? `(${plain(mem)})` : plain(mem);
        return set((endsValue(e) ? e + '×' : e) + t);
      }
      case 'M+': case 'M−': {
        const v = tryEval(e);
        if (v === null) return undefined;
        return setMem((m) => (m ?? 0) + (k === 'M+' ? v : -v));
      }
    }
  };

  // keyboard: works while the page is open and no box is being typed in
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const map: Record<string, string> = { '+': '+', '-': '−', '*': '×', x: '×', X: '×', '/': '÷', '(': '(', ')': ')', '%': '%', '^': '^', '.': '.', ',': '.', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'C', Delete: 'C', c: 'C', C: 'C' };
    const h = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (ev.ctrlKey || ev.metaKey || ev.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = /^[0-9]$/.test(ev.key) ? ev.key : map[ev.key];
      if (!k) return;
      ev.preventDefault();
      pressRef.current(k);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const copy = async () => {
    const v = shownValue;
    if (v === null) return;
    try { await navigator.clipboard.writeText(plain(v).replace('−', '-')); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
  };
  const clearHist = () => { setHist([]); saveHist([]); };
  const useHist = (h: CalcHist) => { setMsg(''); setExpr(h.result); setDone(true); setShowHist(false); };

  const big = msg ? msg : typingPlain ? expr : shownValue !== null ? nice(shownValue) : expr ? '…' : '0';
  const keys: [string, string][][] = [
    [['C', 'fn'], ['⌫', 'fn'], ['(', 'fn'], [')', 'fn']],
    [['x²', 'fn'], ['√', 'fn'], ['1/x', 'fn'], ['%', 'fn']],
    [['7', ''], ['8', ''], ['9', ''], ['÷', 'op']],
    [['4', ''], ['5', ''], ['6', ''], ['×', 'op']],
    [['1', ''], ['2', ''], ['3', ''], ['−', 'op']],
    [['±', 'fn'], ['0', ''], ['.', ''], ['+', 'op']],
  ];

  return (
    <div className="calc-wrap">
      <div className="calc-panel">
        <div className="calc-screen">
          <div className="calc-top">
            <span className="calc-left">
              <button type="button" className={`calc-copy calc-histbtn ${showHist ? 'on' : ''}`} onClick={() => setShowHist((x) => !x)} title="History" aria-label="History" aria-expanded={showHist}>
                <HistoryIcon size={15} />{hist.length > 0 && <span className="calc-count">{hist.length}</span>}
              </button>
              <span className="calc-m">{mem !== null ? `M = ${nice(mem)}` : ''}</span>
            </span>
            <button type="button" className="calc-copy" onClick={() => void copy()} title="Copy the result" aria-label="Copy the result">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          </div>
          <div className="calc-expr" title={expr}>{done ? `${hist[0]?.expr ?? ''} =` : typingPlain ? '' : expr || ' '}</div>
          <div className={`calc-main ${msg ? 'err' : ''}`} aria-live="polite">{big}</div>
        </div>
        <div className="calc-mem">
          {['MC', 'MR', 'M+', 'M−'].map((k) => (
            <button key={k} type="button" className="ck mini" disabled={(k === 'MC' || k === 'MR') && mem === null} onClick={() => press(k)}>{k}</button>
          ))}
        </div>
        <div className="calc-keys">
          {keys.flat().map(([k, cls]) => (
            <button key={k} type="button" className={`ck ${cls}`} onClick={() => press(k)}>{k}</button>
          ))}
          <button type="button" className="ck eq" style={{ gridColumn: '1 / -1' }} onClick={() => press('=')}>=</button>
        </div>
        <div className="calc-tip">Keyboard works too: numbers, + − * /, ( ), %, Enter for =, Backspace, Esc to clear.</div>
        {showHist && (
          <div className="calc-hist pop" role="dialog" aria-label="History">
              <div className="calc-hist-head">
                <h4><HistoryIcon size={16} /> History</h4>
                <span style={{ display: 'inline-flex', gap: 6 }}>
                  {hist.length > 0 && <button type="button" className="btn btn-sm btn-subtle" onClick={clearHist}><Trash2 size={13} /> Clear</button>}
                  <button type="button" className="btn btn-sm btn-subtle" onClick={() => setShowHist(false)} aria-label="Close history"><X size={13} /></button>
                </span>
              </div>
              {hist.length === 0 ? (
                <div className="muted calc-hist-empty">Your calculations appear here. Click one to use its answer again.</div>
              ) : (
                <ul>
                  {hist.map((h) => (
                    <li key={h.at}>
                      <button type="button" onClick={() => useHist(h)} title="Use this answer">
                        <span className="he">{h.expr}</span>
                        <span className="hr">= {nice(parseFloat(h.result.replace('−', '-')))}</span>
                        <span className="ht">{new Date(h.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
        )}
      </div>

    </div>
  );
}

/* ---------------- Petty Cash ---------------- */
function PettyCashTool({ rows, loaded, err, setErr, reload, total }: ReturnType<typeof useRows<PettyCashRow>> & { total: number }) {
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const f = useDateFilter(rows);
  const shownTotal = f.shown.reduce((t, r) => t + r.amount, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!(amt > 0) || !desc.trim()) { setErr('Enter an amount above 0 and a description.'); return; }
    setBusy(true);
    try { await addPettyCash(date, amt, desc); setAmount(''); setDesc(''); await reload(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const remove = async (id: number) => { try { await deletePettyCash(id); await reload(); } catch (x) { setErr((x as Error).message); } };

  return (
    <>
      <form onSubmit={submit} className="tool-form">
        <div className="field"><label>Date <span className="req">*</span></label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="field"><label>Amount (₹) <span className="req">*</span></label><input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div className="field"><label>Description <span className="req">*</span></label><input placeholder="What was the money spent on?" value={desc} onChange={(e) => setDesc(e.target.value)} required /></div>
        <button className="btn btn-primary tool-add" disabled={busy}><Plus size={15} /> Add Entry</button>
      </form>
      {err && <div className="tool-err">{err}</div>}
      {f.bar}
      <EntryTable rows={f.shown} loaded={loaded} emptyText={f.on ? 'No entries on the selected dates.' : undefined} err={err} valueLabel="Amount" valueStep="0.01" textLabel="Description"
        show={(id) => inr(rows.find((r) => r.id === id)!.amount)} getText={(id) => rows.find((r) => r.id === id)!.description} getValue={(id) => rows.find((r) => r.id === id)!.amount}
        onSave={async (id, d, n, t) => { await updatePettyCash(id, d, n, t); await reload(); }} onDelete={remove}
        footer={<tfoot><tr><td colSpan={4} className="strong" style={{ fontSize: 15 }}>{f.on ? 'Total for selected dates' : 'Total Amount'}</td><td className="r num strong" style={{ fontSize: 15 }}>{inr(f.on ? shownTotal : total)}</td><td /></tr></tfoot>} />
    </>
  );
}

/* ---------------- Quick Material Log ---------------- */
function MaterialLogTool({ rows, loaded, err, setErr, reload }: ReturnType<typeof useRows<MaterialLogRow>>) {
  const [date, setDate] = useState(todayISO());
  const [kg, setKg] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const f = useDateFilter(rows);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const w = parseFloat(kg);
    if (!(w > 0) || !name.trim()) { setErr('Enter a weight above 0 and a material name.'); return; }
    setBusy(true);
    try { await addMaterialLog(date, w, name); setKg(''); setName(''); await reload(); } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  };
  const remove = async (id: number) => { try { await deleteMaterialLog(id); await reload(); } catch (x) { setErr((x as Error).message); } };

  return (
    <>
      <form onSubmit={submit} className="tool-form">
        <div className="field"><label>Date <span className="req">*</span></label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
        <div className="field"><label>Weight (KG) <span className="req">*</span></label><input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={kg} onChange={(e) => setKg(e.target.value)} required /></div>
        <div className="field"><label>Material name <span className="req">*</span></label><input placeholder="e.g. EN8 round bar" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <button className="btn btn-primary tool-add" disabled={busy}><Plus size={15} /> Add to Log</button>
      </form>
      {err && <div className="tool-err">{err}</div>}
      {f.bar}
      <EntryTable rows={f.shown} loaded={loaded} emptyText={f.on ? 'No entries on the selected dates.' : undefined} err={err} valueLabel="Weight (KG)" valueStep="0.01" textLabel="Material"
        show={(id) => fmtKg(rows.find((r) => r.id === id)!.weightKg)} getText={(id) => rows.find((r) => r.id === id)!.material} getValue={(id) => rows.find((r) => r.id === id)!.weightKg}
        onSave={async (id, d, n, t) => { await updateMaterialLog(id, d, n, t); await reload(); }} onDelete={remove}
        footer={<tfoot><tr><td colSpan={4} className="strong" style={{ fontSize: 15 }}>{f.on ? 'Total for selected dates' : 'Total Weight'}</td><td className="r num strong" style={{ fontSize: 15 }}>{fmtKg(f.shown.reduce((t, r) => t + r.weightKg, 0))}</td><td /></tr></tfoot>} />
    </>
  );
}
