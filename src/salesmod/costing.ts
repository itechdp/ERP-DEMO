// The 14-row manufacturing cost table of one quotation product (input weight → final cost), laid out like the company's costing sheet.
// Pure rules, no screen and no database, so they can be tested alone:  npm run test:costing
//
// Where it is saved: the existing `costing` column of each quotation line (migration 38), as the list of 14 rows. Each row keeps what was
// typed (input / unit / mode) and whether an optional row was removed, next to the worked-out label, calculation text and amount. The older
// code that prints and exports a cost sheet reads label / basis / amount, so it keeps working. Nothing needs to change in the database.
import type { CostRow, QuotationLine } from './types';

export type RowKey = 'weight' | 'material' | 'forging' | 'rm' | 'rejection' | 'withRej' | 'machining' | 'withMach' | 'scrap' | 'net' | 'packing' | 'before' | 'profit' | 'final';
export type Unit = 'kg' | 'g';
/** Forging Labour: ₹ per kg (× the input weight, as on the company sheet) or a plain amount */
export type ForgingMode = 'kg' | 'amt';
/** Scrap Recovery: ₹ per kg × scrap weight in grams (as on the company sheet) or a plain amount */
export type ScrapMode = 'weight' | 'amt';

export const ROW_KEYS: RowKey[] = ['weight', 'material', 'forging', 'rm', 'rejection', 'withRej', 'machining', 'withMach', 'scrap', 'net', 'packing', 'before', 'profit', 'final'];
/** the rows that may be removed when they do not apply. Input Weight, Material and the subtotals / Final Cost can never be removed. */
export const OPTIONAL_KEYS: RowKey[] = ['forging', 'rejection', 'machining', 'scrap', 'packing', 'profit'];

/** A cost the person adds on top of the 14 rows (Surface Treatment, Extra Charge ...). It is added to the Final Cost as a flat amount, after the profit. */
export interface CustomCost { name: string; amount: number | null }
/** the most custom cost rows one product can have */
export const MAX_CUSTOM = 20;

export interface CostingState {
  weight: number | null;
  unit: Unit;
  matRate: number | null; // ₹ per kg
  forging: number | null; // ₹ per kg or an amount, see forgingMode
  forgingMode: ForgingMode;
  rejPct: number | null;
  machining: number | null;
  scrap: number | null; // the amount, when scrapMode is 'amt'
  scrapMode: ScrapMode;
  scrapRate: number | null; // ₹ per kg, when scrapMode is 'weight'
  scrapG: number | null; // grams, when scrapMode is 'weight'
  packing: number | null;
  profitPct: number | null;
  removed: RowKey[];
  /** the added cost rows, in the order they were added */
  custom: CustomCost[];
}

/** rejection 2 % and profit 5 % are the usual starting values (same as the older cost sheet); both can be changed or removed */
export const emptyCosting = (): CostingState => ({
  weight: null, unit: 'kg', matRate: null, forging: null, forgingMode: 'kg', rejPct: 2, machining: null,
  scrap: null, scrapMode: 'weight', scrapRate: null, scrapG: null, packing: null, profitPct: 5, removed: [], custom: [],
});

/**
 * 2 decimals (half a paisa rounds up), so the printed rows add up exactly. The value is cleaned of binary noise first:
 * 30.575 is stored as 30.57499999…, which would otherwise round down.
 */
export const r2 = (v: number) => (v < 0 ? -1 : 1) * (Math.round(Number((Math.abs(v) * 100).toPrecision(14))) / 100);
const pos = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || v < 0 ? 0 : v);
const g = (v: number) => Number(v.toLocaleString('en-IN', { maximumFractionDigits: 4, useGrouping: false }));
/** 607.5 → "607.50", the way amounts appear in the calculation column */
const f2 = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg3 = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });

export interface ComputedRow {
  /** one of the 14 rows, or 'custom' for an added cost row */
  key: RowKey | 'custom';
  /** for a custom row: its place in the custom list (0, 1, 2 ...) */
  index?: number;
  no: number;
  label: string;
  /** the calculation, with the numbers in it, e.g. "607.50 + 12.15" */
  basis: string;
  /** null for the weight row */
  amount: number | null;
  removed: boolean;
  /** a subtotal or the final cost: read-only, highlighted */
  strong: boolean;
}

export const weightKg = (s: CostingState) => (s.unit === 'g' ? pos(s.weight) / 1000 : pos(s.weight));

/** the Scrap Recovery amount as typed (before the removed check) */
const scrapAmount = (s: CostingState) => (s.scrapMode === 'weight' ? r2((pos(s.scrapRate) * pos(s.scrapG)) / 1000) : r2(pos(s.scrap)));
const forgingAmount = (s: CostingState) => (s.forgingMode === 'kg' ? r2(pos(s.forging) * weightKg(s)) : r2(pos(s.forging)));

export function computeCosting(s: CostingState): { rows: ComputedRow[]; final: number; kg: number; customTotal: number; unitCost: number } {
  const gone = new Set(s.removed.filter((k) => OPTIONAL_KEYS.includes(k)));
  const kg = weightKg(s);
  const material = r2(kg * pos(s.matRate));
  const forging = gone.has('forging') ? 0 : forgingAmount(s);
  const rm = r2(material + forging);
  const rej = gone.has('rejection') ? 0 : r2((rm * pos(s.rejPct)) / 100);
  const withRej = r2(rm + rej);
  const mach = gone.has('machining') ? 0 : r2(pos(s.machining));
  const withMach = r2(withRej + mach);
  const scrap = gone.has('scrap') ? 0 : scrapAmount(s);
  const net = r2(withMach - scrap);
  const pack = gone.has('packing') ? 0 : r2(pos(s.packing));
  const before = r2(net + pack);
  const profit = gone.has('profit') ? 0 : r2((before * pos(s.profitPct)) / 100);
  // the added cost rows come after the profit: each one adds exactly its amount to the Final Cost
  const customAmounts = (s.custom ?? []).map((c) => r2(pos(c.amount)));
  const customTotal = r2(customAmounts.reduce((t, v) => t + v, 0));
  const final = r2(before + profit + customTotal);

  // "607.50 + 12.15": the calculation column shows the numbers, like the company sheet. A removed row is left out of the sentence.
  const plus = (a: number, b: number, bKey: RowKey) => (gone.has(bKey) ? f2(a) : `${f2(a)} + ${f2(b)}`);
  const row = (no: number, key: RowKey, label: string, basis: string, amount: number | null, strong = false): ComputedRow => ({ key, no, label, basis, amount, removed: gone.has(key), strong });
  const scrapLabel = s.scrapMode === 'weight' && !gone.has('scrap') ? `Scrap Recovery ${g(pos(s.scrapRate))} X ${g(pos(s.scrapG))}` : 'Scrap Recovery';
  // the Final Cost calculation as numbers: 542.65 + 27.13, and + 500.00 when cost rows were added; a removed Profit row is left out
  const finalBasis = [f2(before), ...(gone.has('profit') ? [] : [f2(profit)]), ...((s.custom ?? []).length ? [f2(customTotal)] : [])].join(' + ');
  const rows: ComputedRow[] = [
    row(1, 'weight', 'Input Weight', s.unit === 'g' ? `${g(pos(s.weight))} g = ${kg3(kg)} kg` : `${kg3(kg)} kg`, null),
    row(2, 'material', 'Material', `${g(pos(s.matRate))} × ${kg3(kg)} kg`, material),
    row(3, 'forging', 'Forging Labour', s.forgingMode === 'kg' ? `${g(pos(s.forging))} × ${kg3(kg)} kg` : '—', forging),
    row(4, 'rm', 'RM with Forging Cost', plus(material, forging, 'forging'), rm, true),
    row(5, 'rejection', `Rejection @ ${g(pos(s.rejPct))}%`, `${f2(rm)} × ${g(pos(s.rejPct))}%`, rej),
    row(6, 'withRej', 'Cost with Rejection', plus(rm, rej, 'rejection'), withRej, true),
    row(7, 'machining', 'Machining', '—', mach),
    row(8, 'withMach', 'Cost with Machining', plus(withRej, mach, 'machining'), withMach, true),
    row(9, 'scrap', scrapLabel, 'Less: Scrap Value', -scrap),
    row(10, 'net', 'Net Cost', gone.has('scrap') ? f2(withMach) : `${f2(withMach)} − ${f2(scrap)}`, net, true),
    row(11, 'packing', 'Packing & Forwarding', '—', pack),
    row(12, 'before', 'Cost Before Profit', plus(net, pack, 'packing'), before, true),
    row(13, 'profit', `Profit @ ${g(pos(s.profitPct))}%`, `${f2(before)} × ${g(pos(s.profitPct))}%`, profit),
    ...(s.custom ?? []).map((c, i): ComputedRow => ({ key: 'custom', index: i, no: 14 + i, label: c.name.trim() || 'Custom cost', basis: 'Added cost', amount: customAmounts[i], removed: false, strong: false })),
    row(14 + (s.custom ?? []).length, 'final', 'Final Cost', finalBasis, final, true),
  ];
  return { rows, final, kg, customTotal, unitCost: r2(before + customTotal) };
}

// ------------------------------------------------------------------ checking what was typed
export type CostingErrors = Partial<Record<RowKey, string>>;

const bad = (v: number | null) => v != null && (!Number.isFinite(v) || v < 0);

/** values that are wrong whatever else is filled in (negative, a percentage over 100, scrap worth more than the cost) */
export function costingErrors(s: CostingState): CostingErrors {
  const e: CostingErrors = {};
  const gone = new Set(s.removed);
  if (bad(s.weight)) e.weight = 'Cannot be negative.';
  if (bad(s.matRate)) e.material = 'Cannot be negative.';
  if (!gone.has('forging') && bad(s.forging)) e.forging = 'Cannot be negative.';
  if (!gone.has('machining') && bad(s.machining)) e.machining = 'Cannot be negative.';
  if (!gone.has('packing') && bad(s.packing)) e.packing = 'Cannot be negative.';
  if (!gone.has('scrap') && (s.scrapMode === 'weight' ? bad(s.scrapRate) || bad(s.scrapG) : bad(s.scrap))) e.scrap = 'Cannot be negative.';
  if (!gone.has('rejection') && s.rejPct != null && (bad(s.rejPct) || s.rejPct > 100)) e.rejection = 'Enter 0 to 100 %.';
  if (!gone.has('profit') && s.profitPct != null && (bad(s.profitPct) || s.profitPct > 100)) e.profit = 'Enter 0 to 100 %.';
  if (!e.scrap && !gone.has('scrap') && scrapAmount(s) > 0) {
    const withMach = computeCosting(s).rows.find((r) => r.key === 'withMach')?.amount ?? 0;
    if (scrapAmount(s) > withMach) e.scrap = 'Scrap recovery is more than the cost.';
  }
  return e;
}

/** what must still be entered before the quotation can be saved */
export function costingMissing(s: CostingState): CostingErrors {
  const e: CostingErrors = {};
  if (!(pos(s.weight) > 0)) e.weight = 'Enter the input weight.';
  if (!(pos(s.matRate) > 0)) e.material = 'Enter the material rate.';
  return e;
}

/**
 * What is wrong with each added cost row (same order as `custom`), or '' for a row that is fine.
 * A row needs BOTH a name and an amount (0 or more); a row left completely empty is fine (it is dropped when the quotation is saved).
 */
export function customProblems(s: CostingState): string[] {
  return (s.custom ?? []).map((c) => {
    if (bad(c.amount)) return 'Cannot be negative.';
    const hasName = c.name.trim() !== '';
    if (hasName && c.amount == null) return 'Enter the amount.';
    if (!hasName && c.amount != null) return 'Enter the cost name.';
    return '';
  });
}

/** the first problem of this table in words, or '' when it can be saved */
export function costingProblem(s: CostingState): string {
  const all = { ...costingMissing(s), ...costingErrors(s) };
  const k = ROW_KEYS.find((x) => all[x]);
  const rows = computeCosting(s).rows;
  if (k) return `${ROW_KEYS.indexOf(k) + 1}. ${rows.find((r) => r.key === k)?.label ?? k}: ${all[k]}`;
  const cp = customProblems(s);
  const i = cp.findIndex((m) => m !== '');
  return i >= 0 ? `${14 + i}. ${s.custom[i].name.trim() || 'Added cost'}: ${cp[i]}` : '';
}

/** the table without the added cost rows that were left completely empty (what gets saved) */
export const dropBlankCustom = (s: CostingState): CostingState => ({ ...s, custom: (s.custom ?? []).filter((c) => c.name.trim() !== '' || c.amount != null) });

// ------------------------------------------------------------------ saving and reading
/** the 14 rows as they are stored (and printed): worked-out text and amount, plus what was typed */
export function serializeCosting(s: CostingState): CostRow[] {
  const { rows } = computeCosting(s);
  const gone = new Set<string>(s.removed.filter((k) => OPTIONAL_KEYS.includes(k)));
  const typed: Partial<Record<RowKey | 'custom', number | null>> = {
    weight: s.weight, material: s.matRate, forging: s.forging, rejection: s.rejPct, machining: s.machining,
    scrap: s.scrapRate, packing: s.packing, profit: s.profitPct,
  };
  return rows.map((r): CostRow => {
    if (r.key === 'custom') {
      // an added cost row keeps its typed name (even blank) and amount, and its place in the list; it is numbered 14, 15 ... (the Final Cost follows)
      const c = s.custom[r.index ?? 0];
      return { label: r.label, basis: r.basis, amount: r.amount, bold: false, key: 'custom', no: r.no, sub: (r.index ?? 0) + 1, input: c.amount, name: c.name };
    }
    return {
    label: r.label,
    basis: r.basis,
    amount: gone.has(r.key) ? null : r.amount,
    bold: r.strong,
    key: r.key,
    no: r.no,
    input: typed[r.key] ?? null,
    ...(r.key === 'weight' ? { unit: s.unit } : {}),
    ...(r.key === 'forging' ? { mode: s.forgingMode } : {}),
    ...(r.key === 'scrap' ? { mode: s.scrapMode, input2: s.scrapG, input3: s.scrap } : {}),
    ...(gone.has(r.key) ? { removed: true } : {}),
    };
  });
}

/**
 * The saved rows back into the table, or null when this is an older free-form cost sheet (or none).
 * A row saved without a mode (by the first version of this table) was a plain amount, so it opens as an amount.
 */
export function parseCosting(rows: CostRow[] | null | undefined): CostingState | null {
  if (!rows?.length || !rows.every((r) => typeof r.key === 'string' && (r.key === 'custom' || ROW_KEYS.includes(r.key as RowKey)))) return null;
  const by = (k: RowKey) => rows.find((r) => r.key === k);
  const val = (k: RowKey) => {
    const v = by(k)?.input;
    return v == null || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const num = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const sc = by('scrap');
  // a scrap row with a mode keeps all three typed values: rate (input), grams (input2) and amount (input3).
  // One without a mode (saved by the first version of this table) held just the amount in `input`.
  const hasMode = sc?.mode === 'weight' || sc?.mode === 'amt';
  return {
    weight: val('weight'),
    unit: by('weight')?.unit === 'g' ? 'g' : 'kg',
    matRate: val('material'),
    forging: val('forging'),
    forgingMode: by('forging')?.mode === 'kg' ? 'kg' : 'amt',
    rejPct: val('rejection'),
    machining: val('machining'),
    scrap: hasMode ? num(sc?.input3) : val('scrap'),
    scrapMode: sc?.mode === 'weight' ? 'weight' : 'amt',
    scrapRate: hasMode ? val('scrap') : null,
    scrapG: hasMode ? num(sc?.input2) : null,
    packing: val('packing'),
    profitPct: val('profit'),
    removed: OPTIONAL_KEYS.filter((k) => by(k)?.removed),
    // the added cost rows, in their saved order (a table saved before they existed simply has none)
    custom: rows
      .filter((r) => r.key === 'custom')
      .sort((a, b) => (a.sub ?? 0) - (b.sub ?? 0))
      .map((r) => ({ name: typeof r.name === 'string' ? r.name : r.label === 'Custom cost' ? '' : r.label, amount: num(r.input) })),
  };
}

/** a product priced with the 14-row table (older quotations are not) */
export const isCosted = (l: Pick<QuotationLine, 'costing'>) => parseCosting(l.costing) !== null;

/** the line's Final Cost per piece, or null for a product that is not priced with the table */
export function finalCostOf(l: Pick<QuotationLine, 'costing'>): number | null {
  const s = parseCosting(l.costing);
  return s ? computeCosting(s).final : null;
}

/**
 * The cost of one piece before profit (row 12). It is saved as the product's cost, so the quotation approval can work out the margin as it
 * always did: margin = (Final Cost − this) ÷ Final Cost.
 */
export const costBeforeProfit = (s: CostingState) => computeCosting(s).rows.find((r) => r.key === 'before')?.amount ?? 0;

/**
 * The cost of one piece that is saved as the product's cost: Cost Before Profit (row 12) plus any added cost rows. Added costs are real costs,
 * not profit, so the margin the approval works out stays honest: margin = (Final Cost - this) / Final Cost.
 */
export const unitCostOf = (s: CostingState) => computeCosting(s).unitCost;

/**
 * The row number to print. Rows 1 to 13 keep their fixed numbers; the added cost rows follow as 14, 15 ... and the Final Cost comes last (14, or 15 with
 * one added row, 16 with two ...). It is worked out from the rows being printed, so a table saved with older numbers still prints in sequence.
 */
export const rowNo = (r: Pick<CostRow, 'key' | 'no' | 'sub'>, i: number, all: Pick<CostRow, 'key'>[] = []): string => {
  if (r.key === 'custom') return String(13 + (r.sub ?? 1));
  if (r.key === 'final') return String(14 + all.filter((x) => x.key === 'custom').length);
  return String(r.no ?? i + 1);
};

/** the rows to show on a printout / sheet: removed rows are left out */
export const printableRows = (rows: CostRow[]) => rows.filter((r) => !r.removed);
