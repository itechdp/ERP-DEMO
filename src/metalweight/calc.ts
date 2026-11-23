// Metal Weight Calculator — Round Bar and Pipe / Round Tube, worked out "by length" (→ weight) or "by weight" (→ length).
// Pure rules (no screen, no database) so they can be tested alone:  npm run test:metalweight
//
// Every length is turned into centimetres first (mm × 0.1, cm × 1, m × 100, inch × 2.54, ft × 30.48). Density is in g/cm³, so
// 1 cm³ weighs "density" grams:
//   Round bar area  A (cm²) = π × (D / 2)²                 Pipe area  A (cm²) = π × ((OD / 2)² − (ID / 2)²),  ID = OD − 2 × T
//   By length:  volume per piece (cm³) = A × L     weight per piece (kg) = volume × density ÷ 1000     total = per piece × pieces
//   By weight:  grams = kg × 1000 (or g)           volume per piece (cm³) = (grams ÷ pieces) ÷ density     length per piece (cm) = volume ÷ A
//   Cost (₹) = total weight (kg) × price per kg (only when a price is given)

export type Shape = 'round' | 'pipe';
export type Mode = 'length' | 'weight';
export type LenUnit = 'mm' | 'cm' | 'm' | 'inch' | 'ft';
export type WtUnit = 'kg' | 'g';
/** the second pipe size: the wall thickness (T) or the inner diameter (ID) */
export type PipeBy = 'wall' | 'id';

/** centimetres in one of each unit */
export const CM_PER: Record<LenUnit, number> = { mm: 0.1, cm: 1, m: 100, inch: 2.54, ft: 30.48 };
export const LEN_UNITS: LenUnit[] = ['mm', 'cm', 'm', 'inch', 'ft'];
export const WT_UNITS: WtUnit[] = ['kg', 'g'];
export const toCm = (v: number, u: LenUnit) => v * CM_PER[u];
export const fromCm = (cm: number, u: LenUnit) => cm / CM_PER[u];

/** the materials offered at the top (g/cm³); "Custom" is any other density typed by hand */
export const MATERIALS: { id: string; label: string; density: number }[] = [
  { id: 'steel', label: 'Steel', density: 7.85 },
  { id: 'brass', label: 'Brass', density: 8.5 },
  { id: 'aluminium', label: 'Aluminium', density: 2.7 },
  { id: 'copper', label: 'Copper', density: 8.96 },
  { id: 'ss304', label: 'SS 304', density: 7.93 },
  { id: 'ss316', label: 'SS 316', density: 7.98 },
];
export const materialOfDensity = (d: number | null) => (d == null ? undefined : MATERIALS.find((m) => Math.abs(m.density - d) < 1e-9));

export interface CalcInput {
  shape: Shape;
  mode: Mode;
  /** g/cm³ */
  density: number | null;
  /** round bar: diameter */
  d: number | null;
  dUnit: LenUnit;
  /** pipe: outer diameter, and the wall thickness or the inner diameter */
  od: number | null;
  odUnit: LenUnit;
  pipeBy: PipeBy;
  wall: number | null;
  wallUnit: LenUnit;
  /** by length */
  length: number | null;
  lengthUnit: LenUnit;
  /** by weight: the total weight of all the pieces */
  weight: number | null;
  weightUnit: WtUnit;
  /** empty = 1 */
  pieces: number | null;
  /** ₹ per kg; empty = no cost */
  price: number | null;
}

export interface CalcResult {
  ok: boolean;
  /** field key → message */
  errors: Record<string, string>;
  areaCm2: number;
  /** of one piece */
  volumeCm3: number;
  pieceKg: number;
  totalKg: number;
  /** length of one piece (by length: as entered; by weight: worked out) */
  lengthCm: number;
  pieces: number;
  /** ₹, null when no price per kg was given */
  cost: number | null;
  /** pipe: the inner diameter used (cm) */
  idCm: number | null;
}

const EMPTY: CalcResult = { ok: false, errors: {}, areaCm2: 0, volumeCm3: 0, pieceKg: 0, totalKg: 0, lengthCm: 0, pieces: 0, cost: null, idCm: null };
const MAX_DENSITY = 25; // osmium, the densest metal, is 22.6 g/cm³: more than this is a typing slip

const bad = (v: number | null) => v == null || !Number.isFinite(v);

export function calculate(i: CalcInput): CalcResult {
  const errors: Record<string, string> = {};
  const need = (key: string, v: number | null, label: string) => {
    if (bad(v)) errors[key] = `Enter the ${label}.`;
    else if ((v as number) <= 0) errors[key] = `The ${label} must be more than 0.`;
  };
  if (bad(i.density)) errors.density = 'Enter the density.';
  else if (!((i.density as number) > 0)) errors.density = 'The density must be more than 0.';
  else if ((i.density as number) > MAX_DENSITY) errors.density = `A density above ${MAX_DENSITY} gr/cm³ is not a real metal — check it.`;

  if (i.shape === 'round') need('d', i.d, 'diameter');
  else {
    need('od', i.od, 'outer diameter');
    need('wall', i.wall, i.pipeBy === 'wall' ? 'wall thickness' : 'inner diameter');
  }
  if (i.mode === 'length') need('length', i.length, 'length');
  else need('weight', i.weight, 'weight');

  const pieces = i.pieces == null || Number.isNaN(i.pieces) ? 1 : i.pieces;
  if (!Number.isInteger(pieces) || pieces < 1) errors.pieces = 'Pieces must be a whole number, 1 or more.';
  if (i.price != null && !Number.isNaN(i.price) && i.price < 0) errors.price = 'The price cannot be negative.';
  if (Object.keys(errors).length) return { ...EMPTY, errors };

  // cross-section area in cm²
  let areaCm2: number;
  let idCm: number | null = null;
  if (i.shape === 'round') {
    const dCm = toCm(i.d as number, i.dUnit);
    areaCm2 = Math.PI * (dCm / 2) ** 2;
  } else {
    const odCm = toCm(i.od as number, i.odUnit);
    const second = toCm(i.wall as number, i.wallUnit);
    idCm = i.pipeBy === 'wall' ? odCm - 2 * second : second;
    if (i.pipeBy === 'wall' && second >= odCm / 2) errors.wall = 'The wall must be less than half the outer diameter.';
    if (i.pipeBy === 'id' && second >= odCm) errors.wall = 'The inner diameter must be less than the outer diameter.';
    if (Object.keys(errors).length) return { ...EMPTY, errors };
    areaCm2 = Math.PI * ((odCm / 2) ** 2 - ((idCm as number) / 2) ** 2);
  }

  const density = i.density as number;
  const price = i.price != null && !Number.isNaN(i.price) && i.price > 0 ? i.price : null;
  if (i.mode === 'length') {
    const lengthCm = toCm(i.length as number, i.lengthUnit);
    const volumeCm3 = areaCm2 * lengthCm;
    const pieceKg = (volumeCm3 * density) / 1000;
    const totalKg = pieceKg * pieces;
    return { ok: true, errors, areaCm2, volumeCm3, pieceKg, totalKg, lengthCm, pieces, cost: price == null ? null : totalKg * price, idCm };
  }
  const grams = i.weightUnit === 'kg' ? (i.weight as number) * 1000 : (i.weight as number);
  const volumeCm3 = grams / pieces / density;
  const lengthCm = volumeCm3 / areaCm2;
  const totalKg = grams / 1000;
  return { ok: true, errors, areaCm2, volumeCm3, pieceKg: totalKg / pieces, totalKg, lengthCm, pieces, cost: price == null ? null : totalKg * price, idCm };
}
