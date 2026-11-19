// ---------------------------------------------------------------------------
// Building blocks shared by the accounting pages.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Banknote, Check, ChevronDown, ChevronRight, Search as SearchIcon, Wand2, X } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Empty, go, type Icon } from '../components/ui';
import { describeBalance, denominationTotal, inr, NOTES, type DenomInput } from './engine';
import { currentFy, fyOf, listFinancialYears, useFy, type FyRange } from './fy';
import { useBooks } from './service';
import type { Account } from './types';
import './accounting.css';

/** the shared books for the signed-in user */
export function useAccBooks() {
  const { user } = useAccess();
  return useBooks(user?.email ?? '');
}

// ------------------------------------------------------------ navigation ---
type Params = Record<string, string | number | null | undefined | false>;
const qs = (p: Params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};
/** an Account Vouchers view: av('cash-receipt', { id: 4, mode: 'view' }) → "account-vouchers?view=cash-receipt&id=4&mode=view" */
export const av = (view?: string, p: Params = {}) => `account-vouchers${qs({ view, ...p })}`;
/** an Accounting Report view */
export const ar = (view?: string, p: Params = {}) => `accounting-report${qs({ view, ...p })}`;
/** the page we are on (to come back to after a form) */
export const here = () => window.location.hash.replace(/^#\/?/, '');
/** back to `back` if a form was opened from somewhere, else to `fallback` */
export const goBack = (back: string | null, fallback: string) => go(back || fallback);

// ----------------------------------------------------------- FY selector ---
/** The Financial Year drop-down (shared by every accounting page, remembered on this device). */
export function FySelector({ earliest }: { earliest?: string | null }) {
  const [fy, setFy] = useFy();
  const years = useMemo(() => {
    const list = listFinancialYears(earliest ?? null);
    return list.some((y) => y.startYear === fy.startYear) ? list : [...list, fy].sort((a, b) => b.startYear - a.startYear);
  }, [earliest, fy]);
  return (
    <label className="acct-fy" title="Financial year">
      <span className="text-xs muted strong">FY</span>
      <select value={fy.startYear} onChange={(e) => setFy(years.find((y) => y.startYear === Number(e.target.value)) ?? currentFy())} aria-label="Financial year">
        {years.map((y) => (
          <option key={y.startYear} value={y.startYear}>
            {y.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** a small warning under a date that lies outside the selected FY */
export function FyDateHint({ date }: { date: string }) {
  const [fy] = useFy();
  if (!date || (date >= fy.start && date <= fy.end)) return null;
  return <div className="acct-fyhint">This date is in FY {fyOf(date).label}, not the selected FY.</div>;
}

// --------------------------------------------------------- account picker ---
const initials = (s: string) =>
  (s || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const MAX_SHOWN = 60;

/** Searchable account picker (name, group, mobile, city …) — usable with thousands of accounts. */
export function AccountPicker({
  accounts,
  value,
  onChange,
  placeholder = 'Select account…',
  exclude,
  emptyText = 'No accounts found — add one under Account Vouchers → Account',
  bad,
  disabled,
}: {
  accounts: Account[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  exclude?: number | null;
  emptyText?: string;
  bad?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hl, setHl] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useEffect(() => {
    if (!open) setQ('');
    setHl(0);
  }, [open]);
  const selected = accounts.find((a) => a.id === value);
  const { shown, total } = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = accounts.filter((a) => a.id !== exclude);
    const m = t ? list.filter((a) => `${a.name} ${a.group} ${a.mobileNo} ${a.area} ${a.city} ${a.state} ${a.pincode}`.toLowerCase().includes(t)) : list;
    return { shown: m.slice(0, MAX_SHOWN), total: m.length };
  }, [accounts, q, exclude]);
  const pick = (id: number) => {
    onChange(id);
    setOpen(false);
  };
  return (
    <div className="acct-pick" ref={ref}>
      <button type="button" className={`input acct-pick-trigger ${bad ? 'bad' : ''}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`nm ${selected ? '' : 'muted'}`}>{selected ? selected.name : placeholder}</span>
        {selected && !disabled && (
          <span
            className="clr"
            role="button"
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
          >
            <X size={13} />
          </span>
        )}
        <ChevronDown size={15} className="muted" />
      </button>
      {open && (
        <div className="acct-pick-pop">
          <div className="acct-pick-search">
            <SearchIcon size={14} />
            <input
              autoFocus
              value={q}
              placeholder="Search account…"
              onChange={(e) => {
                setQ(e.target.value);
                setHl(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHl((h) => Math.min(h + 1, shown.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHl((h) => Math.max(h - 1, 0));
                } else if (e.key === 'Enter' && shown[hl]) {
                  e.preventDefault();
                  pick(shown[hl].id);
                } else if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <div className="acct-pick-list" role="listbox">
            {shown.length === 0 ? (
              <div className="acct-pick-empty">{emptyText}</div>
            ) : (
              shown.map((a, i) => (
                <button key={a.id} type="button" role="option" aria-selected={a.id === value} className={`acct-pick-row ${a.id === value ? 'on' : ''} ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => pick(a.id)}>
                  <span className="acct-pick-av">{initials(a.name)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div className="tt">{a.name}</div>
                    <div className="ss">
                      {a.group}
                      {a.mobileNo ? ` · ${a.mobileNo}` : ''}
                      {[a.area, a.city, a.state].filter(Boolean).length ? ` · ${[a.area, a.city, a.state].filter(Boolean).join(', ')}` : ''}
                    </div>
                  </span>
                  {a.id === value && <Check size={14} color="var(--primary)" />}
                </button>
              ))
            )}
          </div>
          {total > MAX_SHOWN && <div className="acct-pick-more">Showing {MAX_SHOWN} of {total} — keep typing to narrow down</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- amounts ---
/** ₹ 1,234.00 Dr / Cr */
export function DrCr({ amount }: { amount: number }) {
  const { abs, type } = describeBalance(amount);
  return (
    <span className="nowrap num">
      {inr(abs)} <span className={`acct-drcr ${type === 'Dr' ? 'acct-dr' : 'acct-cr'}`}>{type}</span>
    </span>
  );
}

/** "Current balance → after this voucher" for one side of a voucher */
export function BalanceCard({ label, icon: I, account, current, delta, verb }: { label: string; icon: Icon; account: Account | undefined; current: number | null; delta: number; verb: string }) {
  return (
    <div className="acct-panel acct-bal">
      <div className="acct-panel-h">
        <I size={14} /> {label}
      </div>
      {!account ? (
        <div className="text-xs muted">Select an account to see its balance.</div>
      ) : (
        <>
          <div className="nm">{account.name}</div>
          <div className="ln">
            Current: <b>{current == null ? '…' : <DrCr amount={current} />}</b>
            {delta !== 0 && <span className={`acct-drcr ${delta > 0 ? 'acct-dr' : 'acct-cr'}`}>{delta > 0 ? 'DR' : 'CR'} {inr(Math.abs(delta))}</span>}
          </div>
          <div className="ln">
            After this {verb}: <b>{current == null ? '…' : <DrCr amount={current + delta} />}</b>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------- denominations ---
/** The note-count grid (₹500 … ₹1) with its total and whether it matches the amount. */
export function DenominationInput({
  value,
  onChange,
  amount,
  disabled,
  onFillAmount,
  title = 'Cash Denomination',
  hint = '(optional)',
}: {
  value: DenomInput;
  onChange: (v: DenomInput) => void;
  amount: number;
  disabled?: boolean;
  onFillAmount?: (total: number) => void;
  title?: string;
  hint?: string;
}) {
  const total = denominationTotal(value);
  const has = Object.values(value).some((v) => (parseInt(v, 10) || 0) > 0);
  const matches = has && total === amount;
  const mismatch = has && amount > 0 && total !== amount;
  return (
    <div className="acct-panel">
      <div className="acct-panel-h">
        <Banknote size={14} /> {title} <span className="hint">{hint}</span>
        {!disabled && mismatch && onFillAmount && (
          <button type="button" className="btn-link right" onClick={() => onFillAmount(total)}>
            <Wand2 size={13} /> Set amount to {inr(total, 0)}
          </button>
        )}
      </div>
      <div className="acct-denoms">
        {NOTES.map((note) => (
          <div key={note} className="acct-denom">
            <div className="n">₹{note}</div>
            <input type="number" min={0} step={1} inputMode="numeric" disabled={disabled} placeholder="0" value={value[note] ?? ''} onChange={(e) => onChange({ ...value, [note]: e.target.value.replace(/[^0-9]/g, '') })} aria-label={`Number of ₹${note} notes`} />
            <div className="v">= {inr(note * (parseInt(value[note] ?? '', 10) || 0), 0)}</div>
          </div>
        ))}
      </div>
      <div className="acct-denom-foot">
        <span>
          Denomination Total: <b>{inr(total, 0)}</b>
        </span>
        {has && (matches ? <span className="acct-ok">Matches amount ✓</span> : mismatch ? <span className="acct-warn">{total > amount ? `${inr(total - amount, 0)} over` : `${inr(amount - total, 0)} short`}</span> : null)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- hub cards ---
export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'teal' | 'violet';
export interface HubCardDef {
  title: string;
  description: string;
  icon: Icon;
  tone: Tone;
  to: string;
  linkText?: string;
}
export function HubCard({ c }: { c: HubCardDef }) {
  return (
    <button type="button" className={`acct-card acct-tone-${c.tone}`} onClick={() => go(c.to)} title={c.description}>
      <span className="acct-card-top">
        <span className="acct-card-ic">
          <c.icon size={22} />
        </span>
        <span className="acct-card-t">{c.title}</span>
      </span>
      <span className="acct-card-go">
        {c.linkText ?? `Create ${c.title}`} <ChevronRight size={14} />
      </span>
    </button>
  );
}

// ------------------------------------------------------------ page states ---
export function BooksGate({ loading, error, reload, children }: { loading: boolean; error: string | null; reload: () => void; children: ReactNode }) {
  if (error)
    return (
      <div className="card">
        <Empty title="Accounting is not available" text={error} action={<button className="btn" onClick={reload}>Try again</button>} />
      </div>
    );
  if (loading) return <div className="card"><div className="card-center-msg">Loading the books…</div></div>;
  return <>{children}</>;
}

// --------------------------------------------------------------- charts ---
// Drawn as plain SVG in the app's colours (no chart library).
const fmtShort = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(Math.round(v)));
const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
};

/** two series over the 12 months as filled lines */
export function AreaChart({ data, series }: { data: Record<string, number | string>[]; series: { key: string; label: string; color: string }[] }) {
  const W = 640;
  const H = 210;
  const L = 44;
  const B = 22;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const x = (i: number) => L + (i * (W - L - 8)) / Math.max(1, data.length - 1);
  const y = (v: number) => 8 + (H - B - 8) * (1 - v / max);
  return (
    <>
      <div className="acct-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <svg className="acct-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(' and ') + ' by month'}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W - 8} y1={y(max * t)} y2={y(max * t)} />
            <text x={L - 6} y={y(max * t) + 3} textAnchor="end">
              {fmtShort(max * t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle">
            {String(d.month)}
          </text>
        ))}
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[s.key]) || 0)}`).join(' ');
          return (
            <g key={s.key}>
              <polygon points={`${x(0)},${y(0)} ${pts} ${x(data.length - 1)},${y(0)}`} fill={s.color} opacity={0.12} />
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
              {data.map((d, i) => (
                <circle key={i} cx={x(i)} cy={y(Number(d[s.key]) || 0)} r={2.5} fill={s.color}>
                  <title>{`${d.month} · ${s.label}: ${inr(Number(d[s.key]) || 0, 0)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </>
  );
}

/** grouped bars per month */
export function BarChart({ data, series }: { data: Record<string, number | string>[]; series: { key: string; label: string; color: string }[] }) {
  const W = 640;
  const H = 210;
  const L = 34;
  const B = 22;
  const max = niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const slot = (W - L - 8) / Math.max(1, data.length);
  const bw = Math.min(14, (slot * 0.75) / series.length);
  const y = (v: number) => 8 + (H - B - 8) * (1 - v / max);
  return (
    <>
      <div className="acct-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
      <svg className="acct-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vouchers by month">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W - 8} y1={y(max * t)} y2={y(max * t)} />
            <text x={L - 6} y={y(max * t) + 3} textAnchor="end">
              {Math.round(max * t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2;
          const start = cx - (bw * series.length) / 2;
          return (
            <g key={i}>
              {series.map((s, k) => {
                const v = Number(d[s.key]) || 0;
                return (
                  <rect key={s.key} x={start + k * bw} y={y(v)} width={bw - 2} height={Math.max(0, y(0) - y(v))} rx={2} fill={s.color}>
                    <title>{`${d.month} · ${s.label}: ${v}`}</title>
                  </rect>
                );
              })}
              <text x={cx} y={H - 6} textAnchor="middle">
                {String(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

export const PALETTE = ['#2563eb', '#259392', '#7c3aed', '#ea580c', '#16a34a', '#dc2626'];

/** a ring with a legend */
export function Donut({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const R = 62;
  const C = 2 * Math.PI * R;
  let at = 0;
  return (
    <div className="acct-donut">
      <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-label="Income breakdown">
        <circle cx={80} cy={80} r={R} fill="none" stroke="var(--surface-3)" strokeWidth={22} />
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = (
            <circle key={d.name} cx={80} cy={80} r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth={22} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-at} transform="rotate(-90 80 80)">
              <title>{`${d.name}: ${inr(d.value, 0)}`}</title>
            </circle>
          );
          at += len;
          return el;
        })}
      </svg>
      <ul>
        {data.map((d, i) => (
          <li key={d.name}>
            <span>
              <i style={{ background: PALETTE[i % PALETTE.length] }} /> {d.name}
            </span>
            <b className="num">{inr(d.value, 0)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "FY 01/04/2026 - 31/03/2027" */
export const fyText = (fy: FyRange) => `FY ${fy.label}`;
