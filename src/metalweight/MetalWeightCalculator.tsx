import { useState } from 'react';
import { Calculator, RotateCcw, Save, Trash2 } from 'lucide-react';
import { calculate, fromCm, LEN_UNITS, MATERIALS, materialOfDensity, WT_UNITS, type CalcInput, type LenUnit, type Mode, type PipeBy, type Shape, type WtUnit } from './calc';

const HISTORY_KEY = 'forgeflow.metalweight.history';
const num = (s: string) => (s.trim() === '' ? null : Number(s));
const fmt = (v: number, max = 3) => v.toLocaleString('en-IN', { maximumFractionDigits: max });
const inr = (v: number) => `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** everything on the form, as typed */
interface Form {
  mat: string; // a MATERIALS id, or 'custom'
  density: string;
  shape: Shape;
  mode: Mode;
  d: string;
  dUnit: LenUnit;
  od: string;
  odUnit: LenUnit;
  pipeBy: PipeBy;
  wall: string;
  wallUnit: LenUnit;
  length: string;
  lengthUnit: LenUnit;
  weight: string;
  weightUnit: WtUnit;
  pieces: string;
  price: string;
  /** By Weight: the unit the length is shown in */
  outUnit: LenUnit;
}
const BLANK: Form = {
  mat: 'steel', density: '7.85', shape: 'round', mode: 'length', d: '', dUnit: 'mm', od: '', odUnit: 'mm', pipeBy: 'wall', wall: '', wallUnit: 'mm',
  length: '', lengthUnit: 'mm', weight: '', weightUnit: 'kg', pieces: '', price: '', outUnit: 'mm',
};

interface Saved { id: number; at: string; title: string; result: string; form: Form }
const loadHistory = (): Saved[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(v) ? (v as Saved[]).slice(0, 15) : [];
  } catch {
    return [];
  }
};
const storeHistory = (h: Saved[]) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 15)));
  } catch {
    /* storage blocked (private window): the list just is not kept */
  }
};

const toInput = (f: Form): CalcInput => ({
  shape: f.shape, mode: f.mode, density: num(f.density), d: num(f.d), dUnit: f.dUnit, od: num(f.od), odUnit: f.odUnit, pipeBy: f.pipeBy, wall: num(f.wall), wallUnit: f.wallUnit,
  length: num(f.length), lengthUnit: f.lengthUnit, weight: num(f.weight), weightUnit: f.weightUnit, pieces: num(f.pieces), price: num(f.price),
});

/** the cross-section drawn for the chosen shape: a circle with D across it, or a ring with OD and the wall (T) / ID */
function ShapeDiagram({ shape, pipeBy }: { shape: Shape; pipeBy: PipeBy }) {
  return (
    <svg viewBox="0 0 120 120" className="mw-svg" role="img" aria-label={shape === 'round' ? 'Round bar: diameter D' : `Pipe: outer diameter OD and ${pipeBy === 'wall' ? 'wall thickness T' : 'inner diameter ID'}`}>
      <defs>
        <marker id="mw-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
        </marker>
      </defs>
      {shape === 'round' ? (
        <>
          <circle cx="60" cy="60" r="44" className="mw-svg-metal" />
          <line x1="18" y1="60" x2="102" y2="60" className="mw-svg-dim" markerStart="url(#mw-arrow)" markerEnd="url(#mw-arrow)" />
          <text x="60" y="52" className="mw-svg-label">D</text>
        </>
      ) : (
        <>
          <circle cx="60" cy="60" r="46" className="mw-svg-metal" />
          <circle cx="60" cy="60" r="30" className="mw-svg-hole" />
          <line x1="16" y1="22" x2="104" y2="22" className="mw-svg-dim" markerStart="url(#mw-arrow)" markerEnd="url(#mw-arrow)" />
          <line x1="14" y1="16" x2="14" y2="60" className="mw-svg-guide" />
          <line x1="106" y1="16" x2="106" y2="60" className="mw-svg-guide" />
          <text x="60" y="16" className="mw-svg-label">OD</text>
          {pipeBy === 'wall' ? (
            <>
              <line x1="90" y1="60" x2="106" y2="60" className="mw-svg-dim" markerStart="url(#mw-arrow)" markerEnd="url(#mw-arrow)" />
              <text x="98" y="78" className="mw-svg-label">T</text>
            </>
          ) : (
            <>
              <line x1="31" y1="60" x2="89" y2="60" className="mw-svg-dim" markerStart="url(#mw-arrow)" markerEnd="url(#mw-arrow)" />
              <text x="60" y="54" className="mw-svg-label">ID</text>
            </>
          )}
        </>
      )}
    </svg>
  );
}

/**
 * Dashboard → Metal Weight Calculator. Round Bar or Pipe / Round Tube; By Length (sizes → weight) or By Weight (weight → length).
 * The formulas are in calc.ts. CALCULATE works it out, CLEAR empties the form, SAVE keeps the result in a short list on this device.
 */
export function MetalWeightCalculator() {
  const [f, setF] = useState<Form>(BLANK);
  const [shown, setShown] = useState(false); // CALCULATE pressed: results (and messages) are shown, and follow further edits
  const [history, setHistory] = useState<Saved[]>(loadHistory);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const res = calculate(toInput(f));
  const err = (k: string) => (shown ? res.errors[k] : undefined);

  const pickMaterial = (id: string) => {
    const m = MATERIALS.find((x) => x.id === id);
    setF((x) => ({ ...x, mat: id, density: m ? String(m.density) : x.density }));
  };
  // a density typed by hand selects the matching material, or Custom
  const typeDensity = (v: string) => setF((x) => ({ ...x, density: v, mat: materialOfDensity(num(v))?.id ?? 'custom' }));
  const clear = () => {
    setF(BLANK);
    setShown(false);
  };
  const matLabel = MATERIALS.find((m) => m.id === f.mat)?.label ?? 'Custom';
  const sizeText = f.shape === 'round' ? `Round Bar Ø${f.d} ${f.dUnit}` : `Pipe OD ${f.od} ${f.odUnit} × ${f.pipeBy === 'wall' ? `T ${f.wall}` : `ID ${f.wall}`} ${f.wallUnit}`;
  const save = () => {
    if (!res.ok) return;
    const pcs = res.pieces > 1 ? ` · ${res.pieces} pcs` : '';
    const title = f.mode === 'length' ? `${sizeText} × ${f.length} ${f.lengthUnit} · ${matLabel}${pcs}` : `${sizeText} · ${f.weight} ${f.weightUnit} · ${matLabel}${pcs}`;
    const result =
      f.mode === 'length'
        ? `${fmt(res.totalKg)} kg${res.cost != null ? ` · ${inr(res.cost)}` : ''}`
        : `${fmt(fromCm(res.lengthCm, 'mm'), 1)} mm per piece${res.cost != null ? ` · ${inr(res.cost)}` : ''}`;
    const next = [{ id: Date.now(), at: new Date().toISOString(), title, result, form: f }, ...history].slice(0, 15);
    setHistory(next);
    storeHistory(next);
  };
  const dropSaved = (id: number) => {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    storeHistory(next);
  };

  const unitSel = <U extends string>(value: U, units: readonly U[], onChange: (u: U) => void, label: string) => (
    <select className="mw-unit" value={value} onChange={(e) => onChange(e.target.value as U)} aria-label={`${label} unit`}>
      {units.map((u) => (
        <option key={u} value={u}>{u}</option>
      ))}
    </select>
  );
  const box = (key: keyof Form & string, label: string, unit?: React.ReactNode, opts: { hint?: string; step?: string; placeholder?: string } = {}) => (
    <div className="field">
      <label>{label}</label>
      <div className="mw-row">
        <input
          type="number"
          min="0"
          step={opts.step ?? 'any'}
          inputMode="decimal"
          className={err(key) ? 'bad' : ''}
          value={f[key] as string}
          placeholder={opts.placeholder ?? '0'}
          aria-label={label}
          aria-invalid={!!err(key)}
          onChange={(e) => set(key, e.target.value as never)}
          onKeyDown={(e) => e.key === 'Enter' && setShown(true)}
        />
        {unit}
      </div>
      {err(key) ? <div className="mw-err">{err(key)}</div> : opts.hint ? <div className="mw-hint">{opts.hint}</div> : null}
    </div>
  );

  return (
    <div className="mw">
      <div className="mw-form">
        {/* material and density */}
        <div className="mw-head">
          <div className="field">
            <label>Material</label>
            <select value={f.mat} onChange={(e) => pickMaterial(e.target.value)} aria-label="Material">
              {MATERIALS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="field">
            <label>Density</label>
            <div className="mw-row">
              <input type="number" min="0" step="any" inputMode="decimal" className={err('density') ? 'bad' : ''} value={f.density} onChange={(e) => typeDensity(e.target.value)} aria-label="Density" />
              <span className="mw-suffix">gr/cm³</span>
            </div>
            {err('density') && <div className="mw-err">{err('density')}</div>}
          </div>
        </div>

        {/* shape */}
        <div className="mw-shapes2" role="radiogroup" aria-label="Shape">
          {(['round', 'pipe'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={f.shape === s} className={`mw-shape2${f.shape === s ? ' on' : ''}`} onClick={() => set('shape', s)}>
              <ShapeDiagram shape={s} pipeBy={f.pipeBy} />
              <b>{s === 'round' ? 'Round Bar' : 'Pipe / Round Tube'}</b>
            </button>
          ))}
        </div>

        {/* mode */}
        <div className="mw-modes" role="radiogroup" aria-label="Calculate">
          {(
            [
              ['length', 'By Length'],
              ['weight', 'By Weight'],
            ] as const
          ).map(([m, label]) => (
            <label key={m} className={`mw-mode${f.mode === m ? ' on' : ''}`}>
              <input type="radio" name="mw-mode" checked={f.mode === m} onChange={() => set('mode', m)} /> {label}
            </label>
          ))}
        </div>

        {/* the sizes */}
        <div className="mw-dim">
          {f.shape === 'round' ? (
            box('d', 'Diameter (D)', unitSel(f.dUnit, LEN_UNITS, (u) => set('dUnit', u), 'Diameter'))
          ) : (
            <>
              {box('od', 'Outer Diameter (OD)', unitSel(f.odUnit, LEN_UNITS, (u) => set('odUnit', u), 'Outer diameter'))}
              <div className="field">
                <label>
                  <select className="mw-inline-sel" value={f.pipeBy} onChange={(e) => set('pipeBy', e.target.value as PipeBy)} aria-label="Pipe size given as">
                    <option value="wall">Wall Thickness (T)</option>
                    <option value="id">Inner Diameter (ID)</option>
                  </select>
                </label>
                <div className="mw-row">
                  <input type="number" min="0" step="any" inputMode="decimal" className={err('wall') ? 'bad' : ''} value={f.wall} placeholder="0" aria-label={f.pipeBy === 'wall' ? 'Wall thickness' : 'Inner diameter'} onChange={(e) => set('wall', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setShown(true)} />
                  {unitSel(f.wallUnit, LEN_UNITS, (u) => set('wallUnit', u), 'Wall')}
                </div>
                {err('wall') && <div className="mw-err">{err('wall')}</div>}
              </div>
            </>
          )}
          {f.mode === 'length'
            ? box('length', 'Length', unitSel(f.lengthUnit, LEN_UNITS, (u) => set('lengthUnit', u), 'Length'))
            : box('weight', 'Weight', unitSel(f.weightUnit, WT_UNITS, (u) => set('weightUnit', u), 'Weight'), { hint: 'The total weight of all the pieces' })}
          <hr className="mw-divider" />
          {box('pieces', 'Pieces', <span className="mw-suffix">pcs</span>, { step: '1', placeholder: '1', hint: 'Optional — 1 if empty' })}
          {box('price', 'Price Per kg', <span className="mw-suffix">₹ / kg</span>, { hint: 'Optional — for the cost' })}
        </div>

        <div className="mw-actions">
          <button type="button" className="btn btn-primary" onClick={() => setShown(true)}>
            <Calculator size={15} /> CALCULATE
          </button>
          <button type="button" className="btn btn-subtle" onClick={clear}>
            <RotateCcw size={15} /> CLEAR
          </button>
          <button type="button" className="btn btn-subtle" disabled={!shown || !res.ok} onClick={save} title="Keep this result in the list below (on this device)">
            <Save size={15} /> SAVE
          </button>
        </div>
      </div>

      <div className="mw-result" aria-live="polite">
        {!shown ? (
          <div className="mw-empty">
            <div className="mw-label">{f.mode === 'length' ? 'Total weight' : 'Length per piece'}</div>
            <div className="mw-big muted">— <small>{f.mode === 'length' ? 'kg' : f.outUnit}</small></div>
            <p>Enter the sizes and press <b>CALCULATE</b>.</p>
          </div>
        ) : !res.ok ? (
          <div className="mw-empty">
            <div className="mw-big muted">— <small>{f.mode === 'length' ? 'kg' : f.outUnit}</small></div>
            <p>Check the fields marked in red.</p>
          </div>
        ) : f.mode === 'length' ? (
          <>
            <div className="mw-label">{res.pieces > 1 ? `Total weight of ${fmt(res.pieces, 0)} pieces` : 'Total weight'}</div>
            <div className="mw-big">{fmt(res.totalKg)} <small>kg</small></div>
            {res.pieces > 1 && <div className="mw-one">Each piece: <b>{fmt(res.pieceKg)} kg</b></div>}
            {res.cost != null && <div className="mw-cost">Total cost: <b>{inr(res.cost)}</b></div>}
            <dl className="mw-facts">
              <div><dt>Material</dt><dd>{matLabel} · {f.density} gr/cm³</dd></div>
              <div><dt>Cross-section area</dt><dd>{fmt(res.areaCm2, 4)} cm²</dd></div>
              <div><dt>Volume per piece</dt><dd>{fmt(res.volumeCm3, 3)} cm³</dd></div>
              <div><dt>Weight per piece</dt><dd>{fmt(res.pieceKg)} kg</dd></div>
              {res.idCm != null && <div><dt>Inner diameter</dt><dd>{fmt(res.idCm * 10, 2)} mm</dd></div>}
            </dl>
          </>
        ) : (
          <>
            <div className="mw-label">Length per piece{res.pieces > 1 ? ` (${fmt(res.pieces, 0)} pieces)` : ''}</div>
            <div className="mw-big">
              {fmt(fromCm(res.lengthCm, f.outUnit), f.outUnit === 'mm' ? 1 : 3)} <small>{f.outUnit}</small>
            </div>
            <div className="mw-alt">
              {(['mm', 'm', 'ft'] as const).filter((u) => u !== f.outUnit).map((u) => (
                <span key={u}>{fmt(fromCm(res.lengthCm, u), u === 'mm' ? 1 : 3)} {u}</span>
              ))}
              {unitSel(f.outUnit, LEN_UNITS, (u) => set('outUnit', u), 'Show length in')}
            </div>
            {res.cost != null && <div className="mw-cost">Total cost: <b>{inr(res.cost)}</b></div>}
            <dl className="mw-facts">
              <div><dt>Material</dt><dd>{matLabel} · {f.density} gr/cm³</dd></div>
              <div><dt>Total weight</dt><dd>{fmt(res.totalKg)} kg</dd></div>
              <div><dt>Weight per piece</dt><dd>{fmt(res.pieceKg)} kg</dd></div>
              <div><dt>Volume per piece</dt><dd>{fmt(res.volumeCm3, 3)} cm³</dd></div>
              <div><dt>Cross-section area</dt><dd>{fmt(res.areaCm2, 4)} cm²</dd></div>
            </dl>
          </>
        )}

        {history.length > 0 && (
          <div className="mw-history">
            <div className="mw-title" style={{ display: 'flex', alignItems: 'center' }}>
              Saved calculations
              <button type="button" className="link-btn" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => { setHistory([]); storeHistory([]); }}>
                Clear list
              </button>
            </div>
            {history.map((h) => (
              <div key={h.id} className="mw-hist-row">
                <button type="button" className="mw-hist-open" title="Open this calculation again" onClick={() => { setF({ ...BLANK, ...h.form }); setShown(true); }}>
                  <span className="t">{h.title}</span>
                  <span className="r">{h.result}</span>
                </button>
                <button type="button" className="icon-btn" aria-label="Remove from the list" onClick={() => dropSaved(h.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
