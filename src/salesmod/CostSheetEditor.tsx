import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { EMPTY_COST_INPUT, buildCostRows, type CostSheetInput } from './calc';
import type { CostRow } from './types';

const numOrNull = (v: string) => (v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * The editable cost sheet of one quotation line. "Fill the sheet" works the standard steps out from a few inputs;
 * after that every row can be edited, added, deleted and moved — the Sr. No. always follows the order on screen.
 * It is printed / exported only when the user asks for the detailed quotation.
 */
export function CostSheetEditor({ rows, onChange, onUseRate }: { rows: CostRow[]; onChange: (r: CostRow[]) => void; onUseRate?: (amount: number) => void }) {
  const [inp, setInp] = useState<CostSheetInput>(EMPTY_COST_INPUT);
  const setI = (k: keyof CostSheetInput, v: string) => setInp((x) => ({ ...x, [k]: Number(v) || 0 }));
  const setRow = (i: number, patch: Partial<CostRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const last = [...rows].reverse().find((r) => r.amount != null);
  const f = (k: keyof CostSheetInput, label: string) => (
    <label className="field" style={{ margin: 0 }}>
      <span className="text-xs muted">{label}</span>
      <input type="number" min="0" step="any" className="right mono" value={inp[k] || ''} onChange={(e) => setI(k, e.target.value)} />
    </label>
  );

  return (
    <div style={{ padding: 12, background: 'var(--surface-2, #f8fafc)', borderRadius: 8 }}>
      <div className="text-xs muted" style={{ marginBottom: 8 }}>
        Cost sheet for the <b>detailed</b> quotation. Fill the steps from a few inputs, then edit any row. Rows are numbered by their order.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 10 }}>
        {f('weightG', 'Input weight (g)')}
        {f('matRate', 'Material ₹ / kg')}
        {f('forgeRate', 'Forging labour ₹ / kg')}
        {f('rejPct', 'Rejection %')}
        {f('machining', 'Machining ₹')}
        {f('scrapRate', 'Scrap ₹ / kg')}
        {f('scrapG', 'Scrap weight (g)')}
        {f('packing', 'Packing & fwd ₹')}
        {f('profitPct', 'Profit %')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-subtle" onClick={() => onChange(buildCostRows(inp))}>
          <Wand2 size={14} /> {rows.length ? 'Re-fill the sheet (replaces the rows)' : 'Fill the sheet'}
        </button>
        <button type="button" className="btn btn-sm btn-subtle" onClick={() => onChange([...rows, { label: '', basis: '', amount: null }])}>
          <Plus size={14} /> Add row
        </button>
        {onUseRate && last?.amount != null && (
          <button type="button" className="btn btn-sm btn-subtle" onClick={() => onUseRate(last.amount as number)}>
            Use {last.amount} as the rate
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <table className="tbl form-tbl" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 40 }}>Sr.</th>
              <th>Description</th>
              <th style={{ width: 200 }}>Calculation</th>
              <th className="right" style={{ width: 110 }}>Amount</th>
              <th style={{ width: 50 }}>Bold</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="mono muted">{i + 1}</td>
                <td><input value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} /></td>
                <td><input value={r.basis} onChange={(e) => setRow(i, { basis: e.target.value })} /></td>
                <td><input type="number" step="any" className="right mono" value={r.amount ?? ''} onChange={(e) => setRow(i, { amount: numOrNull(e.target.value) })} /></td>
                <td className="center"><input type="checkbox" checked={!!r.bold} onChange={(e) => setRow(i, { bold: e.target.checked })} /></td>
                <td className="act">
                  <button type="button" className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
                  <button type="button" className="icon-btn" title="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
                  <button type="button" className="icon-btn text-red" title="Delete row" onClick={() => onChange(rows.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
