// ---------------------------------------------------------------------------
// Starting data — master lists only: raw-material categories,
// customers, suppliers, machines, operators and inspectors.
// There is NO raw-material stock and there are NO jobs: every inward, job,
// stage entry, QC result, finished good and dispatch is entered by the user,
// so the full flow and every calculation can be checked from the first inward.
// ---------------------------------------------------------------------------
import type { ERPState, Product } from './types';

// No products are pre-loaded: the Director / Plant Head adds them in Product Master.
export const PRODUCTS: Product[] = [];

export const SUPPLIERS = ['ABC Metals', 'XYZ Metals', 'PQR Industries', 'Shree Steel Traders', 'Mahalaxmi Alloys', 'Shakti Stainless Traders', 'Om Alloys & Metals'];
export const CUSTOMERS = [
  'ABC Industries',
  'Sigma Valves Pvt. Ltd.',
  'Metro Electricals',
  'Apex Auto Components',
  'Nova Hydraulics',
];
export const MACHINES = {
  cutting: ['Bandsaw BS-01', 'Bandsaw BS-02', 'Circular Saw CS-01'],
  forging: ['Friction Screw Press FP-400T', 'Hydraulic Press HP-250T', 'Power Hammer PH-01'],
  trimming: ['Trim Press TP-01', 'Trim Press TP-02'],
  heatTreatment: ['Furnace F-01 (Box)', 'Furnace F-02 (Pit)', 'Continuous Furnace CF-01'],
};
export const OPERATORS = ['Ramesh Patil', 'Suresh Jadhav', 'Imran Shaikh', 'Vijay Pawar', 'Anil More', 'Kiran Desai'];
export const INSPECTORS = ['Priya Kulkarni (QA)', 'Rahul Deshmukh (QA)'];

export function emptyState(): ERPState {
  return {
    products: PRODUCTS.map((p) => ({ ...p })),
    rawMaterials: [],
    rawInwards: [],
    jobs: [],
    cutting: [],
    forging: [],
    trimming: [],
    heatTreatment: [],
    cnc: [],
    vmc: [],
    qc: [],
    jobWork: [],
    hardnessReports: [],
    finishedGoods: [],
    dispatches: [],
    movements: [],
    activity: [],
    counters: { job: 0, dispatch: 0, lot: 0, fg: 0, seq: 0 },
  };
}

/** Starting state: master lists only — no raw-material stock and no jobs. */
export function buildSeed(): ERPState {
  return emptyState();
}
