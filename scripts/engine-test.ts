// Headless check of the production engine from the starting data:  npm run test:engine
// Starting data = master lists only (no raw stock, no jobs); stock is added via inward.
import assert from 'node:assert/strict';
import {
  addInward,
  availableFor,
  completeQC,
  completeStage,
  createDispatch,
  createJob,
  ERPError,
  fgAvailable,
  jobSummary,
  markDispatched,
  materialKey,
  saveProduct,
  startStage,
  type ProductInput,
} from '../src/store/engine';
import { buildSeed } from '../src/store/seed';
import { findMaterial, MATERIAL_MASTER, pieceWeightKg } from '../src/store/materials';

let passed = 0;
const t = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ✓', name);
};
const throws = (fn: () => void, re: RegExp) => assert.throws(fn, (e: unknown) => e instanceof ERPError && re.test(e.message));
const ts = () => new Date().toISOString();
const checks = { dimensional: true, visual: true, hardness: true };

const s = buildSeed();
const flange: ProductInput = { code: '9084', name: '9084 Flange', material: 'EN8 Steel Round Bar', od: 50, cuttingLength: 62, finishedWeight: 0.2469, htTemperature: 850, htSoakMinutes: 60, htProcess: 'Normalising', htQuench: 'Still air', dieNo: 'D-9084-01', defaultCustomer: 'ABC Industries' };
const EN8 = materialKey('EN8 Steel Round Bar', 50);

console.log('\nStarting data');
t('no jobs, stage entries, QC, finished goods or dispatches', () => {
  const n = s.jobs.length + s.cutting.length + s.forging.length + s.trimming.length + s.heatTreatment.length + s.cnc.length + s.vmc.length + s.qc.length + s.finishedGoods.length + s.dispatches.length;
  assert.equal(n, 0);
});
t('no raw material stock, no inward records, no activity', () => {
  assert.equal(s.rawMaterials.length + s.rawInwards.length + s.activity.length + s.movements.length, 0);
});
t('the app starts with no products', () => assert.equal(s.products.length, 0));
t('saveProduct adds a product (id from its code) and validates', () => {
  assert.equal(saveProduct(s, flange), 'P-9084');
  assert.equal(s.products.length, 1);
  throws(() => saveProduct(s, { ...flange, name: 'Other' }), /already belongs/);
  throws(() => saveProduct(s, { ...flange, code: 'X1', od: 0 }), /greater than zero/);
  throws(() => saveProduct(s, { ...flange, code: 'X2', material: 'Nope' }), /raw material/);
  assert.equal(saveProduct(s, { ...flange, name: '9084 Flange v2' }, 'P-9084'), 'P-9084');
  assert.equal(s.products[0].name, '9084 Flange v2');
  s.products[0].name = '9084 Flange';
});
t('a job cannot be created without stock', () =>
  throws(() => createJob(s, { productId: 'P-9084', customer: 'X', plannedQty: 1, materialKey: EN8, cuttingLength: 62, dueDate: '2026-12-01', priority: 'Normal' }, ts()), /only 0 PCS/));

console.log('\nMaterial master');
t('every product uses a material from the master', () => {
  for (const p of s.products) assert.ok(findMaterial(p.material), p.material);
});
t('weight formula: Ø50 steel bar = 15.41 kg per metre (standard table value)', () => {
  assert.equal(pieceWeightKg(50, 1000, findMaterial('EN8 Steel Round Bar')!.density).toFixed(2), '15.41');
});
t('weight formula: Ø30 aluminium bar = 1.91 kg per metre', () => {
  assert.equal(pieceWeightKg(30, 1000, findMaterial('Aluminium Round Bar')!.density).toFixed(2), '1.91');
});
t(`${MATERIAL_MASTER.length} materials in the master`, () => assert.ok(MATERIAL_MASTER.length >= 12));

console.log('\nRaw material inward (two EN8 lots)');
addInward(s, { material: 'EN8 Steel Round Bar', materialType: 'Carbon Steel EN8', od: 50, supplier: 'Shree Steel Traders', inwardDate: '2026-09-01', qty: 600, weight: 168 }, ts());
addInward(s, { material: 'EN8 Steel Round Bar', materialType: 'Carbon Steel EN8', od: 50, supplier: 'Shree Steel Traders', inwardDate: '2026-10-01', qty: 400, weight: 112 }, ts());
t('EN8 stock = 600 + 400 = 1,000 PCS (280 KG)', () => {
  assert.equal(availableFor(s, EN8), 1000);
  assert.equal(s.rawMaterials.reduce((t2, l) => t2 + l.inwardWeight, 0), 280);
});

console.log('\nJob end-to-end (9084 Flange, 700 PCS — spans both EN8 lots)');
const jobNo = createJob(s, { productId: 'P-9084', customer: 'ABC Industries', plannedQty: 700, materialKey: EN8, cuttingLength: 62, dueDate: '2026-12-01', priority: 'Normal' }, ts());
t('first job is JOB-YYYY-0001', () => assert.match(jobNo, /^JOB-\d{4}-0001$/));
t('raw stock not consumed until cutting starts', () => assert.equal(availableFor(s, EN8), 1000));
t('cannot plan more than raw stock', () =>
  throws(() => createJob(s, { productId: 'P-9084', customer: 'X', plannedQty: 1001, materialKey: EN8, cuttingLength: 62, dueDate: '2026-12-01', priority: 'Normal' }, ts()), /Insufficient/));
t('cannot complete forging before cutting', () => throws(() => completeStage(s, 'forging', jobNo, { loss: 0 }, ts()), /no open Forging/));
t('impossible loss is rejected before any material is issued', () => {
  throws(() => completeStage(s, 'cutting', jobNo, { loss: 701 }, ts()), /cannot exceed/);
  assert.equal(availableFor(s, EN8), 1000);
  assert.equal(s.cutting[0].status, 'Pending');
});

startStage(s, 'cutting', jobNo, { inputQty: 700 }, ts());
t('FIFO: 600 from the older lot, 100 from the newer → stock 1000 − 700 = 300', () => {
  assert.deepEqual(s.jobs[0].issues.map((i) => i.qty), [600, 100]);
  assert.equal(availableFor(s, EN8), 300);
});
completeStage(s, 'cutting', jobNo, { loss: 14 }, ts());
t('Cutting 700 − 14 = 686 → Forging input', () => assert.equal(s.forging[0].input, 686));
t('completed cutting order is no longer open', () => throws(() => completeStage(s, 'cutting', jobNo, { loss: 0 }, ts()), /no open Cutting/));
completeStage(s, 'forging', jobNo, { loss: 6 }, ts());
t('Forging 686 − 6 = 680 → Trimming input', () => assert.equal(s.trimming[0].input, 680));
completeStage(s, 'trimming', jobNo, { loss: 5 }, ts());
t('Trimming 680 − 5 = 675 → Heat Treatment input @ 850°C', () => {
  assert.equal(s.heatTreatment[0].input, 675);
  assert.equal(s.heatTreatment[0].params.temperature, 850);
});
completeStage(s, 'heatTreatment', jobNo, { loss: 3 }, ts());
t('Heat Treatment 675 − 3 = 672 → CNC input (CNC comes next, not QC)', () => {
  assert.equal(s.cnc[0].input, 672);
  assert.equal(s.qc.length, 0);
});
t('CNC cannot be skipped over: VMC has no open order yet', () => throws(() => completeStage(s, 'vmc', jobNo, { loss: 0 }, ts()), /no open VMC/));
completeStage(s, 'cnc', jobNo, { loss: 0 }, ts());
t('CNC 672 − 0 = 672 → VMC input', () => assert.equal(s.vmc[0].input, 672));
completeStage(s, 'vmc', jobNo, { loss: 0 }, ts());
t('VMC 672 − 0 = 672 → QC input', () => assert.equal(s.qc[0].input, 672));
t('QC accepted + rejected must equal input', () =>
  throws(() => completeQC(s, jobNo, { accepted: 670, rejected: 1, inspector: 'QA', rejectionReason: 'x', checks }, ts()), /must equal/));
completeQC(s, jobNo, { accepted: 668, rejected: 4, inspector: 'QA', rejectionReason: 'Crack', checks }, ts());
const fg = s.finishedGoods[0];
t('QC 672 = 668 accepted + 4 rejected → Finished Goods 668', () => assert.equal(fgAvailable(fg), 668));
t('dispatch cannot exceed Finished Goods', () =>
  throws(() => createDispatch(s, { fgId: fg.id, customer: 'C', qty: 669, vehicleNo: 'V1', date: '2026-10-07', bagCount: 5, weight: 10, status: 'Dispatched' }, ts()), /exceeds/));
const dn = createDispatch(s, { fgId: fg.id, customer: 'C', qty: 300, vehicleNo: '', date: '2026-10-07', bagCount: 30, weight: 74.07, status: 'Ready for Dispatch' }, ts());
t('packing 300 reserves them: available 668 − 300 = 368', () => assert.deepEqual([fg.reservedQty, fgAvailable(fg)], [300, 368]));
markDispatched(s, dn, 'GJ05AB1234', ts());
// bag-wise packing as written on the route card (qty + weighed weight per bag)
const cardBags = [
  { qty: 100, weight: 24.69 }, { qty: 110, weight: 27.23 }, { qty: 110, weight: 27.24 },
];
const dn2 = createDispatch(s, { fgId: fg.id, vehicleNo: 'GJ13AX3059', date: '2026-10-07', status: 'Dispatched', bags: cardBags }, ts());
t('bag-wise dispatch: qty = 100 + 110 + 110 = 320, weight = sum of bags, customer from job', () => {
  const d = s.dispatches.find((x) => x.dispatchNo === dn2)!;
  assert.deepEqual([d.qty, d.weight, d.bags.length, d.customer], [320, 79.16, 3, 'ABC Industries']);
  assert.equal(fgAvailable(fg), 48);
});
t('bag with blank weight is calculated from the product weight', () => {
  const dn3 = createDispatch(s, { fgId: fg.id, vehicleNo: 'GJ13AX3059', date: '2026-10-07', status: 'Dispatched', bags: [{ qty: 48, weight: 0 }] }, ts());
  assert.equal(s.dispatches.find((x) => x.dispatchNo === dn3)!.bags[0].weight, Math.round(48 * s.products[0].finishedWeight * 1000) / 1000);
});
t('all 668 dispatched; FG 0; job Dispatched', () => {
  assert.deepEqual([fg.dispatchedQty, fgAvailable(fg)], [668, 0]);
  assert.equal(jobSummary(s, jobNo).status, 'Dispatched');
});
t('reconciliation: 700 issued = 28 process loss + 4 QC rejected + 668 dispatched', () => {
  const j = jobSummary(s, jobNo);
  assert.deepEqual([j.issuedQty, j.processLoss, j.qcRejected, j.dispatchedQty], [700, 28, 4, 668]);
  assert.equal(j.issuedQty, j.processLoss + j.qcRejected + j.dispatchedQty);
  assert.equal(j.yieldPct!.toFixed(2), '95.43');
});

console.log(`\n${passed} checks passed\n`);
