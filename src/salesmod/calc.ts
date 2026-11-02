import type { CostRow, QuotationLine } from './types';

const n = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? null : v);

/** Same arithmetic as the database: net rate = rate − discount; margin % = (net − cost) ÷ net × 100 (on the selling price). */
export function lineCalc(l: QuotationLine) {
  const rate = n(l.rate) ?? 0;
  const net = rate * (1 - (n(l.discountPct) ?? 0) / 100);
  const qty = n(l.qty) ?? 0;
  const unitCost = l.materialCost == null ? null : l.materialCost + (l.processingCost ?? 0) + (l.otherCost ?? 0);
  return {
    net,
    amount: net * qty,
    unitCost,
    cost: unitCost == null ? null : unitCost * qty,
    marginPct: unitCost == null || net <= 0 ? null : ((net - unitCost) / net) * 100,
  };
}

export function totalsCalc(lines: QuotationLine[]) {
  let amount = 0;
  let cost = 0;
  let full = lines.length > 0;
  let discount = 0;
  for (const l of lines) {
    const c = lineCalc(l);
    amount += c.amount;
    discount += (n(l.qty) ?? 0) * (n(l.rate) ?? 0) - c.amount;
    if (c.cost == null) full = false;
    else cost += c.cost;
  }
  return { amount, discount, cost: full ? cost : null, profit: full ? amount - cost : null, marginPct: full && amount > 0 ? ((amount - cost) / amount) * 100 : null };
}

export const inr = (v: number | null | undefined, d = 2) => (v == null ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: d }));
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`);

/** a date n days from today, as yyyy-mm-dd */
export const plusDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- cost sheet
export interface CostSheetInput {
  weightG: number; // input weight per piece, grams
  matRate: number; // material ₹ / kg
  forgeRate: number; // forging labour ₹ / kg
  rejPct: number;
  machining: number;
  scrapRate: number; // ₹ / kg
  scrapG: number; // scrap per piece, grams
  packing: number;
  profitPct: number;
}
export const EMPTY_COST_INPUT: CostSheetInput = { weightG: 0, matRate: 0, forgeRate: 0, rejPct: 2, machining: 0, scrapRate: 0, scrapG: 0, packing: 0, profitPct: 5 };

const r2 = (v: number) => Math.round(v * 100) / 100;
const g = (v: number) => Number(v.toLocaleString('en-IN', { maximumFractionDigits: 3, useGrouping: false }));

/** The standard 14-step cost sheet (input weight → final cost). The user can edit, add, delete and move every row afterwards. */
export function buildCostRows(i: CostSheetInput): CostRow[] {
  const kg = i.weightG / 1000;
  const mat = r2(i.matRate * kg);
  const forge = r2(i.forgeRate * kg);
  const rm = r2(mat + forge);
  const rej = r2((rm * i.rejPct) / 100);
  const withRej = r2(rm + rej);
  const withMach = r2(withRej + i.machining);
  const scrap = r2(i.scrapRate * (i.scrapG / 1000));
  const net = r2(withMach - scrap);
  const before = r2(net + i.packing);
  const profit = r2((before * i.profitPct) / 100);
  return [
    { label: 'Input Weight', basis: `${g(i.weightG)} grams`, amount: null },
    { label: 'Material', basis: `${g(i.matRate)} × ${g(kg)} kg`, amount: mat },
    { label: 'Forging Labour', basis: `${g(i.forgeRate)} × ${g(kg)} kg`, amount: forge },
    { label: 'RM with Forging Cost', basis: `${mat} + ${forge}`, amount: rm, bold: true },
    { label: `Rejection @ ${g(i.rejPct)}%`, basis: `${rm} × ${g(i.rejPct)}%`, amount: rej },
    { label: 'Cost with Rejection', basis: `${rm} + ${rej}`, amount: withRej, bold: true },
    { label: 'Machining', basis: '—', amount: r2(i.machining) },
    { label: 'Cost with Machining', basis: `${withRej} + ${r2(i.machining)}`, amount: withMach, bold: true },
    { label: `Scrap Recovery ${g(i.scrapRate)} X ${g(i.scrapG)} g`, basis: 'Less: Scrap Value', amount: -scrap },
    { label: 'Net Cost', basis: `${withMach} − ${scrap}`, amount: net, bold: true },
    { label: 'Packing & Forwarding', basis: '—', amount: r2(i.packing) },
    { label: 'Cost Before Profit', basis: `${net} + ${r2(i.packing)}`, amount: before, bold: true },
    { label: `Profit @ ${g(i.profitPct)}%`, basis: `${before} × ${g(i.profitPct)}%`, amount: profit },
    { label: 'Final Cost', basis: '-', amount: r2(before + profit), bold: true },
  ];
}
