import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ROLES } from '../auth/access';

export interface PersonOption {
  id: string;
  name: string;
  role: string;
}

/** one colour per role, using the badge colours of the app */
const ROLE_TONE: Record<string, string> = {
  director: 'b-violet',
  plant_head: 'b-teal',
  accounts: 'b-blue',
  operator: 'b-amber',
  qc: 'b-green',
  viewer: 'b-neutral',
};

export function RoleTag({ role }: { role: string }) {
  return <span className={`badge ${ROLE_TONE[role] ?? 'b-neutral'}`}>{ROLES.find((r) => r.value === role)?.label ?? role}</span>;
}

/**
 * A dropdown of people: the name on the left, a coloured role tag on the right of each line.
 * (A browser's own <select> cannot show coloured tags, so this one is drawn by the app.)
 * A `value` that is not on the list (an old task whose person was removed) is kept and shown without a tag.
 */
export function PersonSelect({ value, onChange, people, placeholder = 'Select a person…' }: { value: string; onChange: (name: string) => void; people: PersonOption[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const cur = people.find((p) => p.name === value);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <div className="person-select" ref={ref}>
      <button type="button" className="input person-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={value ? 'person-name' : 'person-name muted'}>{value || placeholder}</span>
        {cur && <RoleTag role={cur.role} />}
        <ChevronDown size={16} className="person-chev" />
      </button>
      {open && (
        <div className="person-list" role="listbox">
          <button type="button" className="person-row" onClick={() => pick('')}>
            <span className="person-name muted">{placeholder}</span>
          </button>
          {value && !cur && (
            <button type="button" className="person-row on" onClick={() => pick(value)}>
              <span className="person-name">{value}</span>
              <Check size={14} />
            </button>
          )}
          {people.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={p.name === value} className={`person-row ${p.name === value ? 'on' : ''}`} onClick={() => pick(p.name)}>
              <span className="person-name">{p.name}</span>
              <RoleTag role={p.role} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
