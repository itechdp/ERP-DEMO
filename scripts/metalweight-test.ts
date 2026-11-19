// Metal Weight Calculator: every shape against hand-calculated weights, units, pieces, checks.  Run: npm run test:metalweight
import { computeWeight, LB_PER_KG, OTHER_METALS, SHAPES, toMm, type WeightInput } from '../src/metalweight/calc';
import { pieceWeightKg } from '../src/store/materials';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const near = (a: number, b: number, tol = 0.0005) => Math.abs(a - b) <= tol;
const STEEL = 7.85;
const w = (shape: WeightInput['shape'], sizes: Record<string, number | null>, length: number, density = STEEL, extra: Partial<WeightInput> = {}) =>
  computeWeight({ shape, sizes, sizeUnit: 'mm', length, lengthUnit: 'mm', density, qty: 1, ...extra });

// Each expected value below is worked out by hand from the geometry (area in cm² × length in cm × density), then compared with the code.
// ---- round bar: 50 mm × 1 m steel.  Area = π/4 × 5² = 19.63495 cm²; volume = 1963.495 cm³; × 7.85 = 15413.44 g
const r = w('round', { d: 50 }, 1000);
check('round bar Ø50 × 1000 mm steel = 15.41344 kg', r.ok && near(r.pieceKg, 15.41344, 0.00001), r.pieceKg);
check('its volume is 1963.495 cm³ and area 1963.495 mm²', near(r.volumeCm3, 1963.495, 0.001) && near(r.areaMm2, 1963.495, 0.001), [r.volumeCm3, r.areaMm2]);
check('weight per metre = the same 15.41344 kg/m', near(r.kgPerM, 15.41344, 0.00001), r.kgPerM);
check('agrees with the ERP\'s own job-card formula (pieceWeightKg) for round bars', near(r.pieceKg, pieceWeightKg(50, 1000, STEEL), 1e-9), [r.pieceKg, pieceWeightKg(50, 1000, STEEL)]);
check('round bar in aluminium 2.70: Ø50 × 1 m = 5.30144 kg', near(w('round', { d: 50 }, 1000, 2.7).pieceKg, 5.30144, 0.00001), w('round', { d: 50 }, 1000, 2.7).pieceKg);
// ---- square bar: 20 mm × 1 m steel.  4 cm² × 100 cm = 400 cm³ × 7.85 = 3140 g
check('square bar 20 × 1000 mm steel = 3.140 kg', near(w('square', { a: 20 }, 1000).pieceKg, 3.14, 0.00001), w('square', { a: 20 }, 1000).pieceKg);
// ---- hexagon bar: 24 mm A/F × 1 m steel.  area = (√3/2) × 2.4² = 4.98830 cm²; × 100 = 498.830 cm³; × 7.85 = 3915.82 g
check('hex bar 24 A/F × 1000 mm steel = 3.91582 kg', near(w('hex', { af: 24 }, 1000).pieceKg, 3.91582, 0.00001), w('hex', { af: 24 }, 1000).pieceKg);
// ---- flat bar: 50 × 10 × 1 m.  5 cm² × 100 = 500 cm³ × 7.85 = 3925 g
check('flat bar 50 × 10 × 1000 mm steel = 3.925 kg', near(w('flat', { w: 50, t: 10 }, 1000).pieceKg, 3.925, 0.00001), w('flat', { w: 50, t: 10 }, 1000).pieceKg);
// ---- plate: 1 m × 1 m × 10 mm steel = 100 cm × 100 cm × 1 cm = 10000 cm³ × 7.85 = 78.5 kg
check('plate 1000 × 1000 × 10 mm steel = 78.5 kg', near(w('flat', { w: 1000, t: 10 }, 1000).pieceKg, 78.5, 0.00001), w('flat', { w: 1000, t: 10 }, 1000).pieceKg);
// ---- round tube: OD 60, wall 5 (ID 50), 1 m.  area = π/4 × (36 − 25) = 8.63938 cm²; × 100 = 863.938 cm³; × 7.85 = 6781.9 g
check('round tube OD60 wall 5 × 1000 mm steel = 6.78191 kg', near(w('roundTube', { od: 60, t: 5 }, 1000).pieceKg, 6.78191, 0.00001), w('roundTube', { od: 60, t: 5 }, 1000).pieceKg);
check('round tube equals the outer bar minus the hollow (Ø60 bar − Ø50 bar)', near(w('roundTube', { od: 60, t: 5 }, 1000).pieceKg, w('round', { d: 60 }, 1000).pieceKg - w('round', { d: 50 }, 1000).pieceKg, 1e-9));
// ---- square tube 50 × 50 × 3, 1 m.  area = 2500 − 44² = 564 mm² = 5.64 cm²; × 100 = 564 cm³; × 7.85 = 4427.4 g
check('square tube 50×50×3 × 1000 mm steel = 4.4274 kg', near(w('rectTube', { w: 50, h: 50, t: 3 }, 1000).pieceKg, 4.4274, 0.00001), w('rectTube', { w: 50, h: 50, t: 3 }, 1000).pieceKg);
// ---- rectangular tube 100 × 50 × 4, 2 m.  area = 5000 − 92 × 42 = 5000 − 3864 = 1136 mm² = 11.36 cm²; × 200 = 2272 cm³; × 7.85 = 17835.2 g
check('rectangular tube 100×50×4 × 2000 mm steel = 17.8352 kg', near(w('rectTube', { w: 100, h: 50, t: 4 }, 2000).pieceKg, 17.8352, 0.00001), w('rectTube', { w: 100, h: 50, t: 4 }, 2000).pieceKg);

// ---- thin tube: OD 20, wall 2 (ID 16), 1 m.  area = π/4 × (4 − 2.56) = 1.13097 cm²; × 100 = 113.097 cm³; × 7.85 = 887.81 g
check('round tube OD20 wall 2 × 1000 mm steel = 0.88781 kg', near(w('roundTube', { od: 20, t: 2 }, 1000).pieceKg, 0.88781, 0.00001), w('roundTube', { od: 20, t: 2 }, 1000).pieceKg);

// ---- units
check('unit conversions: 1 in = 25.4 mm, 1 ft = 304.8 mm, 1 m = 1000 mm, 1 cm = 10 mm', toMm(1, 'in') === 25.4 && toMm(1, 'ft') === 304.8 && toMm(1, 'm') === 1000 && toMm(1, 'cm') === 10);
// 2 in round steel × 12 in: D = 50.8 mm, L = 304.8 mm: π/4 × 5.08² = 20.26830 cm² × 30.48 = 617.7762 cm³ × 7.85 = 4849.5 g = 4.8495 kg = 10.691 lb
const inch = computeWeight({ shape: 'round', sizes: { d: 2 }, sizeUnit: 'in', length: 12, lengthUnit: 'in', density: STEEL, qty: 1 });
check('2 in round steel bar × 12 in = 4.84956 kg = 10.6914 lb', near(inch.pieceKg, 4.84956, 0.00001) && near(inch.pieceKg * LB_PER_KG, 10.6914, 0.0001), [inch.pieceKg, inch.pieceKg * LB_PER_KG]);
check('size in mm and length in metres give the same weight as everything in mm', near(computeWeight({ shape: 'round', sizes: { d: 50 }, sizeUnit: 'mm', length: 1, lengthUnit: 'm', density: STEEL, qty: 1 }).pieceKg, r.pieceKg, 1e-9));
check('size in cm and length in feet are converted separately', near(computeWeight({ shape: 'square', sizes: { a: 2 }, sizeUnit: 'cm', length: 1, lengthUnit: 'ft', density: STEEL, qty: 1 }).pieceKg, w('square', { a: 20 }, 304.8).pieceKg, 1e-9));
check('kg → lb uses 2.20462', near(LB_PER_KG, 2.20462, 0.00001));

// ---- pieces
const q = w('round', { d: 50 }, 1000, STEEL, { qty: 12 });
check('12 pieces: total = 12 × one piece, one piece unchanged', near(q.totalKg, r.pieceKg * 12, 1e-9) && near(q.pieceKg, r.pieceKg, 1e-12) && q.qty === 12);
check('a blank quantity means 1 piece', near(w('round', { d: 50 }, 1000, STEEL, { qty: null }).totalKg, r.pieceKg, 1e-12));

// ---- density
check('weight is in proportion to density (brass 8.47 vs steel 7.85)', near(w('round', { d: 50 }, 1000, 8.47).pieceKg / r.pieceKg, 8.47 / 7.85, 1e-9));
check('a density over 25 g/cm³ is refused as a slip', !!w('round', { d: 50 }, 1000, 78.5).errors.density);

// ---- checking input
check('every shape lists its size fields and a formula', SHAPES.length === 6 && SHAPES.every((s) => s.fields.length >= 1 && s.formula.length > 10));
check('empty sizes ask for each missing value', Object.keys(computeWeight({ shape: 'flat', sizes: { w: null, t: null }, sizeUnit: 'mm', length: null, lengthUnit: 'mm', density: STEEL, qty: 1 }).errors).sort().join() === 'length,t,w');
check('zero and negative sizes are refused', !!w('round', { d: 0 }, 1000).errors.d && !!w('round', { d: -5 }, 1000).errors.d && !!w('round', { d: 50 }, -1).errors.length);
check('a refused input gives no weight', w('round', { d: 0 }, 1000).ok === false && w('round', { d: 0 }, 1000).pieceKg === 0);
check('a tube whose wall is half the OD or more is refused (no hole left)', !!w('roundTube', { od: 20, t: 10 }, 1000).errors.t && !!w('roundTube', { od: 20, t: 12 }, 1000).errors.t && w('roundTube', { od: 20, t: 9.9 }, 1000).ok);
check('a rectangular tube whose wall is half the smaller side or more is refused', !!w('rectTube', { w: 100, h: 20, t: 10 }, 1000).errors.t && w('rectTube', { w: 100, h: 20, t: 9 }, 1000).ok);
check('pieces must be a whole number of 1 or more', !!w('round', { d: 50 }, 1000, STEEL, { qty: 0 }).errors.qty && !!w('round', { d: 50 }, 1000, STEEL, { qty: 2.5 }).errors.qty && !!w('round', { d: 50 }, 1000, STEEL, { qty: -1 }).errors.qty);
check('a missing density is refused', !!w('round', { d: 50 }, 1000, null as unknown as number).errors.density);
// 3000 × 100 × 12000 mm = 3.6e9 mm³ = 3.6e6 cm³; × 7.85 = 28 260 000 g = 28 260 kg
check('very small and very large parts still calculate (a 12 m heavy plate = 28 260 kg)', w('round', { d: 0.5 }, 1).pieceKg > 0 && near(w('flat', { w: 3000, t: 100 }, 12000).pieceKg, 28260, 0.001), w('flat', { w: 3000, t: 100 }, 12000).pieceKg);
check('an input that is NaN is treated as missing, not as zero weight', !!computeWeight({ shape: 'round', sizes: { d: Number.NaN }, sizeUnit: 'mm', length: 1000, lengthUnit: 'mm', density: STEEL, qty: 1 }).errors.d);

check('the common-metals list has carbon steel 7.85, stainless 304 7.93, cast iron 7.2, aluminium 2.7, brass 8.5, copper 8.96', ['Mild / carbon steel:7.85', 'Stainless steel 304:7.93', 'Cast iron (grey):7.2', 'Aluminium (general):2.7', 'Brass (general):8.5', 'Copper (general):8.96'].every((x) => OTHER_METALS.some((m) => `${m.name}:${m.density}` === x)));
check('every density in it is a real metal density (1 to 25 g/cm³) and names are unique', OTHER_METALS.every((m) => m.density > 1 && m.density < 25) && new Set(OTHER_METALS.map((m) => m.name)).size === OTHER_METALS.length);

console.log(failed ? `\n${failed} FAILED` : '\nAll metal weight checks passed');
process.exit(failed ? 1 : 0);
