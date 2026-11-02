import { canSee, colOk } from '../auth/access';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, Hammer, ImagePlus, MoreVertical, Printer, Scissors, Wrench, Pencil, Upload, Undo2, Image as ImageIcon, X, History as HistoryIcon } from 'lucide-react';
import { Field, Modal, NumInput } from '../components/ui';
import { fmtDate, todayISO } from '../components/format';
import { useDies, type DieInput } from './DieContext';
import { printDieCard, fmtDims, fmtWt } from './print';
import { DIE_STATUSES, KIND_LABEL, METALS, type Die, type DieKind, type DieStatus, type Dims, type HistoryEvent, type Metal } from './types';

// ------------------------------------------------------------- small bits ---
const DIE_TONE: Record<string, string> = {
  Available: 'b-green',
  'In Production': 'b-amber',
  'Under Maintenance': 'b-amber',
  Damaged: 'b-red',
  Retired: 'b-neutral',
  Active: 'b-green',
  Inactive: 'b-neutral',
};
export const DIE_ROW: Record<string, string> = {
  Available: 'st-good',
  'In Production': 'st-info',
  'Under Maintenance': 'st-warn',
  Damaged: 'st-bad',
  Retired: 'st-neutral',
  Active: 'st-good',
  Inactive: 'st-neutral',
};
export const DieBadge = ({ status }: { status: string }) => <span className={`badge ${DIE_TONE[status] ?? 'b-neutral'}`}>{status}</span>;

export const KindChip = ({ kind }: { kind: DieKind }) => (
  <span className={`chip kind-${kind}`}>
    {kind === 'forging' ? <Hammer size={12} /> : <Scissors size={12} />}
    {KIND_LABEL[kind]}
  </span>
);
export const DemoChip = ({ demo }: { demo?: boolean }) => (demo ? <span className="chip chip-demo" title="Illustrative demo record">Demo</span> : null);

export function Thumb({ id, label, big }: { id?: string; label?: string; big?: boolean }) {
  const { data } = useDies();
  const src = id ? data.images[id] : undefined;
  return (
    <div className={`thumb ${big ? 'big' : ''}`} title={label}>
      {src ? <img src={src} alt={label ?? 'die'} /> : <ImageIcon size={big ? 26 : 16} />}
      {label && big && <span className="cap">{label}</span>}
    </div>
  );
}

const IconBtn = ({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) => (
  <button
    className="icon-btn sm"
    title={title}
    aria-label={title}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {children}
  </button>
);
export { IconBtn };

export type MenuTone = 'blue' | 'teal' | 'violet' | 'amber' | 'orange' | 'green' | 'neutral';
export interface MenuAction {
  label: string;
  icon: ReactNode;
  tone: MenuTone;
  onClick: () => void;
}

/** One ⋮ button per row; its dropdown lists every action with a short, colour-coded label. */
export function RowMenu({ actions }: { actions: (MenuAction | false)[] }) {
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const items = actions.filter(Boolean) as MenuAction[];

  // rendered in a portal with fixed position so the table's horizontal scroll never clips it
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = pop.current.offsetHeight;
    const w = pop.current.offsetWidth;
    const top = r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ top, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        className={`icon-btn sm menu-btn-dots ${open ? 'on' : ''}`}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreVertical size={17} />
      </button>
      {open &&
        createPortal(
          <div ref={pop} className="row-menu" role="menu" style={{ top: pos.top, left: pos.left }} onClick={(e) => e.stopPropagation()}>
            {items.map((a) => (
              <button
                key={a.label}
                role="menuitem"
                className={`rm-item tone-${a.tone}`}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
              >
                <span className="rm-ic">{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Down-scales to a small JPEG before it is uploaded to Storage. */
function toDataUrl(file: File, max = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file (JPG, PNG, WebP).'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('Image is larger than 10 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s));
      c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}

function ImagePicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Field label={label} error={err}>
      <div className="img-pick">
        <div className="img-prev">{value ? <img src={value} alt={label} /> : <ImagePlus size={24} />}</div>
        <div className="img-btns">
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => ref.current?.click()}>
            <Upload size={14} /> {busy ? 'Processing…' : value ? 'Change' : 'Choose image'}
          </button>
          {value && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('')}>
              <X size={14} /> Remove
            </button>
          )}
        </div>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setErr('');
            try {
              onChange(await toDataUrl(f));
            } catch (x) {
              setErr((x as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </Field>
  );
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
const str = (n?: number) => (n === undefined ? '' : String(n));

function DimsInput({ label, value, onChange, round = false }: { label: string; value: Record<'l' | 'w' | 'h', string>; onChange: (v: Record<'l' | 'w' | 'h', string>) => void; round?: boolean }) {
  return (
    <div className="field full">
      <label>{label}</label>
      <div className="dims">
        {(round ? (['l'] as const) : (['l', 'w', 'h'] as const)).map((k) => (
          <NumInput key={k} suffix={k === 'l' ? (round ? 'Length mm' : 'L mm') : k === 'w' ? 'W mm' : 'H mm'} step="any" value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} />
        ))}
      </div>
    </div>
  );
}
const dimsStr = (d: Dims) => ({ l: str(d.l), w: str(d.w), h: str(d.h) });
const dimsNum = (d: Record<'l' | 'w' | 'h', string>): Dims => ({ l: num(d.l), w: num(d.w), h: num(d.h) });

const Foot = ({ onClose, onSave, label, disabled }: { onClose: () => void; onSave: () => void | Promise<unknown>; label: string; disabled?: boolean }) => {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button className="btn" onClick={onClose} disabled={busy}>
        Cancel
      </button>
      <button
        className="btn btn-primary"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSave();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Saving…' : label}
      </button>
    </>
  );
};

// -------------------------------------------------------------- Main die ---
export function MainDieForm({ code, onClose }: { code?: string; onClose: () => void }) {
  const { data, saveMain, nextMainCode, nextPartCode } = useDies();
  const cur = code ? data.mainDies.find((m) => m.code === code) : undefined;
  const [f, setF] = useState({
    name: cur?.name ?? '',
    partCode: cur?.partCode ?? nextPartCode(),
    description: cur?.description ?? '',
    customer: canSee('party_names') ? cur?.customer ?? '' : '', // a masked name is never loaded into the form
    metal: (cur?.metal ?? 'Brass') as Metal,
    createdOn: cur?.createdOn ?? todayISO(),
    status: (cur?.status ?? 'Active') as 'Active' | 'Inactive',
    remarks: cur?.remarks ?? '',
  });
  const [tried, setTried] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const miss = (v: string) => (tried && !v.trim() ? 'Required' : null);
  const submit = async () => {
    setTried(true);
    if (!f.name.trim() || !f.partCode.trim() || !f.createdOn) return;
    if (await saveMain(f, code)) onClose();
  };
  return (
    <Modal open title={cur ? `Edit ${cur.code}` : 'Add New Die'} subtitle="Main die = the component. Forging and trimming dies are added under it." icon={Hammer} onClose={onClose} footer={<Foot onClose={onClose} onSave={submit} label={cur ? 'Save changes' : 'Add Die'} />}>
      <div className="form-grid">
        <Field label="Main Die Code" hint="Generated automatically">
          <input className="input mono" readOnly value={cur?.code ?? nextMainCode()} />
        </Field>
        <Field label="Creation Date" required>
          <input className="input" type="date" value={f.createdOn} onChange={(e) => set('createdOn', e.target.value)} />
        </Field>
        <Field label="Die Name / Component Name" required error={miss(f.name)}>
          <input className={`input ${miss(f.name) ? 'bad' : ''}`} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Brass Valve Body" autoFocus />
        </Field>
        <Field label="Part Code" required error={miss(f.partCode)}>
          <input className={`input ${miss(f.partCode) ? 'bad' : ''}`} value={f.partCode} onChange={(e) => set('partCode', e.target.value)} placeholder="e.g. EAF-PRT-0001" />
        </Field>
        {canSee('party_names') && (
          <Field label="Customer Name">
            <input className="input" value={f.customer} onChange={(e) => set('customer', e.target.value)} />
          </Field>
        )}
        <Field label="Metal Type">
          <select value={f.metal} onChange={(e) => set('metal', e.target.value as Metal)}>
            {METALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Part Description" full>
          <input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Field label="Status">
          <select value={f.status} onChange={(e) => set('status', e.target.value as 'Active' | 'Inactive')}>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </Field>
        <Field label="Remarks" full>
          <textarea value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------------- Die ---
interface DieFormState {
  mainCode: string;
  material: string;
  top: Record<'l' | 'w' | 'h', string>;
  bottom: Record<'l' | 'w' | 'h', string>;
  shape: 'round' | 'square';
  topWeight: string;
  bottomWeight: string;
  makingDate: string;
  maker: string;
  drawingNo: string;
  revision: string;
  topUrl: string;
  bottomUrl: string;
  status: DieStatus;
  remarks: string;
  location: string;
  cost: string;
  pieces: string;
}

function DieFields({ f, set, kind, lockMain, existing }: { f: DieFormState; set: <K extends keyof DieFormState>(k: K, v: DieFormState[K]) => void; kind: DieKind; lockMain: boolean; existing?: Die }) {
  const { data, nextDieCode } = useDies();
  const main = data.mainDies.find((m) => m.code === f.mainCode);
  const options = data.mainDies.filter((m) => m.status === 'Active' || m.code === f.mainCode);
  return (
    <div className="form-grid">
      <Field label={`${KIND_LABEL[kind]} Die Code`} hint="Generated automatically — unique to this die">
        <input className="input mono" readOnly value={existing?.code ?? nextDieCode(kind)} />
      </Field>
      <Field label="Main Die Code" required>
        <select value={f.mainCode} disabled={lockMain} onChange={(e) => set('mainCode', e.target.value)}>
          <option value="">Select main die…</option>
          {options.map((m) => (
            <option key={m.code} value={m.code}>
              {m.code} — {m.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Die Name / Component Name" hint="Taken from the main die">
        <input className="input" readOnly value={main?.name ?? ''} />
      </Field>
      <Field label={`${KIND_LABEL[kind]} Die Material / Grade`} required>
        <input className="input" value={f.material} onChange={(e) => set('material', e.target.value)} placeholder="e.g. H13" />
      </Field>
      <Field label="Die Shape" hint={f.shape === 'round' ? 'Round: top and bottom length' : 'Square: length, width and height for top and bottom'}>
        <select value={f.shape} onChange={(e) => set('shape', e.target.value as 'round' | 'square')}>
          <option value="round">Round</option>
          <option value="square">Square</option>
        </select>
      </Field>
      <div className="field" />
      <DimsInput round={f.shape === 'round'} label={f.shape === 'round' ? 'Top Die — Length' : 'Top Die — Length / Width / Height'} value={f.top} onChange={(v) => set('top', v)} />
      <DimsInput round={f.shape === 'round'} label={f.shape === 'round' ? 'Bottom Die — Length' : 'Bottom Die — Length / Width / Height'} value={f.bottom} onChange={(v) => set('bottom', v)} />
      <Field label="Top Die Weight">
        <NumInput suffix="kg" step="any" value={f.topWeight} onChange={(v) => set('topWeight', v)} />
      </Field>
      <Field label="Bottom Die Weight">
        <NumInput suffix="kg" step="any" value={f.bottomWeight} onChange={(v) => set('bottomWeight', v)} />
      </Field>
      <Field label="Die Making Date" required hint={`Independent of the ${kind === 'forging' ? 'trimming' : 'forging'} die's date`}>
        <input className="input" type="date" value={f.makingDate} onChange={(e) => set('makingDate', e.target.value)} />
      </Field>
      {/* required, so a new die takes the maker name (write-only); an existing die's maker is never shown back to roles without access */}
      {(canSee('party_names') || !existing) && (
        <Field label="Die Maker Name" required>
          <input className="input" value={f.maker} onChange={(e) => set('maker', e.target.value)} />
        </Field>
      )}
      <Field label="Die Revision">
        <input className="input" value={f.revision} onChange={(e) => set('revision', e.target.value)} placeholder="R0" />
      </Field>
      <ImagePicker label="Top Die Image" value={f.topUrl} onChange={(v) => set('topUrl', v)} />
      <ImagePicker label="Bottom Die Image" value={f.bottomUrl} onChange={(v) => set('bottomUrl', v)} />
      <Field label="Die Status">
        <select value={f.status} onChange={(e) => set('status', e.target.value as DieStatus)}>
          {DIE_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </Field>
      {colOk('die.location') && (
        <Field label="Location / Storage Rack">
          <input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Rack A-2" />
        </Field>
      )}
      {canSee('die_cost') && (
        <Field label={`${KIND_LABEL[kind]} Die Cost (optional)`}>
          <NumInput suffix="₹" step="any" value={f.cost} onChange={(v) => set('cost', v)} />
        </Field>
      )}
      {colOk('die.pieces') && (
        <Field label="Pieces Produced (optional)">
          <NumInput suffix="PCS" value={f.pieces} onChange={(v) => set('pieces', v)} />
        </Field>
      )}
      <Field label="Remarks" full>
        <textarea value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
      </Field>
    </div>
  );
}

function useDieForm(init?: Die, mainCode = '', prefill = false) {
  const { data } = useDies();
  const url = (id?: string) => (id ? data.images[id] ?? '' : '');
  const [f, setF] = useState<DieFormState>({
    mainCode: init?.mainCode ?? mainCode,
    material: init?.material ?? '',
    top: dimsStr(init?.top ?? {}),
    bottom: dimsStr(init?.bottom ?? {}),
    shape: init && (init.top.w || init.top.h || init.bottom.w || init.bottom.h) ? 'square' : 'round',
    topWeight: str(init?.topWeight),
    bottomWeight: str(init?.bottomWeight),
    makingDate: prefill ? todayISO() : init?.makingDate ?? todayISO(),
    maker: canSee('party_names') ? init?.maker ?? '' : '',
    drawingNo: init?.drawingNo ?? '',
    revision: init?.revision ?? 'R0',
    topUrl: prefill ? '' : url(init?.topImg),
    bottomUrl: prefill ? '' : url(init?.bottomImg),
    status: prefill ? 'Available' : init?.status ?? 'Available',
    remarks: prefill ? '' : init?.remarks ?? '',
    location: prefill ? '' : init?.location ?? '',
    cost: prefill || !canSee('die_cost') ? '' : str(init?.cost),
    pieces: prefill ? '0' : String(init?.pieces ?? 0),
  });
  const set = <K extends keyof DieFormState>(k: K, v: DieFormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const toInput = (): DieInput => ({
    mainCode: f.mainCode,
    material: f.material,
    top: f.shape === 'round' ? { l: num(f.top.l) } : dimsNum(f.top),
    bottom: f.shape === 'round' ? { l: num(f.bottom.l) } : dimsNum(f.bottom),
    topWeight: num(f.topWeight),
    bottomWeight: num(f.bottomWeight),
    makingDate: f.makingDate,
    maker: f.maker,
    drawingNo: f.drawingNo,
    revision: f.revision,
    topUrl: f.topUrl,
    bottomUrl: f.bottomUrl,
    status: f.status,
    remarks: f.remarks,
    location: f.location,
    cost: num(f.cost),
    pieces: Number(f.pieces) || 0,
  });
  return { f, set, toInput };
}

export function DieForm({ kind, code, mainCode, onClose }: { kind: DieKind; code?: string; mainCode?: string; onClose: () => void }) {
  const { findDie, saveDie } = useDies();
  const existing = code ? findDie(kind, code) : undefined;
  const { f, set, toInput } = useDieForm(existing, mainCode);
  return (
    <Modal
      open
      size="lg"
      title={existing ? `Edit ${existing.code}` : `Add ${KIND_LABEL[kind]} Die`}
      subtitle={existing ? `Only this ${kind} die changes — other dies of the component are untouched.` : 'A new, independent die record linked to the main die.'}
      icon={kind === 'forging' ? Hammer : Scissors}
      onClose={onClose}
      footer={<Foot onClose={onClose} label={existing ? 'Save changes' : `Add ${KIND_LABEL[kind]} Die`} onSave={async () => (await saveDie(kind, toInput(), code)) && onClose()} />}
    >
      <DieFields f={f} set={set} kind={kind} lockMain={!!existing || !!mainCode} existing={existing} />
    </Modal>
  );
}

export function ReplaceForm({ kind, code, onClose }: { kind: DieKind; code: string; onClose: () => void }) {
  const { findDie, replaceDie } = useDies();
  const old = findDie(kind, code)!;
  const { f, set, toInput } = useDieForm(old, old.mainCode, true);
  const [oldStatus, setOldStatus] = useState<DieStatus>('Retired');
  const [reason, setReason] = useState('');
  const other = kind === 'forging' ? 'trimming' : 'forging';
  return (
    <Modal
      open
      size="lg"
      title={`Replace ${old.code}`}
      subtitle={`Creates a new ${kind} die for ${old.mainCode}. ${old.code} is kept for history; ${other} dies are not touched.`}
      icon={ArrowLeftRight}
      onClose={onClose}
      footer={<Foot onClose={onClose} label="Create replacement die" onSave={async () => (await replaceDie(kind, code, toInput(), oldStatus, reason)) && onClose()} />}
    >
      <div className="replace-old">
        <div>
          <b>Old die {old.code}</b> will stay on record. Set how it should be kept:
        </div>
        <select value={oldStatus} onChange={(e) => setOldStatus(e.target.value as DieStatus)} aria-label="Status of the old die">
          <option>Retired</option>
          <option>Damaged</option>
        </select>
        <input className="input" placeholder="Reason for replacement (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <DieFields f={f} set={set} kind={kind} lockMain existing={undefined} />
    </Modal>
  );
}

// ------------------------------------------------- Maintenance / issue ---
export function MaintenanceForm({ kind, code, onClose }: { kind: DieKind; code: string; onClose: () => void }) {
  const { findDie, recordMaintenance } = useDies();
  const die = findDie(kind, code)!;
  const [date, setDate] = useState(todayISO());
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState<DieStatus>('Under Maintenance');
  return (
    <Modal open title={`Maintenance — ${code}`} subtitle="Recorded against this die only." icon={Wrench} onClose={onClose} footer={<Foot onClose={onClose} label="Record maintenance" onSave={async () => (await recordMaintenance(kind, code, { date, remarks, status })) && onClose()} />}>
      <div className="form-grid">
        <Field label="Maintenance Date" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Die Status after this" hint={`Currently ${die.status}`}>
          <select value={status} onChange={(e) => setStatus(e.target.value as DieStatus)}>
            {DIE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Maintenance Remarks" required full>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What was done / found" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

export function IssueForm({ kind, code, onClose }: { kind: DieKind; code: string; onClose: () => void }) {
  const { issueDie } = useDies();
  const [date, setDate] = useState(todayISO());
  const [issuedTo, setTo] = useState('');
  const [remarks, setRemarks] = useState('');
  return (
    <Modal open title={`Issue ${code} to production`} icon={Upload} onClose={onClose} footer={<Foot onClose={onClose} label="Issue die" onSave={async () => (await issueDie(kind, code, { date, issuedTo, remarks })) && onClose()} />}>
      <div className="form-grid">
        <Field label="Issue Date" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Issued To (press / operator)" required>
          <input className="input" value={issuedTo} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Press 2 — 400 T" autoFocus />
        </Field>
        <Field label="Remarks" full>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReturnForm({ kind, code, onClose }: { kind: DieKind; code: string; onClose: () => void }) {
  const { returnDie } = useDies();
  const [date, setDate] = useState(todayISO());
  const [pieces, setPieces] = useState('');
  const [remarks, setRemarks] = useState('');
  const [status, setStatus] = useState<DieStatus>('Available');
  return (
    <Modal open title={`Return ${code} from production`} icon={Undo2} onClose={onClose} footer={<Foot onClose={onClose} label="Mark returned" onSave={async () => (await returnDie(kind, code, { date, pieces: Number(pieces) || 0, remarks, status })) && onClose()} />}>
      <div className="form-grid">
        <Field label="Return Date" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Pieces Produced this run" hint="Added to the die's total">
          <NumInput value={pieces} onChange={setPieces} autoFocus />
        </Field>
        <Field label="Die Condition on return">
          <select value={status} onChange={(e) => setStatus(e.target.value as DieStatus)}>
            {DIE_STATUSES.filter((s) => s !== 'In Production').map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Remarks" full>
          <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------- Timeline ---
export function HistoryList({ events, showCode = true }: { events: HistoryEvent[]; showCode?: boolean }) {
  if (!events.length) return <div className="muted" style={{ padding: '14px 4px' }}>No history recorded yet.</div>;
  const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  return (
    <ul className="die-tl">
      {sorted.map((h) => (
        <li key={h.id} className={`ev-${h.event.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
          <span className="dot" />
          <div className="ev-head">
            <b>{h.event}</b>
            <KindChip kind={h.kind} />
            {showCode && <span className="mono strong">{h.dieCode}</span>}
            <span className="when">{fmtDate(h.date)}</span>
          </div>
          {h.remarks && <div className="ev-rem">{h.remarks}</div>}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------- Die viewer ---
export function DieView({ kind, code, onClose }: { kind: DieKind; code: string; onClose: () => void }) {
  const { data, findDie, openUI } = useDies();
  const die = findDie(kind, code);
  if (!die) return null;
  const main = data.mainDies.find((m) => m.code === die.mainCode)!;
  const hist = data.history.filter((h) => h.dieCode === code && h.kind === kind);
  const maint = data.maintenance.filter((m) => m.dieCode === code && m.kind === kind).sort((a, b) => b.date.localeCompare(a.date));
  const issues = data.issues.filter((i) => i.dieCode === code && i.kind === kind).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
  const canIssue = die.status === 'Available';
  const canReturn = die.status === 'In Production';
  const live = die.status !== 'Retired';
  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <div className="kv">
      <span>{k}</span>
      <b>{v || '—'}</b>
    </div>
  );
  return (
    <Modal
      open
      size="lg"
      title={`${die.code} · ${main.name}`}
      subtitle={
        <span className="inline-meta">
          <KindChip kind={kind} /> <DieBadge status={die.status} /> <DemoChip demo={die.demo} />
        </span>
      }
      icon={kind === 'forging' ? Hammer : Scissors}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={() => printDieCard(main, data, die)}>
            <Printer size={15} /> Print Die Card
          </button>
          <button className="btn" onClick={() => openUI({ kind: 'die-form', dieKind: kind, code })}>
            <Pencil size={15} /> Edit
          </button>
          {live && (
            <button className="btn" onClick={() => openUI({ kind: 'maintenance', dieKind: kind, code })}>
              <Wrench size={15} /> Maintenance
            </button>
          )}
          {canIssue && (
            <button className="btn" onClick={() => openUI({ kind: 'issue', dieKind: kind, code })}>
              <Upload size={15} /> Issue
            </button>
          )}
          {canReturn && (
            <button className="btn" onClick={() => openUI({ kind: 'return', dieKind: kind, code })}>
              <Undo2 size={15} /> Return
            </button>
          )}
          {!die.replacedByCode && (
            <button className="btn btn-primary" onClick={() => openUI({ kind: 'replace', dieKind: kind, code })}>
              <ArrowLeftRight size={15} /> Replace Die
            </button>
          )}
        </>
      }
    >
      <div className="die-imgs">
        <Thumb big id={die.topImg} label="Top die" />
        <Thumb big id={die.bottomImg} label="Bottom die" />
      </div>
      <div className="kv-grid">
        <Row k="Main Die" v={<span className="mono">{main.code} · {main.partCode}</span>} />
        <Row k="Material / Grade" v={die.material} />
        <Row k="Making Date" v={fmtDate(die.makingDate)} />
        {canSee('party_names') && <Row k="Die Maker" v={die.maker} />}
        <Row k="Top Die" v={`${fmtDims(die.top)} · ${fmtWt(die.topWeight)}`} />
        <Row k="Bottom Die" v={`${fmtDims(die.bottom)} · ${fmtWt(die.bottomWeight)}`} />
        <Row k="Revision" v={die.revision || '—'} />
        {colOk('die.location') && <Row k="Location" v={die.location} />}
        {colOk('die.pieces') && <Row k="Pieces Produced" v={die.pieces.toLocaleString('en-IN')} />}
        {canSee('die_cost') && <Row k={`${KIND_LABEL[kind]} Die Cost`} v={die.cost === undefined ? '' : `₹ ${die.cost.toLocaleString('en-IN')}`} />}
        <Row k="Last Maintenance" v={die.lastMaintDate ? fmtDate(die.lastMaintDate) : ''} />
        <Row k="Maintenance Remarks" v={die.maintRemarks} />
        {die.replacesCode && <Row k="Replaces" v={<span className="mono">{die.replacesCode}</span>} />}
        {die.replacedByCode && <Row k="Replaced by" v={<span className="mono">{die.replacedByCode}</span>} />}
        <Row k="Remarks" v={die.remarks} />
      </div>

      {issues.length > 0 && (
        <>
          <h4 className="sec-title">Issue &amp; return</h4>
          <div className="table-wrap">
            <table className="tbl compact mini-tbl">
              <thead>
                <tr>
                  <th>Issued</th>
                  <th>To</th>
                  <th>Returned</th>
                  <th className="r">Pieces</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((i) => (
                  <tr key={i.id}>
                    <td>{fmtDate(i.issuedOn)}</td>
                    <td>{i.issuedTo}</td>
                    <td>{i.returnedOn ? fmtDate(i.returnedOn) : <span className="badge b-blue">Out on floor</span>}</td>
                    <td className="r">{i.pieces ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {maint.length > 0 && (
        <>
          <h4 className="sec-title">Maintenance</h4>
          <ul className="plain-list">
            {maint.map((m) => (
              <li key={m.id}>
                <b>{fmtDate(m.date)}</b> — {m.remarks}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="sec-title">
        <HistoryIcon size={15} /> History of {die.code}
      </h4>
      <HistoryList events={hist} showCode={false} />
    </Modal>
  );
}
