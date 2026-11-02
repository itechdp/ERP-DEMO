// ---------------------------------------------------------------------------
// Raw-material master — round bars commonly used in hot / cold forging.
// `material` is the name stock is tracked under (together with OD), so it must
// match the `material` of products in the product master.
// Densities are nominal values in g/cm³, used for theoretical weight.
// ---------------------------------------------------------------------------

export interface MaterialSpec {
  material: string;
  family: string;
  grade: string;
  density: number;
  defaultOd: number;
}

export const MATERIAL_MASTER: MaterialSpec[] = [  // the built-in list; replaced by the database's material master once it is loaded (applyMaterialMaster)
  // Carbon steel
  { family: 'Carbon Steel', material: 'EN8 Steel Round Bar', grade: 'EN8 / 080M40 (C45 equivalent)', density: 7.85, defaultOd: 50 },
  { family: 'Carbon Steel', material: 'EN9 Steel Round Bar', grade: 'EN9 / 070M55 (C55 equivalent)', density: 7.85, defaultOd: 50 },
  { family: 'Carbon Steel', material: 'EN3 Mild Steel Round Bar', grade: 'EN3 / 080M15 (SAE 1018 equivalent)', density: 7.85, defaultOd: 40 },
  // Alloy steel
  { family: 'Alloy Steel', material: 'EN19 Alloy Steel Round Bar', grade: 'EN19 / 42CrMo4 (SAE 4140)', density: 7.85, defaultOd: 60 },
  { family: 'Alloy Steel', material: 'EN24 Alloy Steel Round Bar', grade: 'EN24 / 34CrNiMo6 (SAE 4340)', density: 7.85, defaultOd: 60 },
  { family: 'Alloy Steel', material: '20MnCr5 Alloy Steel Round Bar', grade: '20MnCr5 (case-hardening)', density: 7.85, defaultOd: 40 },
  // Stainless steel
  { family: 'Stainless Steel', material: 'SS304 Stainless Steel Round Bar', grade: 'AISI 304 / 1.4301', density: 7.93, defaultOd: 40 },
  { family: 'Stainless Steel', material: 'SS316 Stainless Steel Round Bar', grade: 'AISI 316 / 1.4401', density: 7.98, defaultOd: 40 },
  { family: 'Stainless Steel', material: 'SS410 Stainless Steel Round Bar', grade: 'AISI 410 / 1.4006', density: 7.75, defaultOd: 40 },
  // Brass
  { family: 'Brass', material: 'Brass Round Bar', grade: 'CW614N / CuZn39Pb3 (free-cutting brass)', density: 8.47, defaultOd: 45 },
  { family: 'Brass', material: 'Forging Brass Round Bar', grade: 'CW617N / CuZn40Pb2 (hot-stamping brass)', density: 8.43, defaultOd: 45 },
  // Copper
  { family: 'Copper', material: 'Copper Round Bar', grade: 'ETP Copper C11000 / Cu-ETP', density: 8.94, defaultOd: 30 },
  { family: 'Copper', material: 'OFHC Copper Round Bar', grade: 'Oxygen-free Copper C10200 / Cu-OF', density: 8.94, defaultOd: 30 },
  // Aluminium
  { family: 'Aluminium', material: 'Aluminium Round Bar', grade: 'AA 6061-T6', density: 2.7, defaultOd: 25 },
  { family: 'Aluminium', material: 'Aluminium 6082 Round Bar', grade: 'AA 6082-T6', density: 2.71, defaultOd: 25 },
  { family: 'Aluminium', material: 'Aluminium 2014 Round Bar', grade: 'AA 2014 (forging alloy)', density: 2.8, defaultOd: 25 },
];

export const MATERIAL_FAMILIES: string[] = [...new Set(MATERIAL_MASTER.map((m) => m.family))];

/** Standard round-bar diameters stocked by mills / service centres (mm). */
export const STANDARD_OD_MM: number[] = [12, 16, 20, 22, 25, 28, 30, 32, 35, 38, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120];

// The lists are edited in the app (Settings → Drop-down Lists, or "+ Add new" in the drop-down). The database's version replaces these
// built-in ones when the app loads; they are changed IN PLACE so every page that imported them sees the new content.
export function applyMaterialMaster(rows: MaterialSpec[]) {
  if (!rows.length) return;
  MATERIAL_MASTER.splice(0, MATERIAL_MASTER.length, ...rows);
  MATERIAL_FAMILIES.splice(0, MATERIAL_FAMILIES.length, ...new Set(rows.map((m) => m.family)));
}
export function applyBarSizes(sizes: number[]) {
  if (!sizes.length) return;
  STANDARD_OD_MM.splice(0, STANDARD_OD_MM.length, ...sizes);
}

export const findMaterial = (material: string) => MATERIAL_MASTER.find((m) => m.material === material);

/** Theoretical weight of one round piece in kg: π/4 · D² · L · ρ. */
export function pieceWeightKg(odMm: number, lengthMm: number, density: number) {
  const volumeCm3 = (Math.PI / 4) * (odMm / 10) ** 2 * (lengthMm / 10);
  return (volumeCm3 * density) / 1000;
}
