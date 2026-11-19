// Metal Weight Calculator: weight = cross-section area × length × density. Standard geometry, nothing else.
// Pure rules (no screen, no database) so they can be tested alone:  npm run test:metalweight
//
// Units inside: sizes in millimetres, density in g/cm³.  1 cm³ of a metal of density ρ weighs ρ grams, so
//   volume (cm³) = area (mm²) × length (mm) ÷ 1000        weight (kg) = volume (cm³) × ρ ÷ 1000

export type ShapeId = 'round' | 'square' | 'hex' | 'flat' | 'roundTube' | 'rectTube';
export type LenUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';

/** millimetres in one of each unit */
export const LEN_UNITS: { id: LenUnit; label: string; mm: number }[] = [
  { id: 'mm', label: 'mm', mm: 1 },
  { id: 'cm', label: 'cm', mm: 10 },
  { id: 'm', label: 'metres', mm: 1000 },
  { id: 'in', label: 'inches', mm: 25.4 },
  { id: 'ft', label: 'feet', mm: 304.8 },
];
export const toMm = (v: number, u: LenUnit) => v * (LEN_UNITS.find((x) => x.id === u)?.mm ?? 1);

export const LB_PER_KG = 2.20462262185;

export interface FieldDef { key: string; label: string; hint?: string }
export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** one-line description for the picker */
  note: string;
  /** the size fields (all in the "size unit"); the length is separate */
  fields: FieldDef[];
  /** the formula in words, shown to the user */
  formula: string;
  /** cross-section area in mm², from sizes in mm */
  area: (d: Record<string, number>) => number;
  /** problems in the combination of sizes (each is a field key + message) */
  check?: (d: Record<string, number>) => { key: string; message: string }[];
}

export const SHAPES: ShapeDef[] = [
  {
    id: 'round', label: 'Round bar', note: 'Solid round bar / rod / shaft',
    fields: [{ key: 'd', label: 'Diameter (OD)' }],
    formula: 'π ÷ 4 × Diameter² × Length × Density',
    area: (d) => (Math.PI / 4) * d.d ** 2,
  },
  {
    id: 'square', label: 'Square bar', note: 'Solid square bar',
    fields: [{ key: 'a', label: 'Side' }],
    formula: 'Side² × Length × Density',
    area: (d) => d.a ** 2,
  },
  {
    id: 'hex', label: 'Hexagon bar', note: 'Hex bar, size across flats',
    fields: [{ key: 'af', label: 'Across flats (A/F)', hint: 'the distance between two parallel flat sides' }],
    formula: '(√3 ÷ 2) × AcrossFlats² × Length × Density',
    area: (d) => (Math.sqrt(3) / 2) * d.af ** 2,
  },
  {
    id: 'flat', label: 'Flat bar / Plate', note: 'Flat, strip, sheet or plate',
    fields: [{ key: 'w', label: 'Width' }, { key: 't', label: 'Thickness' }],
    formula: 'Width × Thickness × Length × Density',
    area: (d) => d.w * d.t,
  },
  {
    id: 'roundTube', label: 'Round tube / Pipe', note: 'Hollow round tube or pipe',
    fields: [{ key: 'od', label: 'Outer diameter (OD)' }, { key: 't', label: 'Wall thickness' }],
    formula: 'π ÷ 4 × (OD² − ID²) × Length × Density,  where ID = OD − 2 × Wall',
    area: (d) => (Math.PI / 4) * (d.od ** 2 - (d.od - 2 * d.t) ** 2),
    check: (d) => (d.t >= d.od / 2 ? [{ key: 't', message: 'The wall must be less than half the outer diameter.' }] : []),
  },
  {
    id: 'rectTube', label: 'Square / Rect. tube', note: 'Hollow square or rectangular section',
    fields: [{ key: 'w', label: 'Width' }, { key: 'h', label: 'Height', hint: 'for a square tube use the same as the width' }, { key: 't', label: 'Wall thickness' }],
    formula: '(Width × Height − (Width − 2×Wall) × (Height − 2×Wall)) × Length × Density',
    area: (d) => d.w * d.h - (d.w - 2 * d.t) * (d.h - 2 * d.t),
    check: (d) => (d.t >= Math.min(d.w, d.h) / 2 ? [{ key: 't', message: 'The wall must be less than half the smaller side.' }] : []),
  },
];
export const shapeById = (id: ShapeId) => SHAPES.find((s) => s.id === id)!;

export interface WeightInput {
  shape: ShapeId;
  /** the size fields, in `sizeUnit` (null = not entered) */
  sizes: Record<string, number | null>;
  sizeUnit: LenUnit;
  length: number | null;
  lengthUnit: LenUnit;
  /** g/cm³ */
  density: number | null;
  /** number of pieces, a whole number */
  qty: number | null;
}

export interface WeightResult {
  ok: boolean;
  /** field key (a size key, 'length', 'density' or 'qty') → message */
  errors: Record<string, string>;
  areaMm2: number;
  volumeCm3: number;
  lengthMm: number;
  /** kg of one piece */
  pieceKg: number;
  /** kg of all the pieces */
  totalKg: number;
  /** kg of one metre of this section */
  kgPerM: number;
  qty: number;
}

const EMPTY: WeightResult = { ok: false, errors: {}, areaMm2: 0, volumeCm3: 0, lengthMm: 0, pieceKg: 0, totalKg: 0, kgPerM: 0, qty: 0 };
const MAX_DENSITY = 25; // osmium, the densest metal, is 22.6 g/cm³: more than this is a typing slip

export function computeWeight(i: WeightInput): WeightResult {
  const def = shapeById(i.shape);
  const errors: Record<string, string> = {};
  const need = (key: string, v: number | null, label: string) => {
    if (v == null || Number.isNaN(v)) errors[key] = `Enter the ${label.toLowerCase()}.`;
    else if (!Number.isFinite(v) || v <= 0) errors[key] = `${label} must be more than 0.`;
  };
  for (const f of def.fields) need(f.key, i.sizes[f.key] ?? null, f.label);
  need('length', i.length, 'Length');
  if (i.density == null || Number.isNaN(i.density)) errors.density = 'Enter the density.';
  else if (!(i.density > 0)) errors.density = 'Density must be more than 0.';
  else if (i.density > MAX_DENSITY) errors.density = `Density above ${MAX_DENSITY} g/cm³ is not a real metal: check it.`;
  const qty = i.qty == null || Number.isNaN(i.qty) ? 1 : i.qty;
  if (!Number.isInteger(qty) || qty < 1) errors.qty = 'Pieces must be a whole number, 1 or more.';

  if (Object.keys(errors).length) return { ...EMPTY, errors };
  const mm: Record<string, number> = {};
  for (const f of def.fields) mm[f.key] = toMm(i.sizes[f.key] as number, i.sizeUnit);
  for (const c of def.check?.(mm) ?? []) errors[c.key] = c.message;
  if (Object.keys(errors).length) return { ...EMPTY, errors };

  const areaMm2 = def.area(mm);
  const lengthMm = toMm(i.length as number, i.lengthUnit);
  const volumeCm3 = (areaMm2 * lengthMm) / 1000;
  const pieceKg = (volumeCm3 * (i.density as number)) / 1000;
  const kgPerM = (areaMm2 * 1000 * (i.density as number)) / 1e6;
  return { ok: true, errors, areaMm2, volumeCm3, lengthMm, pieceKg, totalKg: pieceKg * qty, kgPerM, qty };
}

/**
 * Typical densities (g/cm³) of the common metals, always offered next to the company's own material list (which is edited in the app and may not
 * hold every metal). They are standard published values; the density box on the screen can always be changed to a supplier's figure.
 */
export const OTHER_METALS: { name: string; density: number }[] = [
  { name: 'Mild / carbon steel', density: 7.85 },
  { name: 'Alloy steel', density: 7.85 },
  { name: 'Stainless steel 304', density: 7.93 },
  { name: 'Stainless steel 316', density: 7.98 },
  { name: 'Cast iron (grey)', density: 7.2 },
  { name: 'Aluminium (general)', density: 2.7 },
  { name: 'Brass (general)', density: 8.5 },
  { name: 'Copper (general)', density: 8.96 },
  { name: 'Bronze (phosphor)', density: 8.8 },
  { name: 'Nickel', density: 8.9 },
  { name: 'Zinc', density: 7.14 },
  { name: 'Lead', density: 11.34 },
  { name: 'Titanium', density: 4.51 },
  { name: 'Magnesium', density: 1.74 },
];
