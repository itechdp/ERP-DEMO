import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Field, Modal } from '../components/ui';
import { useStore } from '../store/StoreContext';
import { MATERIAL_FAMILIES, MATERIAL_MASTER, type MaterialSpec } from '../store/materials';
import { optionList } from './optionLists';
import { saveMaterial, saveOptionList } from './service';
import { useOptions } from './useOptions';

/** the value of the "+ Add new …" line at the bottom of a drop-down; the form opens its add box instead of selecting it */
export const ADD_NEW = '__new__';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "+ Add new …" for an editable list (bar sizes, lost reasons, payment modes, departments).
 *   const add = useAddOption('lost_reason', (v) => setReason(v));
 *   <select onChange={(e) => (e.target.value === ADD_NEW ? add.open() : setReason(e.target.value))}> … <option value={ADD_NEW}>+ Add new reason…</option>
 *   {add.modal}
 */
export function useAddOption(listKey: string, onAdded: (value: string) => void) {
  const items = useOptions(listKey);
  const { refresh } = useStore();
  const [on, setOn] = useState(false);
  const def = optionList(listKey);
  const modal = on ? (
    <AddItemModal
      title={`Add to ${def?.label ?? 'the list'}`}
      label={def?.unit ? `New size (${def.unit})` : 'New item'}
      numeric={!!def?.unit}
      hint={def?.hint}
      onClose={() => setOn(false)}
      onSave={async (v) => {
        await saveOptionList(listKey, [...items, v]);
        await refresh();
        onAdded(v);
        setOn(false);
      }}
    />
  ) : null;
  return { open: () => setOn(true), modal };
}

export function AddItemModal({ title, label, hint, numeric, onSave, onClose }: { title: string; label: string; hint?: string; numeric?: boolean; onSave: (value: string) => Promise<void>; onClose: () => void }) {
  const { toast } = useStore();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const v = value.trim();
  const valid = numeric ? Number(v) > 0 : v !== '';
  const submit = async () => {
    setBusy(true);
    try {
      await onSave(numeric ? String(Number(v)) : v);
    } catch (e) {
      toast({ kind: 'error', title: 'Could not add', message: errText(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
            <Plus size={15} /> {busy ? 'Adding…' : 'Add'}
          </button>
        </>
      }
    >
      <Field label={label} required hint={hint}>
        <input className="input" type={numeric ? 'number' : 'text'} step="any" min="0" value={value} onChange={(e) => setValue(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && valid && !busy && void submit()} />
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ materials
/** Add (or, with `edit`, change) a raw material: its family, grade and density feed the theoretical weights. */
export function MaterialModal({ edit, onClose, onSaved }: { edit?: MaterialSpec; onClose: () => void; onSaved: (name: string) => void }) {
  const { refresh, toast } = useStore();
  const NEW = '__newfamily__';
  const [family, setFamily] = useState(edit?.family ?? MATERIAL_FAMILIES[0] ?? NEW);
  const [newFamily, setNewFamily] = useState('');
  const [name, setName] = useState(edit?.material ?? '');
  const [grade, setGrade] = useState(edit?.grade ?? '');
  const [density, setDensity] = useState(edit ? String(edit.density) : '');
  const [od, setOd] = useState(edit ? String(edit.defaultOd) : '');
  const [busy, setBusy] = useState(false);
  const fam = family === NEW ? newFamily.trim() : family;
  const valid = fam !== '' && name.trim() !== '' && grade.trim() !== '' && Number(density) > 0 && Number(od) > 0;

  const submit = async () => {
    setBusy(true);
    try {
      await saveMaterial({ old: edit?.material, family: fam, material: name.trim(), grade: grade.trim(), density: Number(density), defaultOd: Number(od) });
      await refresh();
      toast({ kind: 'success', title: edit ? 'Material updated' : 'Material added', message: name.trim() });
      onSaved(name.trim());
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the material', message: errText(e) });
      setBusy(false);
    }
  };
  const taken = !edit && MATERIAL_MASTER.some((m) => m.material.toLowerCase() === name.trim().toLowerCase());

  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={edit ? 'Edit Material' : 'Add Material'}
      subtitle="Round bars the plant buys. The name is what stock and products are tracked under."
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!valid || busy || taken} onClick={() => void submit()}>{busy ? 'Saving…' : edit ? 'Save Changes' : 'Add Material'}</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Family" required>
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            {MATERIAL_FAMILIES.map((f) => <option key={f}>{f}</option>)}
            <option value={NEW}>+ A new family…</option>
          </select>
        </Field>
        {family === NEW && (
          <Field label="New family name" required>
            <input className="input" value={newFamily} onChange={(e) => setNewFamily(e.target.value)} placeholder="e.g. Titanium" autoFocus />
          </Field>
        )}
        <Field label="Material name" required error={taken ? 'This material already exists' : null} hint="As it should appear in lists, e.g. EN8 Steel Round Bar">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Grade / specification" required>
          <input className="input" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. EN8 / 080M40" />
        </Field>
        <Field label="Density (g/cm³)" required hint="Steel 7.85 · Brass 8.4 · Copper 8.94 · Aluminium 2.7">
          <input className="input" type="number" step="any" min="0" value={density} onChange={(e) => setDensity(e.target.value)} />
        </Field>
        <Field label="Usual bar size (mm)" required hint="Pre-selected when this material is chosen">
          <input className="input" type="number" step="any" min="0" value={od} onChange={(e) => setOd(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/** a small helper so a page can open the material box from its drop-down */
export function useAddMaterial(onAdded: (name: string) => void): { open: () => void; modal: ReactNode } {
  const [on, setOn] = useState(false);
  return {
    open: () => setOn(true),
    modal: on ? (
      <MaterialModal
        onClose={() => setOn(false)}
        onSaved={(n) => {
          setOn(false);
          onAdded(n);
        }}
      />
    ) : null,
  };
}
