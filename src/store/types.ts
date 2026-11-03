// ---------------------------------------------------------------------------
// ForgeFlow ERP demo — data model
// These shapes are filled from Supabase by src/db/load.ts; changes go through src/db/api.ts.
// ---------------------------------------------------------------------------

/** The four quantity-transforming process stages handled by the generic stage engine. */
export type ProcessStage = 'cutting' | 'forging' | 'trimming' | 'heatTreatment';

/** Where a job currently sits in the plant. */
export type JobStage = ProcessStage | 'qc' | 'finishedGoods' | 'dispatched' | 'scrapped';

export type StageStatus = 'Pending' | 'In Progress' | 'Completed';
export type QCStatus = 'QC Pending' | 'Approved' | 'Rejected' | 'Partially Approved';
export type DispatchStatus = 'Ready for Dispatch' | 'Dispatched';
export type FGStatus = 'Available' | 'Reserved' | 'Partially Dispatched' | 'Dispatched';

export interface Product {
  id: string;
  code: string;
  name: string;
  /** Raw material grade this product is forged from */
  material: string;
  od: number; // mm
  cuttingLength: number; // mm
  finishedWeight: number; // kg per piece (after forging/trimming)
  htTemperature: number; // °C — varies per product
  htSoakMinutes: number;
  htProcess: string; // e.g. Normalising, Annealing
  htQuench: string;
  dieNo: string;
  defaultCustomer: string; // CONFIDENTIAL (party name)
  salesRate?: number; // CONFIDENTIAL — ₹ per piece
}

/** A job-work batch: the customer's parts brought in for only some of the processes (supabase/migrations/26). */
export interface JobWork {
  jobNo: string;
  challanNo: string;
  challanDate: string;
  itemDescription: string;
  receivedQty: number;
  receivedWeight?: number; // KG
  /** whose material: the customer's (our stock is not used) or ours (Cutting issues from raw inventory) */
  materialSource: 'customer' | 'own';
  /** which processes this batch goes through — the others are skipped */
  processes: Record<ProcessStage, boolean>;
  qcRequired: boolean;
  chargeBasis: 'none' | 'piece' | 'kg' | 'process';
  rate?: number; // CONFIDENTIAL — ₹ per piece or per kg
  processRates?: Record<string, number>; // CONFIDENTIAL — ₹ per piece, per process
  billableQty: number;
  amount?: number; // CONFIDENTIAL — worked out by the database
  createdAt: string;
}

/** One inward lot of raw material (round bar billets). FIFO is applied across lots of the same material + OD. */
export interface RawMaterialLot {
  id: string; // RM-2026-001
  material: string; // Brass Round Bar
  materialType: string; // grade, e.g. CW614N
  od: number; // mm
  supplier: string;
  inwardDate: string; // ISO date
  heatNo: string;
  invoiceNo: string;
  inwardQty: number; // PCS
  inwardWeight: number; // KG
  availableQty: number; // PCS — reduces as material is issued to Cutting
  purchaseRate?: number; // CONFIDENTIAL — ₹ per KG
  unit: 'PCS';
  /** PCS rejected at incoming QC: not usable, and not counted as issued (database migration 32; undefined before it is installed) */
  blockedQty?: number;
  qcStatus?: 'Pending' | 'Accepted' | 'Rejected' | 'Partial';
  acceptedWeight?: number | null;
  rejectedWeight?: number | null;
  /** the purchase order line this lot was received against; null = received without a PO, undefined = PO link not installed yet */
  poId?: number | null;
  poItemId?: number | null;
  poNo?: string;
}

export interface RawInward {
  id: string;
  lotId: string;
  date: string;
  material: string;
  materialType: string;
  od: number;
  supplier: string;
  qty: number;
  weight: number;
  invoiceNo: string;
  purchaseRate?: number; // CONFIDENTIAL — ₹ per KG
}

/** Material issued from a raw lot to a job (FIFO allocation). */
export interface MaterialIssue {
  lotId: string;
  qty: number;
  weight: number;
}

export interface Job {
  jobNo: string; // JOB-2026-0001 — same number travels through every stage
  productId: string;
  customer: string;
  /** the sales order this job card is for */
  salesOrderNo?: string;
  plannedQty: number;
  materialKey: string; // `${material}|${od}` — what Cutting will consume
  createdAt: string;
  dueDate: string;
  priority: 'Normal' | 'High' | 'Urgent';
  currentStage: JobStage;
  issues: MaterialIssue[]; // raw lots consumed (filled when Cutting starts)
  // Job (route) card header — as on the client's paper Process Route Card
  pieceWeightG?: number; // cut weight per piece, grams
  dieNo?: string;
  machineNo?: string;
}

/** Generic record for Cutting, Forging, Trimming and Heat Treatment. */
export interface StageRecord {
  id: string;
  jobNo: string;
  stage: ProcessStage;
  input: number;
  loss: number;
  output: number;
  status: StageStatus;
  receivedAt: string; // when the qty arrived at this stage
  startedAt?: string;
  completedAt?: string;
  machine: string;
  operator: string;
  remarks: string;
  /** Stage specific parameters: cuttingLength, dieNo, temperature, soakMinutes, quench … */
  params: Record<string, string | number>;
}

export interface QCRecord {
  id: string;
  jobNo: string;
  input: number;
  accepted: number;
  rejected: number;
  status: QCStatus;
  receivedAt: string;
  inspectedAt?: string;
  inspector: string;
  rejectionReason: string;
  remarks: string;
  checks: { dimensional: boolean; visual: boolean; hardness: boolean };
}

export type HardnessScale = 'HRB' | 'HRC' | 'HV' | 'HB';

/** Hardness Inspection Report — client's paper format F QC 03. One reading per inspected piece. */
export interface HardnessReport {
  id: string; // HIR-2026-0001
  jobNo?: string; // optional link to a production job
  date: string; // ISO date
  component: string;
  material: string; // Aluminium | Brass | Copper
  grade: string; // e.g. AA 6082-T6 — decides the required hardness range
  supplier: string;
  inwardQty: number;
  inspectedQty: number;
  cycleNo: string; // hardness (heat-treatment) cycle no.
  drawingNo: string;
  checkedBy: string;
  scale: HardnessScale;
  min: number; // required hardness, lower limit
  max: number; // upper limit
  readings: (number | null)[]; // Sr. No. = index + 1; null = not measured yet
  remarks: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinishedGood {
  id: string; // FG-2026-0001
  jobNo: string;
  productId: string;
  qty: number; // QC accepted qty received into FG
  reservedQty: number; // packed / ready for dispatch
  dispatchedQty: number;
  receivedAt: string;
  location: string;
}

export interface Bag {
  no: number;
  qty: number;
  weight: number;
}

export interface Dispatch {
  dispatchNo: string; // DSP-2026-0001
  fgId: string;
  jobNo: string;
  productId: string;
  customer: string;
  qty: number;
  vehicleNo: string;
  driver: string;
  invoiceNo: string;
  date: string;
  bags: Bag[];
  weight: number; // KG total
  salesRate?: number; // CONFIDENTIAL — ₹ per piece, frozen at dispatch time
  status: DispatchStatus;
  createdAt: string;
  dispatchedAt?: string;
}

/** Quantity movement ledger — every transfer between stages is written here. */
export interface Movement {
  id: string;
  /** the date the movement happened on (as typed on the form) */
  ts: string;
  jobNo: string;
  from: string;
  to: string;
  qty: number;
  loss: number;
  note: string;
  /** who entered the line and when it was entered; a correction or a reversal is a NEW line, the original is never changed */
  enteredBy?: string;
  enteredAt?: string;
  kind?: 'move' | 'correction' | 'reversal';
}

export interface Activity {
  id: string;
  ts: string;
  jobNo?: string;
  kind: 'inward' | 'job' | 'start' | 'complete' | 'qc' | 'fg' | 'dispatch' | 'reject';
  text: string;
}

export interface Counters {
  job: number;
  dispatch: number;
  lot: number;
  fg: number;
  seq: number; // generic id sequence
}

export interface ERPState {
  products: Product[];
  rawMaterials: RawMaterialLot[];
  rawInwards: RawInward[];
  jobs: Job[];
  /** job-work batches (a job card with a job_work row beside it) */
  jobWork: JobWork[];
  cutting: StageRecord[];
  forging: StageRecord[];
  trimming: StageRecord[];
  heatTreatment: StageRecord[];
  qc: QCRecord[];
  hardnessReports: HardnessReport[];
  finishedGoods: FinishedGood[];
  dispatches: Dispatch[];
  movements: Movement[];
  activity: Activity[];
  counters: Counters;
}

export type CollectionKey = keyof ERPState;
