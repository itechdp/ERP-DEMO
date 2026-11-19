import { Fragment } from 'react';
import { Lock, Plus, RotateCcw, X } from 'lucide-react';
import { MAX_CUSTOM, OPTIONAL_KEYS, computeCosting, costingErrors, costingMissing, customProblems, type CostingState, type ForgingMode, type RowKey, type ScrapMode, type Unit } from './costing';

const money = (v: number | null) => (v == null ? '' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const signed = (v: number | null) => (v == null ? '' : v < 0 ? `− ${money(-v)}` : money(v));

/**
 * The 14-row cost table of one product, shown vertically: No. · Cost description · Calculation / input · Amount.
 * Inputs are the white boxes; subtotal rows are calculated and read-only; Final Cost is highlighted.
 * Optional rows (forging, rejection, machining, scrap, packing, profit) can be removed and restored; Input Weight, Material and Final Cost cannot.
 * `readOnly` is the same table without any input (the quotation page).
 */
export function CostingTable({ state, onChange, readOnly = false, showMissing = false }: { state: CostingState; onChange?: (s: CostingState) => void; readOnly?: boolean; showMissing?: boolean }) {
  const { rows, kg } = computeCosting(state);
  const errors = costingErrors(state);
  const missing = showMissing ? costingMissing(state) : {};
  const err = (k: RowKey) => errors[k] ?? missing[k];
  const gone = new Set(state.removed);
  const cProblems = customProblems(state);
  const set = (patch: Partial<CostingState>) => onChange?.({ ...state, ...patch });
  const num = (v: string) => (v === '' ? null : Number(v));
  const setCustom = (i: number, patch: Partial<{ name: string; amount: number | null }>) => set({ custom: state.custom.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const addCustom = () => set({ custom: [...state.custom, { name: '', amount: null }] });
  const removeCustom = (i: number) => set({ custom: state.custom.filter((_, j) => j !== i) });
  const remove = (k: RowKey) => set({ removed: [...state.removed.filter((x) => x !== k), k] });
  const restore = (k: RowKey) => set({ removed: state.removed.filter((x) => x !== k) });

  const box = (k: RowKey, value: number | null, apply: (v: number | null) => void, label: string, suffix?: string, placeholder = '0') => (
    <div className="ct-input">
      <input type="number" min="0" step="any" inputMode="decimal" className={`right mono ${err(k) ? 'bad' : ''}`} value={value ?? ''} placeholder={placeholder} aria-label={label} aria-invalid={!!err(k)} onChange={(e) => apply(num(e.target.value))} />
      {suffix && <span className="ct-suffix">{suffix}</span>}
    </div>
  );

  return (
    <div className="ct" role="table" aria-label="Costing">
      <div className="ct-head" role="row">
        <span role="columnheader">No.</span>
        <span role="columnheader">Cost description</span>
        <span role="columnheader">Calculation / input</span>
        <span role="columnheader" className="r">Amount (₹)</span>
        <span />
      </div>
      {rows.map((r) => {
        if (r.key === 'custom') {
          const i = r.index ?? 0;
          const c = state.custom[i];
          // a negative amount is shown at once; "enter the name / amount" only after a save was tried
          const problem = cProblems[i] && (cProblems[i] === 'Cannot be negative.' || showMissing) ? cProblems[i] : '';
          const blank = c.name === '' && c.amount == null;
          return (
            <div className="ct-row custom" role="row" key={`custom-${i}`}>
              <span className="ct-no" role="cell">{r.no}</span>
              <span className="ct-desc" role="cell">
                {readOnly ? (
                  r.label
                ) : (
                  <input className={`ct-name${problem && !c.name.trim() ? ' bad' : ''}`} value={c.name} maxLength={60} placeholder="Cost name, e.g. Surface Treatment" aria-label={`Cost name ${i + 1}`} autoFocus={blank && i === state.custom.length - 1} onChange={(e) => setCustom(i, { name: e.target.value })} />
                )}
                {problem && <span className="ct-err">{problem}</span>}
              </span>
              <span className="ct-calc" role="cell">
                {readOnly ? (
                  <span className="ct-basis">Added cost</span>
                ) : (
                  <div className="ct-input">
                    <input type="number" min="0" step="any" inputMode="decimal" className={`right mono ${cProblems[i] === 'Cannot be negative.' || (showMissing && cProblems[i] === 'Enter the amount.') ? 'bad' : ''}`} value={c.amount ?? ''} placeholder="0" aria-label={`Cost amount ${i + 1}`} onChange={(e) => setCustom(i, { amount: num(e.target.value) })} />
                    <span className="ct-suffix">₹</span>
                  </div>
                )}
              </span>
              <span className="ct-amt mono" role="cell">{signed(r.amount)}</span>
              <span className="ct-act" role="cell">
                {!readOnly && <button type="button" className="icon-btn" title="Delete this cost row" aria-label={`Delete cost row ${i + 1}`} onClick={() => removeCustom(i)}><X size={15} /></button>}
              </span>
            </div>
          );
        }
        const optional = OPTIONAL_KEYS.includes(r.key);
        const removed = r.removed;
        const cls = `ct-row${r.strong ? ' strong' : ''}${r.key === 'final' ? ' final' : ''}${removed ? ' gone' : ''}`;
        let input: React.ReactNode = <span className="ct-basis">{r.basis}</span>;
        if (!readOnly && !removed) {
          if (r.key === 'weight') {
            input = (
              <div className="ct-input">
                {box('weight', state.weight, (v) => set({ weight: v }), 'Input weight', undefined, '0.000')}
                <select value={state.unit} onChange={(e) => set({ unit: e.target.value as Unit })} aria-label="Weight unit" className="ct-unit">
                  <option value="kg">KG</option>
                  <option value="g">grams</option>
                </select>
              </div>
            );
          } else if (r.key === 'material')
            input = (
              <div className="ct-input ct-wrap">
                {box('material', state.matRate, (v) => set({ matRate: v }), 'Material rate per kg', '₹ / kg')}
                <span className="ct-x" title="the input weight in kg">× {kg.toFixed(3)} kg</span>
              </div>
            );
          else if (r.key === 'forging')
            input = (
              <div className="ct-input ct-wrap">
                {box('forging', state.forging, (v) => set({ forging: v }), 'Forging labour', state.forgingMode === 'kg' ? '₹ / kg' : '₹')}
                {state.forgingMode === 'kg' && <span className="ct-x" title="the input weight in kg">× {kg.toFixed(3)} kg</span>}
                <select value={state.forgingMode} onChange={(e) => set({ forgingMode: e.target.value as ForgingMode })} aria-label="Forging labour basis" className="ct-unit" title="Enter it per kg of the input weight, or as one amount">
                  <option value="kg">per kg</option>
                  <option value="amt">amount</option>
                </select>
              </div>
            );
          else if (r.key === 'rejection') input = box('rejection', state.rejPct, (v) => set({ rejPct: v }), 'Rejection percentage', '%', '2');
          else if (r.key === 'machining') input = box('machining', state.machining, (v) => set({ machining: v }), 'Machining amount', '₹');
          else if (r.key === 'scrap')
            input = (
              <div className="ct-input ct-wrap">
                {state.scrapMode === 'weight' ? (
                  <>
                    {box('scrap', state.scrapRate, (v) => set({ scrapRate: v }), 'Scrap rate per kg', '₹ / kg')}
                    <span className="ct-x">×</span>
                    <div className="ct-input">
                      <input type="number" min="0" step="any" inputMode="decimal" className={`right mono ${err('scrap') ? 'bad' : ''}`} value={state.scrapG ?? ''} placeholder="0" aria-label="Scrap weight in grams" aria-invalid={!!err('scrap')} onChange={(e) => set({ scrapG: num(e.target.value) })} />
                      <span className="ct-suffix">g</span>
                    </div>
                  </>
                ) : (
                  box('scrap', state.scrap, (v) => set({ scrap: v }), 'Scrap recovery amount', '₹ less')
                )}
                <select value={state.scrapMode} onChange={(e) => set({ scrapMode: e.target.value as ScrapMode })} aria-label="Scrap recovery basis" className="ct-unit" title="Enter it as rate × scrap weight, or as one amount">
                  <option value="weight">rate × weight</option>
                  <option value="amt">amount</option>
                </select>
              </div>
            );
          else if (r.key === 'packing') input = box('packing', state.packing, (v) => set({ packing: v }), 'Packing and forwarding amount', '₹');
          else if (r.key === 'profit') input = box('profit', state.profitPct, (v) => set({ profitPct: v }), 'Profit percentage', '%', '5');
        } else if (readOnly && !removed && r.key !== 'weight' && r.key !== 'material' && !r.strong) {
          input = <span className="ct-basis">{r.key === 'rejection' || r.key === 'profit' ? r.basis : r.basis}</span>;
        }
        const shownAmount = r.key === 'weight' ? `${kg.toLocaleString('en-IN', { maximumFractionDigits: 4 })} kg` : signed(r.amount);
        return (
          <Fragment key={r.key}>
          {r.key === 'final' && !readOnly && (
            <div className="ct-add" role="row">
              <button type="button" className="btn btn-sm btn-soft" onClick={addCustom} disabled={state.custom.length >= MAX_CUSTOM}><Plus size={14} /> Add Cost Row</button>
              <span className="muted">{state.custom.length >= MAX_CUSTOM ? `Up to ${MAX_CUSTOM} added rows.` : 'Adds a cost on top of the profit, e.g. Surface Treatment or an Extra Charge. It goes straight into the Final Cost.'}</span>
            </div>
          )}
          <div className={cls} role="row">
            <span className="ct-no" role="cell">{r.no}</span>
            <span className="ct-desc" role="cell">
              {r.label}
              {removed && <em className="ct-chip">Removed</em>}
              {err(r.key) && !removed && <span className="ct-err">{err(r.key)}</span>}
            </span>
            <span className="ct-calc" role="cell">{removed ? <span className="ct-basis">Not included in the cost</span> : input}</span>
            <span className="ct-amt mono" role="cell">{removed ? '—' : shownAmount}</span>
            <span className="ct-act" role="cell">
              {!readOnly && optional && !removed && (
                <button type="button" className="icon-btn" title={`Remove ${r.label} (it will not be counted)`} aria-label={`Remove ${r.label}`} onClick={() => remove(r.key as RowKey)}><X size={15} /></button>
              )}
              {!readOnly && optional && removed && (
                <button type="button" className="btn btn-sm btn-subtle" title={`Restore ${r.label}`} onClick={() => restore(r.key as RowKey)}><RotateCcw size={13} /> Restore</button>
              )}
              {!readOnly && !optional && !r.strong && <Lock size={13} className="muted" aria-label="Always included" />}
            </span>
          </div>
          </Fragment>
        );
      })}
      {!readOnly && gone.size > 0 && <div className="ct-foot muted">{gone.size} optional row{gone.size === 1 ? '' : 's'} removed: {rows.filter((r) => r.removed).map((r) => r.label.replace(/ @.*/, '')).join(', ')}. Use Restore to bring {gone.size === 1 ? 'it' : 'them'} back.</div>}
    </div>
  );
}
