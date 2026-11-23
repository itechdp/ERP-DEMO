// Metal Weight Calculator: Round Bar and Pipe, by length and by weight, against hand-worked values.  Run: npm run test:metalweight
import { calculate, CM_PER, fromCm, MATERIALS, materialOfDensity, toCm, type CalcInput } from '../src/metalweight/calc';
import { pieceWeightKg } from '../src/store/materials';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const near = (a: number, b: number, tol = 0.0005) => Math.abs(a - b) <= tol;
const STEEL = 7.85;
const base: CalcInput = {
  shape: 'round', mode: 'length', density: STEEL, d: null, dUnit: 'mm', od: null, odUnit: 'mm', pipeBy: 'wall', wall: null, wallUnit: 'mm',
  length: null, lengthUnit: 'mm', weight: null, weightUnit: 'kg', pieces: null, price: null,
};
const calc = (x: Partial<CalcInput>) => calculate({ ...base, ...x });

// ---- the three checks asked for
// Steel round bar D 50 mm × L 1000 mm: A = π × 2.5² = 19.634954 cm²; V = 1963.4954 cm³; × 7.85 = 15413.44 g = 15.41344 kg
const r = calc({ d: 50, length: 1000 });
check('Steel 7.85, Round Bar D 50 mm, L 1000 mm, 1 piece = 15.41 kg (15.41344)', r.ok && near(r.totalKg, 15.41344, 0.00001) && near(r.pieceKg, 15.41344, 0.00001), r);
check('…its area is 19.635 cm² and volume 1963.495 cm³', near(r.areaCm2, 19.634954, 0.000001) && near(r.volumeCm3, 1963.4954, 0.0001), [r.areaCm2, r.volumeCm3]);
const back = calc({ mode: 'weight', d: 50, weight: 15.41 });
check('By Weight, D 50 mm and 15.41 kg = length ≈ 1000 mm (999.78)', back.ok && near(fromCm(back.lengthCm, 'mm'), 999.777, 0.01), fromCm(back.lengthCm, 'mm'));
const exact = calc({ mode: 'weight', d: 50, weight: r.totalKg });
check('By Weight with the exact 15.41344 kg gives exactly 1000 mm back', near(fromCm(exact.lengthCm, 'mm'), 1000, 1e-9), fromCm(exact.lengthCm, 'mm'));
check('a blank form (as after CLEAR) gives no result, only "enter …" messages', !calc({ density: null }).ok && Object.keys(calc({ density: null }).errors).sort().join() === 'd,density,length', calc({ density: null }).errors);

// ---- the same as the ERP's own job-card formula for a round bar
check('agrees with pieceWeightKg (job cards) for D 50 × 1000 mm', near(r.pieceKg, pieceWeightKg(50, 1000, STEEL), 1e-9), [r.pieceKg, pieceWeightKg(50, 1000, STEEL)]);

// ---- units: everything goes to cm first
check('mm × 0.1, cm × 1, m × 100, inch × 2.54, ft × 30.48', CM_PER.mm === 0.1 && CM_PER.cm === 1 && CM_PER.m === 100 && CM_PER.inch === 2.54 && CM_PER.ft === 30.48);
check('toCm / fromCm are inverse', near(fromCm(toCm(37.5, 'inch'), 'inch'), 37.5, 1e-12) && near(toCm(1, 'ft'), 30.48, 1e-12));
check('D 5 cm and L 1 m give the same as 50 mm × 1000 mm', near(calc({ d: 5, dUnit: 'cm', length: 1, lengthUnit: 'm' }).totalKg, r.totalKg, 1e-9));
// 2 inch × 1 ft steel: D 5.08 cm → A = 20.268299 cm²; × 30.48 = 617.7778 cm³; × 7.85 = 4849.56 g
check('2 inch × 1 ft steel = 4.84956 kg', near(calc({ d: 2, dUnit: 'inch', length: 1, lengthUnit: 'ft' }).totalKg, 4.84956, 0.00001), calc({ d: 2, dUnit: 'inch', length: 1, lengthUnit: 'ft' }).totalKg);

// ---- pieces and price
const p = calc({ d: 50, length: 1000, pieces: 12, price: 80 });
check('12 pieces: total = 12 × one piece (184.961 kg), each still 15.413 kg', near(p.totalKg, 12 * r.pieceKg, 1e-9) && near(p.pieceKg, r.pieceKg, 1e-12) && p.pieces === 12);
check('cost = total weight × price per kg (184.961 × 80 = ₹ 14,796.90)', p.cost != null && near(p.cost, 12 * r.pieceKg * 80, 1e-6) && near(p.cost, 14796.90, 0.01), p.cost);
check('no price → no cost; blank pieces = 1', r.cost === null && r.pieces === 1);
check('pieces must be a whole number of 1 or more', !!calc({ d: 50, length: 1000, pieces: 0 }).errors.pieces && !!calc({ d: 50, length: 1000, pieces: 2.5 }).errors.pieces);
check('a negative price is refused', !!calc({ d: 50, length: 1000, price: -1 }).errors.price);
// by weight with pieces: 100 kg in 4 pieces of D 50 → 25 kg each → 25000 / 7.85 = 3184.713 cm³ / 19.634954 = 162.196 cm
const w4 = calc({ mode: 'weight', d: 50, weight: 100, pieces: 4, price: 60 });
check('By Weight, 100 kg in 4 pieces of D 50 = 1621.96 mm each, 25 kg each, ₹ 6,000', near(fromCm(w4.lengthCm, 'mm'), 1621.96, 0.01) && near(w4.pieceKg, 25, 1e-9) && near(w4.cost ?? 0, 6000, 1e-9), [fromCm(w4.lengthCm, 'mm'), w4.pieceKg, w4.cost]);
check('By Weight in grams: 15413.44 g = the same 1000 mm', near(fromCm(calc({ mode: 'weight', d: 50, weight: 15413.4415, weightUnit: 'g' }).lengthCm, 'mm'), 1000, 0.001));
check('By Weight shows the length in m and ft too (1 m = 3.2808 ft)', near(fromCm(exact.lengthCm, 'm'), 1, 1e-12) && near(fromCm(exact.lengthCm, 'ft'), 3.28084, 0.00001));

// ---- pipe / round tube
// OD 60, T 5 → ID 50: A = π × (3² − 2.5²) = π × 2.75 = 8.639380 cm²; × 100 cm = 863.938 cm³; × 7.85 = 6781.91 g
const pipe = calc({ shape: 'pipe', od: 60, pipeBy: 'wall', wall: 5, length: 1000 });
check('Pipe OD 60, T 5, L 1000 mm steel = 6.78191 kg (ID 50 mm)', pipe.ok && near(pipe.totalKg, 6.78191, 0.00001) && near((pipe.idCm ?? 0) * 10, 50, 1e-9), pipe);
check('Pipe given by ID 50 instead of T 5 is the same', near(calc({ shape: 'pipe', od: 60, pipeBy: 'id', wall: 50, length: 1000 }).totalKg, pipe.totalKg, 1e-9));
check('Pipe = the outer bar minus the hole', near(pipe.totalKg, calc({ d: 60, length: 1000 }).totalKg - calc({ d: 50, length: 1000 }).totalKg, 1e-9));
check('Pipe by weight: 6.78191 kg → 1000 mm back', near(fromCm(calc({ shape: 'pipe', mode: 'weight', od: 60, wall: 5, weight: pipe.totalKg }).lengthCm, 'mm'), 1000, 1e-6));
check('a wall of half the OD or more, or an ID ≥ OD, is refused', !!calc({ shape: 'pipe', od: 20, wall: 10, length: 100 }).errors.wall && !!calc({ shape: 'pipe', od: 20, pipeBy: 'id', wall: 20, length: 100 }).errors.wall && calc({ shape: 'pipe', od: 20, wall: 9.9, length: 100 }).ok);

// ---- checks on the input
check('zero / negative sizes are refused', !!calc({ d: 0, length: 1000 }).errors.d && !!calc({ d: 50, length: -1 }).errors.length);
check('a missing or impossible density is refused', !!calc({ d: 50, length: 1000, density: null }).errors.density && !!calc({ d: 50, length: 1000, density: 78.5 }).errors.density);
check('By Weight needs the weight', !!calc({ mode: 'weight', d: 50 }).errors.weight && !calc({ mode: 'weight', d: 50 }).errors.length);
check('a refused input gives no weight', !calc({ d: 0, length: 1000 }).ok && calc({ d: 0, length: 1000 }).totalKg === 0);

// ---- materials
check('materials: Steel 7.85, Brass 8.50, Aluminium 2.70, Copper 8.96, SS 304 7.93, SS 316 7.98', ['Steel:7.85', 'Brass:8.5', 'Aluminium:2.7', 'Copper:8.96', 'SS 304:7.93', 'SS 316:7.98'].every((x) => MATERIALS.some((m) => `${m.label}:${m.density}` === x)) && MATERIALS.length === 6);
check('a typed density finds its material, or none (= Custom)', materialOfDensity(7.85)?.id === 'steel' && materialOfDensity(8.1) === undefined);
check('aluminium D 50 × 1 m = 5.30144 kg', near(calc({ d: 50, length: 1000, density: 2.7 }).totalKg, 5.30144, 0.00001));

console.log(failed ? `\n${failed} FAILED` : '\nAll metal weight checks passed');
process.exit(failed ? 1 : 0);
