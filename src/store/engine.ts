// ---------------------------------------------------------------------------
// Production engine — the single source of truth for quantity movement.
//
// Every function mutates the draft state it receives (the store hands in a
// clone) and throws ERPError on invalid input. Every screen (and the opening
// stock seed) goes through these functions, so the same rules apply everywhere:
//
//     OUTPUT = INPUT − LOSS/REJECTION      (at every stage)
//     next stage INPUT = previous stage OUTPUT  (never more)
// ---------------------------------------------------------------------------
import { hardnessGrades, isHardnessMaterial } from './hardnessSpecs';
import { findMaterial } from './materials';
import type {
  Activity,
  Bag,
  Dispatch,
  DispatchStatus,
  ERPState,
  FGStatus,
  FinishedGood,
  HardnessReport,
  HardnessScale,
  Job,
  JobStage,
  ProcessStage,
  Product,
  QCRecord,
  QCStatus,
  RawMaterialLot,
  StageRecord,
} from './types';

export class ERPError extends Error {}
const fail = (msg: string): never => {
  throw new ERPError(msg);
};

export const PROCESS_STAGES: ProcessStage[] = ['cutting', 'forging', 'trimming', 'heatTreatment'];

export const STAGE_LABEL: Record<JobStage | 'raw', string> = {
  raw: 'Raw Inventory',
  cutting: 'Cutting',
  forging: 'Forging',
  trimming: 'Trimming',
  heatTreatment: 'Heat Treatment',
  qc: 'QC',
  finishedGoods: 'Finished Goods',
  dispatched: 'Dispatch',
  scrapped: 'Rejected',
};

const NEXT_STAGE: Record<ProcessStage, JobStage> = {
  cutting: 'forging',
  forging: 'trimming',
  trimming: 'heatTreatment',
  heatTreatment: 'qc',
};

/** Position of each stage on the 8-step flow (Raw → Dispatch). */
export const FLOW_INDEX: Record<JobStage, number> = {
  cutting: 1,
  forging: 2,
  trimming: 3,
  heatTreatment: 4,
  qc: 5,
  finishedGoods: 6,
  dispatched: 7,
  scrapped: -1,
};

// ---------------------------------------------------------------- helpers ---
const pad = (n: number, w: number) => String(n).padStart(w, '0');
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
const yearOf = (ts: string) => new Date(ts).getFullYear();

function nextId(s: ERPState, prefix: string) {
  s.counters.seq += 1;
  return `${prefix}-${pad(s.counters.seq, 5)}`;
}

function assertQty(n: unknown, label: string, { allowZero = false } = {}): number {
  const v = Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v)) fail(`${label} must be a whole number of pieces.`);
  if (v < 0 || (!allowZero && v === 0)) fail(`${label} must be ${allowZero ? 'zero or more' : 'greater than zero'}.`);
  return v;
}

function log(s: ERPState, ts: string, kind: Activity['kind'], text: string, jobNo?: string) {
  s.activity.unshift({ id: nextId(s, 'ACT'), ts, kind, text, jobNo });
  if (s.activity.length > 300) s.activity.length = 300;
}

function move(s: ERPState, ts: string, jobNo: string, from: string, to: string, qty: number, loss: number, note = '') {
  s.movements.unshift({ id: nextId(s, 'MOV'), ts, jobNo, from, to, qty, loss, note });
}

export const materialKey = (material: string, od: number) => `${material}|${od}`;
export const parseMaterialKey = (key: string) => {
  const [material, od] = key.split('|');
  return { material, od: Number(od) };
};

export function getProduct(s: ERPState, id: string): Product {
  return s.products.find((p) => p.id === id) ?? fail(`Unknown product ${id}`);
}
export function getJob(s: ERPState, jobNo: string): Job {
  return s.jobs.find((j) => j.jobNo === jobNo) ?? fail(`Job ${jobNo} not found.`);
}
export const lotWeightPerPc = (lot: RawMaterialLot) => (lot.inwardQty ? lot.inwardWeight / lot.inwardQty : 0);
export const lotAvailableWeight = (lot: RawMaterialLot) => round3(lot.availableQty * lotWeightPerPc(lot));

/** Lots of one material/OD with stock, oldest first (FIFO). */
export function fifoLots(s: ERPState, key: string): RawMaterialLot[] {
  return s.rawMaterials
    .filter((l) => materialKey(l.material, l.od) === key && l.availableQty > 0)
    .sort((a, b) => a.inwardDate.localeCompare(b.inwardDate) || a.id.localeCompare(b.id));
}
export const availableFor = (s: ERPState, key: string) => fifoLots(s, key).reduce((t, l) => t + l.availableQty, 0);

/** PCS of a lot that production has taken (not the ones rejected at incoming QC) */
export const lotIssuedQty = (lot: RawMaterialLot) => lot.inwardQty - lot.availableQty - (lot.blockedQty ?? 0);

export function lotStatus(lot: RawMaterialLot): 'Available' | 'Low Stock' | 'Consumed' | 'Rejected' {
  if (lot.availableQty === 0 && (lot.blockedQty ?? 0) >= lot.inwardQty) return 'Rejected';
  if (lot.availableQty === 0) return 'Consumed';
  if (lot.availableQty < lot.inwardQty * 0.2) return 'Low Stock';
  return 'Available';
}

// ------------------------------------------------------- raw inventory ---
export interface InwardInput {
  material: string;
  materialType: string;
  od: number;
  supplier: string;
  inwardDate: string;
  qty: number;
  weight: number;
  heatNo?: string;
  invoiceNo?: string;
  purchaseRate?: number; // ₹ per KG — confidential
  /** book the receipt against a purchase order line (optional; database migration 32). null on an edit = unlink. */
  poId?: number | null;
  poItemId?: number | null;
}

export function addInward(s: ERPState, input: InwardInput, ts: string): string {
  if (!input.material?.trim()) fail('Material is required.');
  if (!input.supplier?.trim()) fail('Supplier is required.');
  const od = Number(input.od);
  if (!(od > 0)) fail('OD / Size must be greater than zero.');
  const qty = assertQty(input.qty, 'Quantity');
  const weight = Number(input.weight);
  if (!(weight > 0)) fail('Weight must be greater than zero.');

  s.counters.lot += 1;
  const id = `RM-${yearOf(ts)}-${pad(s.counters.lot, 3)}`;
  const lot: RawMaterialLot = {
    id,
    material: input.material.trim(),
    materialType: input.materialType.trim(),
    od,
    supplier: input.supplier.trim(),
    inwardDate: input.inwardDate,
    heatNo: input.heatNo?.trim() || `HT-${pad(Math.floor(1000 + s.counters.lot * 137) % 10000, 4)}`,
    invoiceNo: input.invoiceNo?.trim() || `INV/${pad(s.counters.lot * 41 + 300, 4)}`,
    inwardQty: qty,
    inwardWeight: round3(weight),
    availableQty: qty,
    purchaseRate: input.purchaseRate && input.purchaseRate > 0 ? Math.round(input.purchaseRate * 100) / 100 : undefined,
    unit: 'PCS',
  };
  s.rawMaterials.push(lot);
  s.rawInwards.unshift({
    id: nextId(s, 'INW'),
    lotId: id,
    date: input.inwardDate,
    material: lot.material,
    materialType: lot.materialType,
    od,
    supplier: lot.supplier,
    qty,
    weight: lot.inwardWeight,
    invoiceNo: lot.invoiceNo,
    purchaseRate: lot.purchaseRate,
  });
  move(s, ts, '—', 'Supplier', 'Raw Inventory', qty, 0, `${lot.material} OD ${od}mm · lot ${id}`);
  log(s, ts, 'inward', `${qty} PCS ${lot.material} (OD ${od}mm) received — lot ${id}`);
  return id;
}

// ---------------------------------------------------------------- jobs ---
export interface JobInput {
  productId: string;
  plannedQty: number;
  materialKey: string;
  cuttingLength: number;
  customer?: string; // defaults to the product's customer
  salesOrderNo?: string; // the sales order this job card is for
  dueDate?: string;
  priority?: Job['priority'];
  pieceWeightG?: number;
  dieNo?: string;
  machineNo?: string;
}

/** Creates the production job (auto Job No.) and its Cutting order in "Pending". */
export function createJob(s: ERPState, input: JobInput, ts: string): string {
  const product = getProduct(s, input.productId);
  const planned = assertQty(input.plannedQty, 'Planned quantity');
  if (!input.materialKey) fail('Select a raw material.');
  const avail = availableFor(s, input.materialKey);
  if (planned > avail)
    fail(`Insufficient raw material: ${planned} PCS planned but only ${avail} PCS available for ${input.materialKey.replace('|', ' OD ')}mm.`);

  s.counters.job += 1;
  const jobNo = `JOB-${yearOf(ts)}-${pad(s.counters.job, 4)}`;
  s.jobs.push({
    jobNo,
    productId: product.id,
    customer: input.customer?.trim() || product.defaultCustomer,
    salesOrderNo: input.salesOrderNo || undefined,
    plannedQty: planned,
    materialKey: input.materialKey,
    createdAt: ts,
    dueDate: input.dueDate ?? '',
    priority: input.priority ?? 'Normal',
    currentStage: 'cutting',
    issues: [],
    pieceWeightG: input.pieceWeightG && input.pieceWeightG > 0 ? input.pieceWeightG : undefined,
    dieNo: input.dieNo?.trim() || undefined,
    machineNo: input.machineNo?.trim() || undefined,
  });
  s.cutting.push({
    id: nextId(s, 'CUT'),
    jobNo,
    stage: 'cutting',
    input: planned,
    loss: 0,
    output: 0,
    status: 'Pending',
    receivedAt: ts,
    machine: '',
    operator: '',
    remarks: '',
    params: { cuttingLength: Number(input.cuttingLength) || product.cuttingLength },
  });
  log(s, ts, 'job', `${jobNo} created — ${planned} PCS ${product.name}`, jobNo);
  return jobNo;
}

/** Issue raw material to a job using FIFO across lots of the same material/OD. */
function issueMaterial(s: ERPState, job: Job, qty: number, ts: string) {
  const lots = fifoLots(s, job.materialKey);
  const avail = lots.reduce((t, l) => t + l.availableQty, 0);
  if (qty > avail) fail(`Only ${avail} PCS of ${job.materialKey.replace('|', ' OD ')}mm available in Raw Inventory.`);
  let remaining = qty;
  for (const lot of lots) {
    if (remaining === 0) break;
    const take = Math.min(lot.availableQty, remaining);
    lot.availableQty -= take;
    remaining -= take;
    const weight = round3(take * lotWeightPerPc(lot));
    job.issues.push({ lotId: lot.id, qty: take, weight });
    move(s, ts, job.jobNo, 'Raw Inventory', 'Cutting', take, 0, `FIFO issue from lot ${lot.id} (${weight} KG)`);
  }
}

export const stageRecords = (s: ERPState, stage: ProcessStage) => s[stage] as StageRecord[];

function openRecord(s: ERPState, stage: ProcessStage, jobNo: string) {
  return (
    stageRecords(s, stage).find((r) => r.jobNo === jobNo && r.status !== 'Completed') ??
    fail(`${jobNo} has no open ${STAGE_LABEL[stage]} order.`)
  );
}

export interface StartInput {
  inputQty?: number; // Cutting only — actual input issued from raw stock
  machine?: string;
  operator?: string;
  params?: Record<string, string | number>;
}

export function startStage(s: ERPState, stage: ProcessStage, jobNo: string, input: StartInput, ts: string) {
  const rec = openRecord(s, stage, jobNo);
  if (rec.status !== 'Pending') fail(`${jobNo} is already in progress at ${STAGE_LABEL[stage]}.`);
  const job = getJob(s, jobNo);
  if (stage === 'cutting') {
    const qty = assertQty(input.inputQty ?? rec.input, 'Actual input quantity');
    issueMaterial(s, job, qty, ts);
    rec.input = qty;
  }
  rec.status = 'In Progress';
  rec.startedAt = ts;
  rec.machine = input.machine ?? rec.machine;
  rec.operator = input.operator ?? rec.operator;
  rec.params = { ...rec.params, ...(input.params ?? {}) };
  log(s, ts, 'start', `${jobNo} ${STAGE_LABEL[stage]} started — ${rec.input} PCS`, jobNo);
}

export interface CompleteInput extends StartInput {
  loss: number;
  remarks?: string;
}

export function completeStage(s: ERPState, stage: ProcessStage, jobNo: string, input: CompleteInput, ts: string) {
  const rec = openRecord(s, stage, jobNo);
  // validate before anything is issued or moved
  const loss = assertQty(input.loss, 'Loss / rejection', { allowZero: true });
  const inputQty = rec.status === 'Pending' && stage === 'cutting' ? Number(input.inputQty ?? rec.input) : rec.input;
  if (loss > inputQty) fail(`Loss (${loss}) cannot exceed input quantity (${inputQty}).`);
  if (rec.status === 'Pending') startStage(s, stage, jobNo, input, ts);

  rec.loss = loss;
  rec.output = rec.input - loss;
  rec.status = 'Completed';
  rec.completedAt = ts;
  rec.machine = input.machine ?? rec.machine;
  rec.operator = input.operator ?? rec.operator;
  rec.remarks = input.remarks ?? rec.remarks;
  rec.params = { ...rec.params, ...(input.params ?? {}) };

  const job = getJob(s, jobNo);
  const product = getProduct(s, job.productId);
  const next = NEXT_STAGE[stage];

  if (rec.output === 0) {
    job.currentStage = 'scrapped';
    move(s, ts, jobNo, STAGE_LABEL[stage], 'Rejection', 0, loss, 'Entire batch rejected');
    log(s, ts, 'reject', `${jobNo} fully rejected at ${STAGE_LABEL[stage]} (${loss} PCS)`, jobNo);
    return;
  }

  move(s, ts, jobNo, STAGE_LABEL[stage], STAGE_LABEL[next], rec.output, loss);
  log(
    s,
    ts,
    'complete',
    `${jobNo} ${STAGE_LABEL[stage]} completed — ${rec.input} in, ${loss} loss, ${rec.output} PCS moved to ${STAGE_LABEL[next]}`,
    jobNo,
  );
  job.currentStage = next;

  if (next === 'qc') {
    s.qc.push({
      id: nextId(s, 'QC'),
      jobNo,
      input: rec.output,
      accepted: 0,
      rejected: 0,
      status: 'QC Pending',
      receivedAt: ts,
      inspector: '',
      rejectionReason: '',
      remarks: '',
      checks: { dimensional: false, visual: false, hardness: false },
    });
    return;
  }

  const params: Record<string, string | number> =
    next === 'forging'
      ? { dieNo: job.dieNo || product.dieNo }
      : next === 'trimming'
        ? { trimDie: product.dieNo.replace('D-', 'T-') }
        : next === 'heatTreatment'
          ? {
              temperature: product.htTemperature,
              soakMinutes: product.htSoakMinutes,
              process: product.htProcess,
              quench: product.htQuench,
            }
          : {};
  stageRecords(s, next as ProcessStage).push({
    id: nextId(s, next.slice(0, 3).toUpperCase()),
    jobNo,
    stage: next as ProcessStage,
    input: rec.output, // ← next stage receives exactly what this stage produced
    loss: 0,
    output: 0,
    status: 'Pending',
    receivedAt: ts,
    machine: '',
    operator: '',
    remarks: '',
    params,
  });
}

// ------------------------------------------------------------------- QC ---
export interface QCInput {
  accepted: number;
  rejected: number;
  inspector: string;
  rejectionReason?: string;
  remarks?: string;
  checks: QCRecord['checks'];
}

export const qcStatusFor = (input: number, accepted: number): QCStatus =>
  accepted === input ? 'Approved' : accepted === 0 ? 'Rejected' : 'Partially Approved';

export function completeQC(s: ERPState, jobNo: string, input: QCInput, ts: string) {
  const rec = s.qc.find((r) => r.jobNo === jobNo && r.status === 'QC Pending') ?? fail(`${jobNo} is not awaiting QC.`);
  const accepted = assertQty(input.accepted, 'Accepted quantity', { allowZero: true });
  const rejected = assertQty(input.rejected, 'Rejected quantity', { allowZero: true });
  if (accepted + rejected !== rec.input)
    fail(`Accepted (${accepted}) + Rejected (${rejected}) must equal QC input (${rec.input}).`);

  Object.assign(rec, {
    accepted,
    rejected,
    status: qcStatusFor(rec.input, accepted),
    inspectedAt: ts,
    inspector: input.inspector,
    rejectionReason: input.rejectionReason ?? '',
    remarks: input.remarks ?? '',
    checks: input.checks,
  });

  const job = getJob(s, jobNo);
  const product = getProduct(s, job.productId);
  log(s, ts, 'qc', `${jobNo} QC ${rec.status.toLowerCase()} — ${accepted} PCS passed, ${rejected} rejected`, jobNo);

  if (accepted === 0) {
    job.currentStage = 'scrapped';
    move(s, ts, jobNo, 'QC', 'Rejection', 0, rejected, input.rejectionReason ?? '');
    return;
  }

  s.counters.fg += 1;
  const fg: FinishedGood = {
    id: `FG-${yearOf(ts)}-${pad(s.counters.fg, 4)}`,
    jobNo,
    productId: product.id,
    qty: accepted,
    reservedQty: 0,
    dispatchedQty: 0,
    receivedAt: ts,
    location: `FG Store · Rack ${String.fromCharCode(64 + ((s.counters.fg - 1) % 6) + 1)}-${(s.counters.fg % 4) + 1}`,
  };
  s.finishedGoods.push(fg);
  job.currentStage = 'finishedGoods';
  move(s, ts, jobNo, 'QC', 'Finished Goods', accepted, rejected, rejected ? `Rejected: ${input.rejectionReason}` : '');
  log(s, ts, 'fg', `${accepted} PCS ${product.name} added to Finished Goods (${fg.id})`, jobNo);
}

// ------------------------------------------------------- finished goods ---
export const fgAvailable = (fg: FinishedGood) => fg.qty - fg.reservedQty - fg.dispatchedQty;
export const fgWeight = (s: ERPState, fg: FinishedGood, qty = fg.qty) =>
  round3(qty * getProduct(s, fg.productId).finishedWeight);

export function fgStatus(fg: FinishedGood): FGStatus {
  if (fg.dispatchedQty === fg.qty) return 'Dispatched';
  if (fg.dispatchedQty > 0) return 'Partially Dispatched';
  if (fgAvailable(fg) === 0) return 'Reserved';
  return 'Available';
}

function syncJobAfterDispatch(s: ERPState, jobNo: string) {
  const job = getJob(s, jobNo);
  const lots = s.finishedGoods.filter((f) => f.jobNo === jobNo);
  if (lots.length && lots.every((f) => f.dispatchedQty === f.qty)) job.currentStage = 'dispatched';
}

// ------------------------------------------------------------- dispatch ---
export interface DispatchInput {
  fgId: string;
  vehicleNo: string;
  date: string;
  status: DispatchStatus;
  /** Bag-wise packing as written on the route card; when given, qty and weight are the bag totals. */
  bags?: { qty: number; weight: number }[];
  qty?: number;
  bagCount?: number;
  weight?: number;
  customer?: string; // defaults to the job's customer
  driver?: string;
  invoiceNo?: string;
}

/** Splits a quantity into bags as evenly as possible (e.g. 94 in 10 bags → 9×10 + 1×4). */
export function planBags(qty: number, bagCount: number, totalWeight: number) {
  const perBag = Math.ceil(qty / bagCount);
  const unit = qty ? totalWeight / qty : 0;
  const bags = [];
  let left = qty;
  for (let i = 1; i <= bagCount && left > 0; i++) {
    const q = Math.min(perBag, left);
    bags.push({ no: i, qty: q, weight: round3(q * unit) });
    left -= q;
  }
  return bags;
}

export function createDispatch(s: ERPState, input: DispatchInput, ts: string): string {
  const fg = s.finishedGoods.find((f) => f.id === input.fgId) ?? fail('Select a finished goods lot.');
  const unitKg = getProduct(s, fg.productId).finishedWeight;
  let bags: Bag[];
  if (input.bags) {
    if (!input.bags.length) fail('Add at least one bag.');
    bags = input.bags.map((b, i) => {
      const q = assertQty(b.qty, `Bag ${i + 1} quantity`);
      const w = Number(b.weight) > 0 ? round3(Number(b.weight)) : round3(q * unitKg);
      return { no: i + 1, qty: q, weight: w };
    });
  } else {
    const q = assertQty(input.qty, 'Dispatch quantity');
    const n = assertQty(input.bagCount, 'Number of bags');
    if (n > q) fail('Number of bags cannot exceed dispatch quantity.');
    const w = Number(input.weight);
    if (!(w > 0)) fail('Total weight must be greater than zero.');
    bags = planBags(q, n, w);
  }
  const qty = bags.reduce((t, b) => t + b.qty, 0);
  const weight = round3(bags.reduce((t, b) => t + b.weight, 0));
  const available = fgAvailable(fg);
  if (qty > available) fail(`Dispatch quantity (${qty}) exceeds available finished goods (${available} PCS).`);
  const customer = input.customer?.trim() || getJob(s, fg.jobNo).customer;
  if (input.status === 'Dispatched' && !input.vehicleNo?.trim()) fail('Vehicle number is required to dispatch.');

  s.counters.dispatch += 1;
  const dispatchNo = `DSP-${yearOf(ts)}-${pad(s.counters.dispatch, 4)}`;
  const d: Dispatch = {
    dispatchNo,
    fgId: fg.id,
    jobNo: fg.jobNo,
    productId: fg.productId,
    customer,
    qty,
    vehicleNo: input.vehicleNo.trim().toUpperCase(),
    driver: input.driver?.trim() ?? '',
    invoiceNo: input.invoiceNo?.trim() || `INV-${yearOf(ts)}-${pad(s.counters.dispatch + 410, 4)}`,
    date: input.date,
    bags,
    weight,
    salesRate: getProduct(s, fg.productId).salesRate,
    status: input.status,
    createdAt: ts,
    dispatchedAt: input.status === 'Dispatched' ? ts : undefined,
  };
  s.dispatches.unshift(d);
  const product = getProduct(s, fg.productId);

  if (input.status === 'Dispatched') {
    fg.dispatchedQty += qty;
    move(s, ts, fg.jobNo, 'Finished Goods', 'Customer', qty, 0, `${dispatchNo} · ${d.vehicleNo}`);
    log(s, ts, 'dispatch', `${qty} PCS ${product.name} dispatched — ${dispatchNo} (${d.vehicleNo})`, fg.jobNo);
    syncJobAfterDispatch(s, fg.jobNo);
  } else {
    fg.reservedQty += qty;
    log(s, ts, 'dispatch', `${qty} PCS ${product.name} packed in ${d.bags.length} bags, ready for dispatch — ${dispatchNo}`, fg.jobNo);
  }
  return dispatchNo;
}

export function markDispatched(s: ERPState, dispatchNo: string, vehicleNo: string, ts: string) {
  const d = s.dispatches.find((x) => x.dispatchNo === dispatchNo) ?? fail(`${dispatchNo} not found.`);
  if (d.status === 'Dispatched') fail(`${dispatchNo} is already dispatched.`);
  if (!vehicleNo?.trim()) fail('Vehicle number is required to dispatch.');
  const fg = s.finishedGoods.find((f) => f.id === d.fgId) ?? fail('Finished goods lot missing.');
  fg.reservedQty -= d.qty;
  fg.dispatchedQty += d.qty;
  d.status = 'Dispatched';
  d.vehicleNo = vehicleNo.trim().toUpperCase();
  d.dispatchedAt = ts;
  move(s, ts, d.jobNo, 'Finished Goods', 'Customer', d.qty, 0, `${dispatchNo} · ${d.vehicleNo}`);
  log(s, ts, 'dispatch', `${d.qty} PCS dispatched — ${dispatchNo} (${d.vehicleNo})`, d.jobNo);
  syncJobAfterDispatch(s, d.jobNo);
}

// ---------------------------------------------------- derived job views ---
export type JobStatusLabel =
  | 'Pending'
  | 'In Progress'
  | 'QC Pending'
  | 'Ready for Dispatch'
  | 'Dispatched'
  | 'Rejected';

export interface JobSummary {
  job: Job;
  product: Product;
  records: Partial<Record<ProcessStage, StageRecord>>;
  qc?: QCRecord;
  fg: FinishedGood[];
  dispatches: Dispatch[];
  /** everything that came into the job: raw bar issued + parts taken from our stock + the customer's parts (job work on their material) */
  issuedQty: number;
  issuedFrom: { raw: number; parts: number; customer: number };
  issuedWeight: number;
  processLoss: number; // cutting → heat treatment
  qcRejected: number;
  totalLoss: number;
  currentQty: number;
  dispatchedQty: number;
  fgAvailableQty: number;
  status: JobStatusLabel;
  flowIndex: number; // 0..7 position on Raw → Dispatch
  yieldPct: number | null;
}

export function jobSummary(s: ERPState, jobNo: string): JobSummary {
  const job = getJob(s, jobNo);
  const product = getProduct(s, job.productId);
  const records: JobSummary['records'] = {};
  for (const st of PROCESS_STAGES) {
    const r = stageRecords(s, st).find((x) => x.jobNo === jobNo);
    if (r) records[st] = r;
  }
  const qc = s.qc.find((x) => x.jobNo === jobNo);
  const fg = s.finishedGoods.filter((f) => f.jobNo === jobNo);
  const dispatches = s.dispatches.filter((d) => d.jobNo === jobNo);
  const rawQty = job.issues.reduce((t, i) => t + i.qty, 0);
  // parts taken from our stock, and parts the customer brought (counted only when the material is THEIRS — on our material the bar is issued instead)
  const fromLedger = (from: string) => s.movements.filter((m) => m.jobNo === jobNo && m.from === from && m.kind !== 'reversal').reduce((t, m) => t + m.qty, 0);
  const partsQty = fromLedger('Parts stock');
  const customerQty = s.jobWork.find((w) => w.jobNo === jobNo)?.materialSource === 'customer' ? fromLedger('Customer') : 0;
  const issuedQty = rawQty + partsQty + customerQty;
  const issuedWeight = round3(job.issues.reduce((t, i) => t + i.weight, 0));
  const processLoss = PROCESS_STAGES.reduce((t, st) => t + (records[st]?.status === 'Completed' ? records[st]!.loss : 0), 0);
  const qcRejected = qc && qc.status !== 'QC Pending' ? qc.rejected : 0;
  const dispatchedQty = fg.reduce((t, f) => t + f.dispatchedQty, 0);
  const fgAvailableQty = fg.reduce((t, f) => t + fgAvailable(f), 0);

  let currentQty = 0;
  let status: JobStatusLabel = 'Pending';
  const st = job.currentStage;
  if (st === 'cutting' || st === 'forging' || st === 'trimming' || st === 'heatTreatment') {
    const r = records[st]!;
    currentQty = r.input;
    status = r.status === 'In Progress' ? 'In Progress' : 'Pending';
  } else if (st === 'qc') {
    currentQty = qc?.input ?? 0;
    status = 'QC Pending';
  } else if (st === 'finishedGoods') {
    currentQty = fg.reduce((t, f) => t + f.qty - f.dispatchedQty, 0);
    status = 'Ready for Dispatch';
  } else if (st === 'dispatched') {
    currentQty = dispatchedQty;
    status = 'Dispatched';
  } else {
    status = 'Rejected';
  }

  const finalQty = fg.reduce((t, f) => t + f.qty, 0);
  const yieldPct = qc && qc.status !== 'QC Pending' && issuedQty ? (finalQty / issuedQty) * 100 : null;

  return {
    job,
    product,
    records,
    qc,
    fg,
    dispatches,
    issuedQty,
    issuedFrom: { raw: rawQty, parts: partsQty, customer: customerQty },
    issuedWeight,
    processLoss,
    qcRejected,
    totalLoss: processLoss + qcRejected,
    currentQty,
    dispatchedQty,
    fgAvailableQty,
    status,
    flowIndex: FLOW_INDEX[st],
    yieldPct,
  };
}

export const isToday = (iso: string | undefined, now = new Date()) => {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};

// ------------------------------------------------------- hardness report ---
/** Printed on every report — taken from the client's format F QC 03. */
export const HARDNESS_FORM = {
  company: 'Everest Auto Forge Pvt. Ltd.',
  address: 'Survey No. 281, Plot No. 7, Shapar Main Road, Gujarat-360024.',
  formatNo: 'F QC 03',
  revision: '00 / 01.10.25',
  title: 'HARDNESS INSPECTION REPORT',
} as const;

export const HARDNESS_SCALES: HardnessScale[] = ['HRB', 'HRC', 'HV', 'HB'];

export type ReadingResult = 'OK' | 'Not OK';
export const readingResult = (r: Pick<HardnessReport, 'min' | 'max'>, v: number | null): ReadingResult | null =>
  v === null || !Number.isFinite(v) ? null : v >= r.min && v <= r.max ? 'OK' : 'Not OK';

export type HardnessVerdict = 'Pass' | 'Fail' | 'Incomplete';
export function hardnessVerdict(r: Pick<HardnessReport, 'min' | 'max' | 'readings'>): HardnessVerdict {
  const res = r.readings.map((v) => readingResult(r, v));
  if (res.includes('Not OK')) return 'Fail';
  return res.length === 0 || res.includes(null) ? 'Incomplete' : 'Pass';
}
export const requiredText = (r: Pick<HardnessReport, 'min' | 'max' | 'scale'>) => `${r.min} to ${r.max} ${r.scale}`;

export type HardnessInput = Omit<HardnessReport, 'id' | 'createdAt' | 'updatedAt'>;

/** Creates a report, or updates the one with `id`. Returns its id. */
export function saveHardnessReport(s: ERPState, input: HardnessInput, ts: string, id?: string): string {
  const component = input.component.trim();
  if (!component) fail('Enter the component name.');
  if (!input.date) fail('Enter the inspection date.');
  if (!isHardnessMaterial(input.material)) fail('Select the material: Aluminium, Brass or Copper.');
  if (input.grade && !hardnessGrades(input.material).some((g) => g.grade === input.grade)) fail(`Grade ${input.grade} does not belong to ${input.material}.`);
  if (!input.checkedBy.trim()) fail('Enter who checked the hardness.');
  if (!Number.isFinite(input.min) || !Number.isFinite(input.max) || input.min <= 0 || input.max <= 0) fail('Enter the required hardness range (both limits).');
  if (input.min > input.max) fail('Required hardness: the lower limit cannot be above the upper limit.');
  const inspectedQty = assertQty(input.inspectedQty, 'Inspected quantity');
  const inwardQty = assertQty(input.inwardQty, 'Inward quantity', { allowZero: true });
  if (inwardQty && inspectedQty > inwardQty) fail(`Inspected quantity (${inspectedQty}) cannot exceed inward quantity (${inwardQty}).`);
  if (!input.readings.length) fail('Add at least one hardness reading.');
  if (input.readings.length > inspectedQty) fail(`${input.readings.length} readings cannot be taken from ${inspectedQty} inspected piece${inspectedQty === 1 ? '' : 's'}.`);
  if (input.readings.some((v) => v !== null && (!Number.isFinite(v) || v <= 0))) fail('Hardness readings must be positive numbers.');
  if (input.jobNo && !s.jobs.some((j) => j.jobNo === input.jobNo)) fail(`Job ${input.jobNo} does not exist.`);

  const clean = { ...input, component, inwardQty, inspectedQty, checkedBy: input.checkedBy.trim(), supplier: input.supplier.trim(), material: input.material.trim(), grade: input.grade.trim(), cycleNo: input.cycleNo.trim(), drawingNo: input.drawingNo.trim(), remarks: input.remarks.trim() };
  if (id) {
    const old = s.hardnessReports.find((r) => r.id === id) ?? fail(`Report ${id} not found.`);
    Object.assign(old, clean, { updatedAt: ts });
    log(s, ts, 'qc', `Hardness report ${id} updated — ${hardnessVerdict(old).toLowerCase()}`, old.jobNo);
    return id;
  }
  const n = s.hardnessReports.reduce((m, r) => Math.max(m, Number(r.id.split('-')[2]) || 0), 0) + 1;
  const rep: HardnessReport = { ...clean, id: `HIR-${yearOf(ts)}-${pad(n, 4)}`, createdAt: ts, updatedAt: ts };
  s.hardnessReports.push(rep);
  log(s, ts, 'qc', `Hardness report ${rep.id} recorded for ${component} — ${hardnessVerdict(rep).toLowerCase()}`, rep.jobNo);
  return rep.id;
}

// --------------------------------------------------------- product master ---
export type ProductInput = Omit<Product, 'id'>;

/** Creates a product, or updates the one with `id`. Returns its id. Existing jobs keep pointing at the same id. */
export function saveProduct(s: ERPState, input: ProductInput, id?: string): string {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) fail('Enter the product code.');
  if (!name) fail('Enter the product name.');
  if (!findMaterial(input.material)) fail('Select the raw material this product is forged from.');
  const pos = (n: unknown, label: string) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : fail(`${label} must be greater than zero.`));
  const clean: ProductInput = {
    code,
    name,
    material: input.material,
    od: pos(input.od, 'Bar OD'),
    cuttingLength: pos(input.cuttingLength, 'Cutting length'),
    finishedWeight: pos(input.finishedWeight, 'Finished weight'),
    htTemperature: pos(input.htTemperature, 'Heat treatment temperature'),
    htSoakMinutes: pos(input.htSoakMinutes, 'Soak time'),
    htProcess: input.htProcess.trim(),
    htQuench: input.htQuench.trim(),
    dieNo: input.dieNo.trim(),
    defaultCustomer: input.defaultCustomer.trim(),
    salesRate: input.salesRate && input.salesRate > 0 ? Math.round(input.salesRate * 100) / 100 : undefined,
  };
  const dup = s.products.find((p) => p.code.toLowerCase() === code.toLowerCase() && p.id !== id);
  if (dup) fail(`Product code ${code} already belongs to ${dup.name}.`);
  if (id) {
    const old = s.products.find((p) => p.id === id) ?? fail(`Product ${id} not found.`);
    Object.assign(old, clean);
    return id;
  }
  let newId = `P-${code.toUpperCase().replace(/[^A-Z0-9]+/g, '')}`;
  while (s.products.some((p) => p.id === newId)) newId += '1';
  s.products.push({ id: newId, ...clean });
  return newId;
}
