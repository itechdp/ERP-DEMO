import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { APP_RESOURCES } from '../auth/appResources';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Boxes,
  Eye,
  Crop,
  Flame,
  Hammer,
  Inbox,
  PackageCheck,
  Scissors,
  Search as SearchIcon,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  X,
  type LucideProps,
} from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { useUnits } from '../units/useUnits';
import { fmtNum } from './format';
import { useCountUp } from './motion';

export type Icon = ComponentType<LucideProps>;

/** Icons for each step of the Raw → Dispatch flow */
export const FLOW_STEPS: { key: string; label: string; short: string; icon: Icon; route: string }[] = [
  { key: 'raw', label: 'Raw Inventory', short: 'Raw Material', icon: Boxes, route: 'raw-inventory' },
  { key: 'cutting', label: 'Cutting', short: 'Cutting', icon: Scissors, route: 'cutting' },
  { key: 'forging', label: 'Forging', short: 'Forging', icon: Hammer, route: 'forging' },
  { key: 'trimming', label: 'Trimming', short: 'Trimming', icon: Crop, route: 'trimming' },
  { key: 'heatTreatment', label: 'Heat Treatment', short: 'Heat Treat.', icon: Flame, route: 'heat-treatment' },
  { key: 'qc', label: 'Quality Control', short: 'Quality Control', icon: ShieldCheck, route: 'qc' },
  { key: 'finishedGoods', label: 'Finished Goods', short: 'Finished Goods', icon: PackageCheck, route: 'finished-goods' },
  { key: 'dispatched', label: 'Dispatch', short: 'Dispatch', icon: Truck, route: 'dispatch' },
];

// ---------------------------------------------------------------- Badge ---
const TONE: Record<string, string> = {
  Pending: 'b-red',
  'On Hold': 'b-amber',
  'In Progress': 'b-purple b-progress',
  Completed: 'b-green',
  'QC Pending': 'b-amber',
  Approved: 'b-green',
  Rejected: 'b-red',
  'Partially Approved': 'b-orange',
  'Ready for Dispatch': 'b-violet',
  Dispatched: 'b-teal',
  Available: 'b-green',
  'Low Stock': 'b-amber',
  Consumed: 'b-neutral',
  Reserved: 'b-violet',
  'Partially Dispatched': 'b-blue',
  Pass: 'b-green',
  Fail: 'b-red',
  Incomplete: 'b-amber',
  OK: 'b-green',
  'Not OK': 'b-red',
  New: 'b-blue',
  Contacted: 'b-amber',
  Qualified: 'b-violet',
  Converted: 'b-green',
  Lost: 'b-red',
  Open: 'b-blue',
  Quoted: 'b-violet',
  Closed: 'b-neutral',
  Draft: 'b-neutral',
  Sent: 'b-blue',
  Accepted: 'b-green',
  Expired: 'b-amber',
  Received: 'b-blue',
  Confirmed: 'b-violet',
  'In Production': 'b-amber',
  Cancelled: 'b-red',
  Done: 'b-green',
  Delivered: 'b-green',
  // purchase
  'Approval Pending': 'b-pink',
  Released: 'b-violet',
  'Sent to Supplier': 'b-blue',
  'Partially Received': 'b-orange',
  'Fully Received': 'b-green',
  'Partially Ordered': 'b-orange',
  Shortlisted: 'b-violet',
  Selected: 'b-green',
  Overdue: 'b-red',
  'Due soon': 'b-amber',
  'On track': 'b-green',
  Partial: 'b-orange',
  // invoices, payments, e-mail log
  Posted: 'b-blue',
  Unpaid: 'b-red',
  'Partially Paid': 'b-amber',
  Paid: 'b-green',
  Queued: 'b-neutral',
  Failed: 'b-red',
  'Unknown — check and retry': 'b-amber',
  // sales quotations
  'Pending Approval': 'b-pink',
  'Revision Required': 'b-orange',
  Won: 'b-green',
};
export function Badge({ status }: { status: string }) {
  return <span className={`badge ${TONE[status] ?? 'b-neutral'}`}>{status}</span>;
}

/** Colour families a filter chip or status rail can take. */
export type Tone = 'neutral' | 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'teal';

/** Same meanings as Badge, expressed as a rail down the row's left edge. */
const ROW_TONE: Record<string, string> = {
  Pending: 'st-pending',
  'In Progress': 'st-info',
  Completed: 'st-good',
  'QC Pending': 'st-warn',
  Approved: 'st-good',
  Rejected: 'st-bad',
  'Partially Approved': 'st-orange',
  'Ready for Dispatch': 'st-violet',
  Dispatched: 'st-teal',
  Available: 'st-good',
  'Low Stock': 'st-warn',
  Consumed: 'st-neutral',
  Reserved: 'st-violet',
  'Partially Dispatched': 'st-info',
  Pass: 'st-good',
  Fail: 'st-bad',
  Incomplete: 'st-warn',
};
export const rowTone = (status: string) => ROW_TONE[status] ?? 'st-neutral';

export function Priority({ p }: { p: string }) {
  if (p === 'Normal') return <span className="chip">Normal</span>;
  return <span className={`chip ${p === 'Urgent' ? 'chip-hot' : 'chip-high'}`}>{p}</span>;
}

// -------------------------------------------------------------- JobLink ---
export function JobLink({ jobNo }: { jobNo: string }) {
  const { openTrace, state } = useStore();
  const jobWork = state.jobWork.some((w) => w.jobNo === jobNo);
  return (
    <>
    <button
      className="job-link"
      title="View complete job traceability"
      // the job number is its own action — don't let it also trigger the row it sits in
      onClick={(e) => {
        e.stopPropagation();
        openTrace(jobNo);
      }}
    >
      {jobNo}
    </button>
    {jobWork && <span className="chip chip-jw">Job work</span>}
    </>
  );
}

// --------------------------------------------------------------- Header ---
export const go = (route: string) => {
  window.location.hash = `/${route}`;
  window.scrollTo({ top: 0 });
};

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  flow,
}: {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** FLOW_STEPS key — shows previous / next stage buttons */
  flow?: string;
}) {
  return (
    <>
      <div className="page-head">
        <div className="ph-text">
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {(flow || actions) && (
          <div className="page-actions">
            {flow && <StepNav current={flow} />}
            {actions}
          </div>
        )}
      </div>
    </>
  );
}

/** Previous / next stage buttons, so users can walk the flow in order. */
function StepNav({ current }: { current: string }) {
  const i = FLOW_STEPS.findIndex((st) => st.key === current);
  const prev = FLOW_STEPS[i - 1];
  const next = FLOW_STEPS[i + 1];
  return (
    <div className="step-nav">
      {prev && (
        <button className="step-link" onClick={() => go(prev.route)} title={`Go to ${prev.label}`}>
          <ChevronLeft size={16} />
          <span>
            <small>Previous stage</small>
            {prev.label}
          </span>
        </button>
      )}
      {next && (
        <button className="step-link next" onClick={() => go(next.route)} title={`Go to ${next.label}`}>
          <span>
            <small>Next stage</small>
            {next.label}
          </span>
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}

/** One compact line of key numbers, shown in a card header instead of a row of stat cards. */
export function SummaryLine({ items }: { items: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'info' }[] }) {
  return (
    <div className="sumline">
      {items.map((it) => (
        <span key={it.label} className={`sum ${it.tone ?? ''}`}>
          <b>{it.value}</b> {it.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ KPI ---
export function Kpi({
  label,
  value,
  unit,
  hint,
  icon: I,
  tone = 'blue',
  trend,
  onClick,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  icon: Icon;
  tone?: 'blue' | 'amber' | 'green' | 'red' | 'violet' | 'teal';
  /** small chip in the top-right corner */
  trend?: ReactNode;
  onClick?: () => void;
}) {
  const isNum = typeof value === 'number';
  const shown = useCountUp(isNum ? value : 0);
  const body = (
    <>
      <span className="kpi-icon">
        <I size={22} />
      </span>
      {trend && <span className="kpi-trend">{trend}</span>}
      <div className="kpi-value">
        {isNum ? fmtNum(shown) : value}
        {unit && <small>{value === 1 && unit !== 'PCS' && unit.endsWith('s') ? unit.slice(0, -1) : unit}</small>}
      </div>
      <div className="kpi-label">{label}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
    </>
  );
  return onClick ? (
    <button className={`kpi tone-${tone}`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={`kpi tone-${tone}`}>{body}</div>
  );
}

// -------------------------------------------------------- Quantity flow ---
export function QtyFlow({
  input,
  loss,
  output,
  labels = ['Received Qty', 'Rejection Qty', 'OK Qty'],
  small,
}: {
  input: number | string;
  loss: number | string;
  output: number | string;
  labels?: [string, string, string];
  small?: boolean;
}) {
  return (
    <div className={`qflow ${small ? 'sm' : ''}`}>
      <div className="qbox in">
        <div className="l">{labels[0]}</div>
        <div className="v">
          {input}
          <small>PCS</small>
        </div>
      </div>
      <div className="qarrow">−</div>
      <div className="qbox loss">
        <div className="l">{labels[1]}</div>
        <div className="v">
          {loss}
          <small>PCS</small>
        </div>
      </div>
      <div className="qarrow">=</div>
      <div className="qbox out">
        <div className="l">{labels[2]}</div>
        <div className="v">
          {output}
          <small>PCS</small>
        </div>
      </div>
    </div>
  );
}

/** Compact "100 → −2 → 98" for table cells */
export function InlineQty({ input, loss, output }: { input: number; loss: number; output: number }) {
  return (
    <span className="inline-q">
      {fmtNum(input)}
      <ArrowRight size={12} />
      <span className="x">−{loss}</span>
      <ArrowRight size={12} />
      <span className="o">{fmtNum(output)}</span>
    </span>
  );
}

// -------------------------------------------------------------- Stepper ---
/** 8-segment progress bar along Raw → Dispatch */
export function Stepper({ index }: { index: number }) {
  return (
    <span className="stepper" title={index >= 0 ? `Stage ${index + 1} of 8: ${FLOW_STEPS[index]?.label}` : 'Rejected'}>
      {FLOW_STEPS.map((s, i) => (
        <i key={s.key} className={index === 7 && i === 7 ? 'end' : i < index ? 'done' : i === index ? 'cur' : ''} />
      ))}
    </span>
  );
}

// ---------------------------------------------------------- FilterMenu ---
export interface FilterGroup {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** the FIRST option is the "all / no filter" choice */
  options: { value: string; label: string; count?: number }[];
}

/** The one filter control used on every list: a "Filters" button that opens a dropdown with one select per filter. */
export function FilterMenu({ groups }: { groups: FilterGroup[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const shown = groups.filter((g) => g.options.length > 1);
  if (shown.length === 0) return null;
  const isOn = (g: FilterGroup) => g.value !== g.options[0].value;
  const active = shown.filter(isOn).length;
  return (
    <div className="fmenu" ref={ref}>
      <button className={`btn fmenu-btn ${active ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="true">
        <SlidersHorizontal size={15} /> Filters
        {active > 0 && <span className="fcnt">{active}</span>}
        <ChevronDown size={14} className="fchev" />
      </button>
      {open && (
        <div className="fmenu-pop" role="dialog" aria-label="Filters">
          <div className="fmenu-head">
            <b>Filters</b>
            {active > 0 && (
              <button className="btn-link" onClick={() => shown.forEach((g) => g.onChange(g.options[0].value))}>
                Clear all
              </button>
            )}
          </div>
          <div className="fmenu-body">
            {shown.map((g) => (
              <div className="field" key={g.label}>
                <label>{g.label}</label>
                <select value={g.value} onChange={(e) => g.onChange(e.target.value)}>
                  {g.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                      {o.count !== undefined ? ` (${o.count})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- Empty ---
export function Empty({ title, text, icon: I = Inbox, action }: { title: string; text?: string; icon?: Icon; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <I size={24} />
      </div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

// ------------------------------------------------------- Search / Tabs ---
export function Search({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="search">
      <SearchIcon size={15} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; count?: number; tone?: Tone }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          className={`tab tone-${it.tone ?? 'neutral'} ${value === it.value ? 'active' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {it.count !== undefined && <span className="cnt">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Modal ---
/**
 * Create / edit forms are written as <Modal> (title, body, footer). Inside a PageFormCtx they render as a full page instead of a
 * pop-up — same fields and buttons, but on their own address — so a form can grow without becoming cramped.
 */
export const PageFormCtx = createContext<{ eyebrow: string } | null>(null);

/**
 * Shows its children IN PLACE OF the page content (the page underneath is hidden, not removed, so it keeps its filters and scroll state).
 * This is how every add / edit / view opens as a whole page without having its own address. Back returns to the page underneath.
 */
export function OverlayHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => {
    const el = document.querySelector('main.content');
    setHost(el);
    if (!el) return;
    const n = Number((el as HTMLElement).dataset.overlays ?? '0') + 1;
    (el as HTMLElement).dataset.overlays = String(n);
    el.classList.add('has-overlay');
    window.scrollTo({ top: 0 });
    return () => {
      const left = Number((el as HTMLElement).dataset.overlays ?? '1') - 1;
      (el as HTMLElement).dataset.overlays = String(Math.max(left, 0));
      if (left <= 0) el.classList.remove('has-overlay');
    };
  }, []);
  return host ? createPortal(children, host) : null;
}

/** The small heading above the title: the section of the page the person came from. */
const overlayEyebrow = () => {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return APP_RESOURCES.find((r) => r.route === route)?.section ?? 'Details';
};

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  icon: MI,
  dialog,
  viewOnly,
  viewActions,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'lg';
  icon?: Icon;
  /** a small pop-up (a yes / no or a one-line reason). Everything else opens as a full page. */
  dialog?: boolean;
  /** the same form, but nothing can be changed: every field is disabled and the buttons are replaced by Close (plus viewActions, e.g. Print) */
  viewOnly?: boolean;
  viewActions?: ReactNode;
}) {
  const body = viewOnly ? (
    <>
      <div className="view-note">
        <Eye size={14} /> View only — this is the saved record. Nothing can be changed here.
      </div>
      <fieldset className="ro-form" disabled>
        {children}
      </fieldset>
    </>
  ) : (
    children
  );
  const foot = viewOnly ? (
    <>
      <button className="btn" onClick={onClose}>
        Close
      </button>
      {viewActions}
    </>
  ) : (
    footer
  );
  const ctx = useContext(PageFormCtx);
  const pageForm = dialog ? null : ctx;
  // not inside a route page and not a dialog: open as a whole page over the content area (falls back to a pop-up if there is no content area)
  const overlay = !dialog && !pageForm && typeof document !== 'undefined' && !!document.querySelector('main.content');
  useEffect(() => {
    if (!open || pageForm || overlay) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose, pageForm, overlay]);
  if (!open) return null;
  if (overlay)
    return (
      <OverlayHost>
        <div className="page-overlay page-in">
          <PageHeader
            eyebrow={overlayEyebrow()}
            title={title}
            subtitle={subtitle}
            actions={
              <button className="btn" onClick={onClose}>
                <ArrowLeft size={15} /> Back
              </button>
            }
          />
          <div className="card">
            <div className="card-body form-page">
              {body}
              {foot && <div className="form-actions">{foot}</div>}
            </div>
          </div>
        </div>
      </OverlayHost>
    );
  if (pageForm)
    return (
      <>
        <PageHeader
          eyebrow={pageForm.eyebrow}
          title={title}
          actions={
            <button className="btn" onClick={onClose}>
              <ArrowLeft size={15} /> Back
            </button>
          }
        />
        <div className="card">
          <div className="card-body form-page">
            {body}
            {foot && <div className="form-actions">{foot}</div>}
          </div>
        </div>
      </>
    );
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size ?? ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          {MI && (
            <span className="mh-icon">
              <MI size={20} />
            </span>
          )}
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{body}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Confirm({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'primary',
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'success';
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <PageFormCtx.Provider value={null}>
    <Modal
      dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${tone === 'success' ? 'btn-success' : tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.55, color: 'var(--text-2)' }}>{message}</div>
    </Modal>
    </PageFormCtx.Provider>
  );
}

// ---------------------------------------------------------------- Field ---
export function Field({
  label,
  required,
  hint,
  error,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      {children}
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

const trimNum = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * A number box with its measuring unit on the right. `suffix` is the unit the VALUE is kept in (PCS, KG, g, mm, min …).
 * When Settings → Units has switched on more units of that kind (BOX, TON, m, inch …) the unit turns into a picker: the person
 * types in the unit they like, and `value` / `onChange` still speak the box's own unit — so no page needs to know about it.
 */
export function NumInput({
  value,
  onChange,
  suffix = 'PCS',
  readOnly,
  bad,
  min = 0,
  step = 1,
  autoFocus,
}: {
  value: string | number;
  onChange?: (v: string) => void;
  suffix?: string;
  readOnly?: boolean;
  bad?: boolean;
  min?: number;
  step?: number | 'any';
  autoFocus?: boolean;
}) {
  const { find, optionsFor } = useUnits();
  const own = find(suffix);
  const opts = optionsFor(suffix);
  const picker = !readOnly && !!own && opts.length > 1;
  const [unit, setUnit] = useState(own?.code ?? suffix);
  const ratio = (code: string) => (find(code)?.factor ?? 1) / (own?.factor ?? 1); // own units in one of `code`
  const r = picker && unit !== own?.code ? ratio(unit) : 1;
  const converting = r !== 1;
  const [text, setText] = useState('');

  // while converting, keep the typed text in step with a value changed from outside (auto-calculated weights, resets …)
  useEffect(() => {
    if (!converting) return;
    const v = String(value);
    if (v === '') {
      if (text !== '') setText('');
    } else if (Math.abs(Number(v) - Number(text) * r) > 1e-6 * Math.max(1, Math.abs(Number(v)))) setText(trimNum(Number(v) / r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, r, converting]);

  // changing the unit keeps the number on screen and re-reads it in the new unit (3 → 3 BOX)
  const changeUnit = (code: string) => {
    const next = code === own?.code ? 1 : ratio(code);
    const shown = converting ? text : String(value);
    setUnit(code);
    setText(shown);
    onChange?.(shown === '' ? '' : trimNum(Number(shown) * next));
  };

  return (
    <>
      <div className="input-suffix">
        <input
          className={`input num ${bad ? 'bad' : ''} ${picker ? 'has-unit' : ''}`}
          type="number"
          inputMode="decimal"
          min={min}
          step={converting ? 'any' : step}
          value={converting ? text : value}
          readOnly={readOnly}
          autoFocus={autoFocus}
          onChange={(e) => {
            const t = e.target.value;
            if (!converting) return onChange?.(t);
            setText(t);
            onChange?.(t === '' ? '' : trimNum(Number(t) * r));
          }}
        />
        {picker ? (
          <select className="unit-pick" value={unit} onChange={(e) => changeUnit(e.target.value)} aria-label="Unit">
            {opts.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code}
              </option>
            ))}
          </select>
        ) : (
          <span>{suffix}</span>
        )}
      </div>
      {converting && Number(value) > 0 && <div className="hint">= {trimNum(Number(value))} {own?.code}</div>}
    </>
  );
}
