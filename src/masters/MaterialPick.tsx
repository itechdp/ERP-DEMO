import { ADD_NEW, MaterialModal, useAddOption } from './AddItem';
import { useState } from 'react';
import { MATERIAL_FAMILIES, MATERIAL_MASTER, STANDARD_OD_MM } from '../store/materials';

/**
 * Material drop-down for item lines (requisition, purchase order, supplier quotation, quotation, sales order): the same list as
 * the Material drop-down in Raw Inventory — managed in Settings → Drop-down Lists, with "+ Add new material…" at the bottom.
 *   mode "material": shows the material; choosing one fills `material` AND its `grade`.
 *   mode "grade":    shows the grade; choosing one fills `grade` only.
 * A value typed on an older document that is not on the list stays visible (and selectable).
 */
export function MaterialPick({ material, grade, onChange, mode = 'material' }: { material?: string; grade?: string; onChange: (v: { material: string; grade: string }) => void; mode?: 'material' | 'grade' }) {
  const [adding, setAdding] = useState(false);
  const cur = mode === 'material' ? material || '' : grade || '';
  const known = mode === 'material' ? MATERIAL_MASTER.some((m) => m.material === cur) : MATERIAL_MASTER.some((m) => m.grade === cur);
  const grades = (fam: string) => [...new Map(MATERIAL_MASTER.filter((m) => m.family === fam).map((m) => [m.grade, m])).values()];

  const pick = (v: string) => {
    if (v === ADD_NEW) return setAdding(true);
    if (mode === 'material') {
      const spec = MATERIAL_MASTER.find((m) => m.material === v);
      onChange({ material: v, grade: spec ? spec.grade : grade || '' });
    } else onChange({ material: material || '', grade: v });
  };

  return (
    <>
      <select value={cur} onChange={(e) => pick(e.target.value)}>
        <option value="">{mode === 'material' ? 'Select material…' : 'Select grade…'}</option>
        {cur && !known && <option value={cur}>{cur}</option>}
        {MATERIAL_FAMILIES.map((fam) => (
          <optgroup key={fam} label={fam}>
            {mode === 'material'
              ? MATERIAL_MASTER.filter((m) => m.family === fam).map((m) => (
                  <option key={m.material} value={m.material}>
                    {m.material}
                  </option>
                ))
              : grades(fam).map((m) => (
                  <option key={m.grade} value={m.grade}>
                    {m.grade}
                  </option>
                ))}
          </optgroup>
        ))}
        <option value={ADD_NEW}>+ Add new material…</option>
      </select>
      {adding && (
        <MaterialModal
          onClose={() => setAdding(false)}
          onSaved={(name) => {
            setAdding(false);
            const spec = MATERIAL_MASTER.find((m) => m.material === name);
            onChange({ material: mode === 'material' ? name : material || '', grade: spec?.grade ?? grade ?? '' });
          }}
        />
      )}
    </>
  );
}

/** Size drop-down for item lines: the bar sizes from Settings → Drop-down Lists ("50 mm"), with "+ Add new size…". */
export function SizePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const add = useAddOption('od_size', (v) => onChange(`${v} mm`));
  const sizes = STANDARD_OD_MM.map((n) => `${n} mm`);
  return (
    <>
      <select
        value={value || ''}
        onChange={(e) => (e.target.value === ADD_NEW ? add.open() : onChange(e.target.value))}
      >
        <option value="">Select size…</option>
        {value && !sizes.includes(value) && <option value={value}>{value}</option>}
        {sizes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
        <option value={ADD_NEW}>+ Add new size…</option>
      </select>
      {add.modal}
    </>
  );
}
