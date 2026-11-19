import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { MATERIAL_FAMILIES, MATERIAL_MASTER } from '../store/materials';
import { LB_PER_KG, LEN_UNITS, OTHER_METALS, SHAPES, computeWeight, shapeById, type LenUnit, type ShapeId } from './calc';

const PREF_KEY = 'forgeflow.metalweight';
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const fmt = (v: number, max = 3) => v.toLocaleString('en-IN', { maximumFractionDigits: max });

/** the material drop-down value: m: = the company's material master, x: = another common metal, custom = a typed density */
const matOptions = () => ({
  master: MATERIAL_FAMILIES.map((f) => ({ family: f, items: MATERIAL_MASTER.filter((m) => m.family === f) })),
  other: OTHER_METALS,
});
const densityOf = (key: string): number | null => {
  if (key.startsWith('m:')) return MATERIAL_MASTER.find((m) => m.material === key.slice(2))?.density ?? null;
  if (key.startsWith('x:')) return OTHER_METALS.find((m) => m.name === key.slice(2))?.density ?? null;
  return null;
};

interface Prefs { shape: ShapeId; sizeUnit: LenUnit; lengthUnit: LenUnit; mat: string }
const loadPrefs = (): Partial<Prefs> => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const savePrefs = (p: Prefs) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage blocked: it just will not be remembered */ } };

/**
 * Metal Weight Calculator: pick the shape and material, type the sizes and the length, and read the weight.
 * Weight = cross-section area × length × density (see calc.ts). The steps are shown so the number can be checked by hand.
 */
export function MetalWeightCalculator() {
  const saved = useMemo(loadPrefs, []);
  const valid = (id: unknown): id is LenUnit => LEN_UNITS.some((u) => u.id === id);
  const [shape, setShape] = useState<ShapeId>(SHAPES.some((s) => s.id === saved.shape) ? (saved.shape as ShapeId) : 'round');
  const [sizeUnit, setSizeUnit] = useState<LenUnit>(valid(saved.sizeUnit) ? saved.sizeUnit : 'mm');
  const [lengthUnit, setLengthUnit] = useState<LenUnit>(valid(saved.lengthUnit) ? saved.lengthUnit : 'mm');
  // no material is chosen for the user the first time: a weight read for the wrong metal is worse than one more click. The last choice is remembered.
  const startMat = saved.mat && (densityOf(saved.mat) != null || saved.mat === 'custom') ? saved.mat : '';
  const [mat, setMat] = useState<string>(startMat);
  const [density, setDensity] = useState<string>(() => (startMat && densityOf(startMat) != null ? String(densityOf(startMat)) : ''));
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [length, setLength] = useState('');
  const [qty, setQty] = useState('1');

  useEffect(() => { savePrefs({ shape, sizeUnit, lengthUnit, mat }); }, [shape, sizeUnit, lengthUnit, mat]);

  const def = shapeById(shape);
  const res = computeWeight({
    shape,
    sizes: Object.fromEntries(def.fields.map((f) => [f.key, num(sizes[f.key] ?? '')])),
    sizeUnit,
    length: num(length),
    lengthUnit,
    density: num(density),
    qty: num(qty),
  });
  // an error is shown beside a field only when something was typed there; an empty field is just "still to enter"
  const raw: Record<string, string> = { ...sizes, length, density, qty };
  const shown = (k: string) => (res.errors[k] && (raw[k] ?? '').trim() !== '' ? res.errors[k] : '');
  const missing = [...(density.trim() === '' ? ['Material'] : []), ...def.fields.filter((f) => (sizes[f.key] ?? '').trim() === '').map((f) => f.label), ...(length.trim() === '' ? ['Length'] : [])];

  const pickMaterial = (key: string) => {
    setMat(key);
    const d = densityOf(key);
    if (d != null) setDensity(String(d));
    else if (key === '') setDensity('');
  };
  const reset = () => { setSizes({}); setLength(''); setQty('1'); };
  const opts = matOptions();
  const unitSelect = (v: LenUnit, set: (u: LenUnit) => void, label: string) => (
    <select value={v} onChange={(e) => set(e.target.value as LenUnit)} aria-label={label} className="mw-unit">
      {LEN_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
    </select>
  );
  const box = (k: string, label: string, value: string, set: (v: string) => void, unit?: React.ReactNode, hint?: string, step = 'any') => (
    <div className="field" key={k}>
      <label>{label}</label>
      <div className="mw-row">
        <input type="number" min="0" step={step} inputMode="decimal" className={shown(k) ? 'bad' : ''} value={value} placeholder="0" aria-label={label} aria-invalid={!!shown(k)} onChange={(e) => set(e.target.value)} />
        {unit}
      </div>
      {shown(k) ? <div className="mw-err">{shown(k)}</div> : hint ? <div className="mw-hint">{hint}</div> : null}
    </div>
  );

  return (
    <div className="mw">
      <div className="mw-form">
        <div className="mw-block">
          <div className="mw-title">1 · Shape</div>
          <div className="mw-shapes" role="radiogroup" aria-label="Shape">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={s.id === shape} className={`mw-shape${s.id === shape ? ' on' : ''}`} onClick={() => setShape(s.id)}>
                <b>{s.label}</b>
                <span>{s.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mw-block">
          <div className="mw-title">2 · Material</div>
          <div className="mw-cols">
            <div className="field">
              <label>Material</label>
              <select value={mat} onChange={(e) => pickMaterial(e.target.value)} aria-label="Material">
                <option value="" disabled>Select the material…</option>
                {opts.master.map((g) => (
                  <optgroup key={g.family} label={g.family}>
                    {g.items.map((m) => <option key={m.material} value={`m:${m.material}`}>{m.material}</option>)}
                  </optgroup>
                ))}
                <optgroup label="Common metals (typical density)">
                  {opts.other.map((m) => <option key={m.name} value={`x:${m.name}`}>{m.name}</option>)}
                </optgroup>
                <option value="custom">Custom density…</option>
              </select>
            </div>
            {box('density', 'Density', density, (v) => { setDensity(v); setMat('custom'); }, <span className="mw-suffix">g/cm³</span>, mat === 'custom' ? 'Typed by hand.' : 'From the material list. Change it if your supplier’s value is different.')}
          </div>
        </div>

        <div className="mw-block">
          <div className="mw-title">3 · Size</div>
          <div className="mw-units">
            <label>Sizes in {unitSelect(sizeUnit, setSizeUnit, 'Unit for the sizes')}</label>
            <label>Length in {unitSelect(lengthUnit, setLengthUnit, 'Unit for the length')}</label>
          </div>
          <div className="mw-cols">
            {def.fields.map((f) => box(f.key, f.label, sizes[f.key] ?? '', (v) => setSizes((s) => ({ ...s, [f.key]: v })), <span className="mw-suffix">{sizeUnit}</span>, f.hint))}
            {box('length', 'Length', length, setLength, <span className="mw-suffix">{lengthUnit}</span>)}
            {box('qty', 'Pieces', qty, setQty, <span className="mw-suffix">pcs</span>, undefined, '1')}
          </div>
          <button type="button" className="btn btn-sm btn-subtle" onClick={reset}><RotateCcw size={13} /> Clear sizes</button>
        </div>
      </div>

      <div className="mw-result" aria-live="polite">
        {res.ok ? (
          <>
            <div className="mw-label">{res.qty > 1 ? `Total weight of ${fmt(res.qty, 0)} pieces` : 'Weight of 1 piece'}</div>
            <div className="mw-big">{fmt(res.totalKg)} <small>kg</small></div>
            <div className="mw-alt">
              <span>{fmt(res.totalKg * 1000, 1)} g</span>
              <span>{fmt(res.totalKg * LB_PER_KG)} lb</span>
            </div>
            {res.qty > 1 && <div className="mw-one">Each piece: <b>{fmt(res.pieceKg)} kg</b></div>}
            <dl className="mw-facts">
              <div><dt>Weight per metre</dt><dd>{fmt(res.kgPerM)} kg/m</dd></div>
              <div><dt>Cross-section area</dt><dd>{fmt(res.areaMm2 / 100, 3)} cm²</dd></div>
              <div><dt>Volume of 1 piece</dt><dd>{fmt(res.volumeCm3, 3)} cm³</dd></div>
            </dl>
            <div className="mw-steps">
              <div className="mw-title">How it was worked out</div>
              <div>{def.formula}</div>
              <div>Area = <b>{fmt(res.areaMm2 / 100)} cm²</b></div>
              <div>Volume = {fmt(res.areaMm2 / 100)} cm² × {fmt(res.lengthMm / 10)} cm = <b>{fmt(res.volumeCm3)} cm³</b></div>
              <div>Weight = {fmt(res.volumeCm3)} cm³ × {fmt(Number(density), 4)} g/cm³ = {fmt(res.pieceKg * 1000, 1)} g = <b>{fmt(res.pieceKg)} kg</b></div>
            </div>
          </>
        ) : (
          <div className="mw-empty">
            <div className="mw-big muted">— <small>kg</small></div>
            <p>{missing.length ? `Enter: ${missing.join(', ')}.` : 'Check the highlighted values.'}</p>
            <div className="mw-steps"><div className="mw-title">Formula for {def.label.toLowerCase()}</div><div>{def.formula}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}
