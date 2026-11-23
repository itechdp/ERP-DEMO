import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

export interface StaffOption {
  name: string;
  designation: string;
}

/** Several names are saved in one text field, separated by commas ("Vijay, Ramesh"); one name (older entries) reads the same way. */
export const splitNames = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
export const joinNames = (names: string[]) => names.join(', ');

/**
 * Pick several people from the plant staff list (Settings → Drop-down Lists → Plant Staff).
 * Type to filter, click a name (or press Enter for the first match) to add it as a chip; × or Backspace removes one.
 * A saved name that is no longer on the list is kept as a chip. Nothing is required — it may be left empty.
 */
export function StaffMultiSelect({ value, onChange, staff, placeholder = 'Type a name…' }: { value: string[]; onChange: (names: string[]) => void; staff: StaffOption[]; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  const needle = q.trim().toLowerCase();
  const options = staff.filter((s) => !value.includes(s.name) && (!needle || s.name.toLowerCase().includes(needle) || s.designation.toLowerCase().includes(needle)));
  const add = (name: string) => {
    if (!value.includes(name)) onChange([...value, name]);
    setQ('');
    setHi(0);
    input.current?.focus();
  };
  const remove = (name: string) => onChange(value.filter((n) => n !== name));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();                       // never submits the form
      if (open && options[hi]) add(options[hi].name);
    } else if (e.key === 'Backspace' && q === '' && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="person-select" ref={ref}>
      <div className="input multi-box" onClick={() => { setOpen(true); input.current?.focus(); }}>
        {value.map((n) => (
          <span key={n} className="multi-chip">
            {n}
            <button type="button" aria-label={`Remove ${n}`} onClick={(e) => { e.stopPropagation(); remove(n); }}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={value.length ? '' : placeholder}
          aria-label="Search staff"
        />
        {value.length > 0 && <span className="multi-count">{value.length} selected</span>}
      </div>
      {open && (
        <div className="person-list" role="listbox">
          {options.length === 0 ? (
            <div className="person-row muted" style={{ cursor: 'default' }}>
              {staff.length === 0 ? 'No names yet — add them in Settings → Drop-down Lists → Plant Staff' : needle ? `No name matches “${q.trim()}”` : 'Everyone is selected'}
            </div>
          ) : (
            options.map((s, i) => (
              <button key={s.name} type="button" role="option" aria-selected={i === hi} className={`person-row ${i === hi ? 'on' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => add(s.name)}>
                <span className="person-name">{s.name}</span>
                <span className="text-xs muted">{s.designation}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
