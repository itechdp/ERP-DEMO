// ---------------------------------------------------------------------------
// Reads everything the screens need from Supabase and maps it (snake_case → the app's camelCase types).
//
// Confidential tables are read ONLY through the masking views (v_products, v_lots, v_jobs, v_finished_goods, v_dispatches,
// v_hardness_reports, v_main_dies, v_dies). For roles without access the database returns NULL for the confidential columns;
// they arrive here as '' / undefined and the screens hide the column (see src/auth/access.tsx).
// ---------------------------------------------------------------------------
import { supabase } from './client';
import type {
  Activity,
  Bag,
  Dispatch,
  ERPState,
  FinishedGood,
  HardnessReport,
  Job,
  Movement,
  Product,
  QCRecord,
  RawInward,
  RawMaterialLot,
  StageRecord,
  JobWork,
} from '../store/types';
import { ROLES, type Level } from '../auth/access';
import { applyBarSizes, applyMaterialMaster } from '../store/materials';
import { defaultsOf } from '../masters/optionLists';
import type { Customer, MasterRow } from '../masters/types';
import { APP_RESOURCES, getAllDefaultPagesForRole, getPageOverrides } from '../auth/appResources';
import type { Die, DieData, HistoryEvent, IssueRecord, MaintenanceRecord, MainDie } from '../dies/types';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null ? undefined : Number(v));
const num0 = (v: unknown) => Number(v ?? 0);

async function read(source: string, order?: [string, boolean][], limit?: number): Promise<Row[]> {
  let q = supabase.from(source).select('*');
  for (const [col, asc] of order ?? []) q = q.order(col, { ascending: asc });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw new Error(`${source}: ${error.message}`);
  return (data ?? []) as Row[];
}

/** Reads the first source that exists (a masking view from a newer migration, else the older table). */
async function readFirst(sources: string[], order?: [string, boolean][]): Promise<Row[]> {
  let last: unknown;
  for (const s of sources) {
    try {
      return await read(s, order);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// -------------------------------------------------------------- masters ---
export interface Masters {
  /** party lists are confidential: empty for roles without access */
  suppliers: string[];
  customers: string[];
  machines: Record<'cutting' | 'forging' | 'trimming' | 'heatTreatment', string[]>;
  operators: string[];
  inspectors: string[];
  /** the customer master with all details (empty for roles without access to party names) */
  customerList: Customer[];
  /** every machine / operator / inspector, switched-off ones too — for Settings → Drop-down Lists */
  rows: { machines: MasterRow[]; operators: MasterRow[]; inspectors: MasterRow[] };
  /** the editable drop-down lists, by key (migration 42); a list never edited is not here — use useOptions() */
  options: Record<string, string[]>;
}

export async function loadMasters(): Promise<Masters> {
  const [suppliers, customers, machines, operators, inspectors] = await Promise.all([
    read('suppliers', [['name', true]]),
    read('customers', [['name', true]]),
    read('machines', [['name', true]]),
    read('operators', [['name', true]]),
    read('inspectors', [['name', true]]),
  ]);
  // migration 42 (customer details, editable lists, materials): older databases simply do not have them yet
  const extra = await Promise.all([
    supabase.from('dropdown_lists').select('list_key, items'),
    supabase.from('material_master').select('*').order('family').order('material'),
  ]);
  const options: Record<string, string[]> = {};
  for (const r of (extra[0].data ?? []) as Row[]) options[r.list_key] = (Array.isArray(r.items) ? r.items : []).map(String);
  const mats = ((extra[1].data ?? []) as Row[]).map((r) => ({ material: str(r.material), family: str(r.family), grade: str(r.grade), density: num0(r.density), defaultOd: num0(r.default_od) }));
  applyMaterialMaster(mats);
  applyBarSizes((options.od_size ?? defaultsOf('od_size')).map(Number).filter((n) => n > 0));
  const mapRows = (rows: Row[]): MasterRow[] => rows.map((r) => ({ id: num0(r.id), name: str(r.name), stage: r.stage ? str(r.stage) : undefined, active: r.active !== false }));
  const byStage = (s: string) => machines.filter((m) => m.stage === s && m.active !== false).map((m) => str(m.name));
  return {
    suppliers: suppliers.filter((r) => r.active !== false).map((r) => str(r.name)),
    customers: customers.filter((r) => r.active !== false).map((r) => str(r.name)),
    machines: { cutting: byStage('cutting'), forging: byStage('forging'), trimming: byStage('trimming'), heatTreatment: byStage('heatTreatment') },
    operators: operators.filter((r) => r.active !== false).map((r) => str(r.name)),
    inspectors: inspectors.filter((r) => r.active !== false).map((r) => str(r.name)),
    customerList: customers.map(
      (r): Customer => ({
        id: num0(r.id), name: str(r.name), code: str(r.code), contact: str(r.contact), phone: str(r.phone), email: str(r.email), address: str(r.address), city: str(r.city),
        state: str(r.state), gstin: str(r.gstin), paymentTerms: str(r.payment_terms), notes: str(r.notes), active: r.active !== false,
      }),
    ),
    rows: { machines: mapRows(machines), operators: mapRows(operators), inspectors: mapRows(inspectors) },
    options,
  };
}

// ------------------------------------------------------ production data ---
const toProduct = (r: Row): Product => ({
  id: r.id,
  code: r.code,
  name: r.name,
  material: r.material,
  od: num0(r.od),
  cuttingLength: num0(r.cutting_length),
  finishedWeight: num0(r.finished_weight),
  htTemperature: num0(r.ht_temperature),
  htSoakMinutes: num0(r.ht_soak_minutes),
  htProcess: str(r.ht_process),
  htQuench: str(r.ht_quench),
  dieNo: str(r.die_no),
  defaultCustomer: str(r.default_customer),
  salesRate: num(r.sales_rate),
});

const toLot = (r: Row): RawMaterialLot => ({
  id: r.id,
  material: r.material,
  materialType: str(r.material_type),
  od: num0(r.od),
  supplier: str(r.supplier),
  inwardDate: r.inward_date,
  heatNo: str(r.heat_no),
  invoiceNo: str(r.invoice_no),
  inwardQty: num0(r.inward_qty),
  inwardWeight: num0(r.inward_weight),
  availableQty: num0(r.available_qty),
  purchaseRate: num(r.purchase_rate),
  unit: 'PCS',
  // purchase-order link and incoming QC (migration 32): absent until it is installed
  blockedQty: r.blocked_qty == null ? undefined : num0(r.blocked_qty),
  qcStatus: r.qc_status ?? undefined,
  acceptedWeight: r.accepted_weight == null ? null : num0(r.accepted_weight),
  rejectedWeight: r.rejected_weight == null ? null : num0(r.rejected_weight),
  poId: r.po_id === undefined ? undefined : r.po_id == null ? null : num0(r.po_id),
  poItemId: r.po_item_id == null ? null : num0(r.po_item_id),
  poNo: r.po_no ?? undefined,
});

const toInward = (r: Row): RawInward => ({
  id: r.lot_id,
  lotId: r.lot_id,
  date: r.date,
  material: r.material,
  materialType: str(r.material_type),
  od: num0(r.od),
  supplier: str(r.supplier),
  qty: num0(r.qty),
  weight: num0(r.weight),
  invoiceNo: str(r.invoice_no),
  purchaseRate: num(r.purchase_rate),
});

const toStage = (r: Row): StageRecord => ({
  id: String(r.id),
  jobNo: r.job_no,
  stage: r.stage,
  input: num0(r.input_qty),
  loss: num0(r.loss_qty),
  output: num0(r.output_qty),
  status: r.status,
  receivedAt: r.received_at,
  startedAt: r.started_at ?? undefined,
  completedAt: r.completed_at ?? undefined,
  machine: str(r.machine),
  operator: str(r.operator),
  remarks: str(r.remarks),
  params: (r.params ?? {}) as Record<string, string | number>,
});

const toQC = (r: Row): QCRecord => ({
  id: String(r.id),
  jobNo: r.job_no,
  input: num0(r.input_qty),
  accepted: num0(r.accepted_qty),
  rejected: num0(r.rejected_qty),
  status: r.status,
  receivedAt: r.received_at,
  inspectedAt: r.inspected_at ?? undefined,
  inspector: str(r.inspector),
  rejectionReason: str(r.rejection_reason),
  remarks: str(r.remarks),
  checks: { dimensional: !!r.check_dimensional, visual: !!r.check_visual, hardness: !!r.check_hardness },
});

const toHardness = (r: Row): HardnessReport => ({
  id: r.id,
  jobNo: r.job_no ?? undefined,
  date: r.date,
  component: r.component,
  material: r.material,
  grade: str(r.grade),
  supplier: str(r.supplier),
  inwardQty: num0(r.inward_qty),
  inspectedQty: num0(r.inspected_qty),
  cycleNo: str(r.cycle_no),
  drawingNo: str(r.drawing_no),
  checkedBy: r.checked_by,
  scale: r.scale,
  min: num0(r.min_hardness),
  max: num0(r.max_hardness),
  readings: ((r.readings ?? []) as (number | string | null)[]).map((v) => (v == null ? null : Number(v))),
  remarks: str(r.remarks),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Job-work batches; empty when migration 26 has not been run yet. */
async function readJobWork(): Promise<Row[]> {
  try {
    return await read('v_job_work', [['created_at', true]]);
  } catch {
    return [];
  }
}

export async function loadERPState(): Promise<ERPState> {
  const [products, lots, inwards, jobs, issues, stages, qc, hardness, fg, disp, bags, mov, act, jobWork] = await Promise.all([
    read('v_products', [['code', true]]),
    read('v_lots', [['inward_date', true], ['id', true]]),
    read('v_raw_inwards', [['date', false], ['lot_id', false]]),
    read('v_jobs', [['created_at', true], ['job_no', true]]),
    read('job_material_issues', [['id', true]]),
    readFirst(['v_stage_records', 'stage_records'], [['id', true]]),
    readFirst(['v_qc_records', 'qc_records'], [['id', true]]),
    read('v_hardness_reports', [['date', true], ['id', true]]),
    read('v_finished_goods', [['received_at', true], ['id', true]]),
    read('v_dispatches', [['created_at', false], ['dispatch_no', false]]),
    read('dispatch_bags', [['bag_no', true]]),
    read('movements', [['ts', false], ['id', false]], 5000),
    read('activity', [['ts', false], ['id', false]], 300),
    readJobWork(),
  ]);

  const issuesByJob = new Map<string, Job['issues']>();
  for (const i of issues) {
    const list = issuesByJob.get(i.job_no) ?? [];
    list.push({ lotId: i.lot_id, qty: num0(i.qty), weight: num0(i.weight) });
    issuesByJob.set(i.job_no, list);
  }
  const bagsByDispatch = new Map<string, Bag[]>();
  for (const b of bags) {
    const list = bagsByDispatch.get(b.dispatch_no) ?? [];
    list.push({ no: num0(b.bag_no), qty: num0(b.qty), weight: num0(b.weight) });
    bagsByDispatch.set(b.dispatch_no, list);
  }

  const state: ERPState = {
    products: products.map(toProduct),
    rawMaterials: lots.map(toLot),
    rawInwards: inwards.map(toInward),
    jobs: jobs.map(
      (r): Job => ({
        jobNo: r.job_no,
        productId: r.product_id,
        customer: str(r.customer),
        plannedQty: num0(r.planned_qty),
        materialKey: `${r.material}|${num0(r.od)}`,
        createdAt: r.created_at,
        dueDate: r.due_date ?? '',
        priority: r.priority,
        currentStage: r.current_stage,
        issues: issuesByJob.get(r.job_no) ?? [],
        pieceWeightG: num(r.piece_weight_g),
        dieNo: r.die_no ?? undefined,
        machineNo: r.machine_no ?? undefined,
      }),
    ),
    cutting: [],
    forging: [],
    trimming: [],
    heatTreatment: [],
    qc: qc.map(toQC),
    hardnessReports: hardness.map(toHardness),
    finishedGoods: fg.map(
      (r): FinishedGood => ({
        id: r.id,
        jobNo: r.job_no,
        productId: r.product_id,
        qty: num0(r.qty),
        reservedQty: num0(r.reserved_qty),
        dispatchedQty: num0(r.dispatched_qty),
        receivedAt: r.received_at,
        location: str(r.location),
      }),
    ),
    dispatches: disp.map(
      (r): Dispatch => ({
        dispatchNo: r.dispatch_no,
        fgId: r.fg_id,
        jobNo: r.job_no,
        productId: r.product_id,
        customer: str(r.customer),
        qty: num0(r.qty),
        vehicleNo: str(r.vehicle_no),
        driver: str(r.driver),
        invoiceNo: str(r.invoice_no),
        date: r.date,
        bags: bagsByDispatch.get(r.dispatch_no) ?? [],
        weight: num0(r.weight),
        salesRate: num(r.sales_rate),
        status: r.status,
        createdAt: r.created_at,
        dispatchedAt: r.dispatched_at ?? undefined,
      }),
    ),
    movements: mov.map(
      (r): Movement => ({ id: String(r.id), ts: r.ts, jobNo: r.job_no ?? '—', from: r.from_loc, to: r.to_loc, qty: num0(r.qty), loss: num0(r.loss), note: str(r.note), enteredBy: str(r.entered_by), enteredAt: r.entered_at ?? undefined, kind: (r.kind as Movement['kind']) ?? 'move' }),
    ),
    activity: act.map((r): Activity => ({ id: String(r.id), ts: r.ts, jobNo: r.job_no ?? undefined, kind: r.kind, text: r.text })),
    jobWork: jobWork.map(
      (r): JobWork => ({
        jobNo: r.job_no,
        challanNo: str(r.challan_no),
        challanDate: str(r.challan_date),
        itemDescription: str(r.item_description),
        receivedQty: num0(r.received_qty),
        receivedWeight: num(r.received_weight),
        materialSource: r.material_source === 'own' ? 'own' : 'customer',
        processes: { cutting: !!r.do_cutting, forging: !!r.do_forging, trimming: !!r.do_trimming, heatTreatment: !!r.do_heat_treatment },
        qcRequired: !!r.qc_required,
        chargeBasis: (['piece', 'kg', 'process'].includes(r.charge_basis) ? r.charge_basis : 'none') as JobWork['chargeBasis'],
        rate: num(r.rate),
        processRates: r.process_rates && typeof r.process_rates === 'object' ? (r.process_rates as Record<string, number>) : undefined,
        billableQty: num0(r.billable_qty),
        amount: num(r.amount),
        createdAt: str(r.created_at),
      }),
    ),
    counters: { job: 0, dispatch: 0, lot: 0, fg: 0, seq: 0 }, // numbering is done by the database
  };
  for (const r of stages.map(toStage)) (state[r.stage] as StageRecord[]).push(r);
  return state;
}

// ----------------------------------------------------------------- dies ---
const dims = (l: unknown, w: unknown, h: unknown) => ({ l: num(l), w: num(w), h: num(h) });

export async function loadDieData(): Promise<DieData> {
  const [mains, dies, hist, maint, issues] = await Promise.all([
    read('v_main_dies', [['code', true]]),
    read('v_dies', [['code', true]]),
    read('die_history', [['at', true], ['id', true]]),
    read('die_maintenance', [['id', true]]),
    read('die_issues', [['id', true]]),
  ]);

  const mapDie = (r: Row): Die => ({
    code: r.code,
    kind: r.kind,
    mainCode: r.main_code,
    material: r.material,
    top: dims(r.top_l, r.top_w, r.top_h),
    bottom: dims(r.bottom_l, r.bottom_w, r.bottom_h),
    topWeight: num(r.top_weight),
    bottomWeight: num(r.bottom_weight),
    makingDate: r.making_date,
    maker: str(r.maker),
    drawingNo: str(r.drawing_no),
    revision: str(r.revision),
    topImg: r.top_img_path ?? undefined,
    bottomImg: r.bottom_img_path ?? undefined,
    status: r.status,
    remarks: str(r.remarks),
    location: str(r.location),
    cost: num(r.cost),
    pieces: num0(r.pieces),
    lastMaintDate: r.last_maint_date ?? undefined,
    maintRemarks: r.maint_remarks ?? undefined,
    replacesCode: r.replaces_code ?? undefined,
    replacedByCode: r.replaced_by_code ?? undefined,
    demo: !!r.is_demo,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const all = dies.map(mapDie);
  const kindOf = new Map(all.map((d) => [d.code, d.kind]));

  // die pictures live in a private Storage bucket: the app gets short-lived signed links for the paths it needs
  const images: Record<string, string> = {};
  const paths = [...new Set(all.flatMap((d) => [d.topImg, d.bottomImg]).filter((p): p is string => !!p))];
  if (paths.length) {
    const { data } = await supabase.storage.from('die-images').createSignedUrls(paths, 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) images[s.path] = s.signedUrl;
  }

  return {
    mainDies: mains.map(
      (r): MainDie => ({
        code: r.code,
        name: r.name,
        partCode: r.part_code,
        description: str(r.description),
        customer: str(r.customer),
        metal: r.metal,
        createdOn: r.created_on,
        status: r.status,
        remarks: str(r.remarks),
        demo: !!r.is_demo,
      }),
    ),
    forgingDies: all.filter((d) => d.kind === 'forging'),
    trimmingDies: all.filter((d) => d.kind === 'trimming'),
    history: hist.map((r): HistoryEvent => ({ id: String(r.id), at: r.at, date: r.date, kind: r.kind, dieCode: r.die_code, mainCode: r.main_code, event: r.event, remarks: str(r.remarks), demo: !!r.is_demo })),
    maintenance: maint.map((r): MaintenanceRecord => ({ id: String(r.id), kind: kindOf.get(r.die_code) ?? 'forging', dieCode: r.die_code, date: r.date, remarks: r.remarks, demo: !!r.is_demo })),
    issues: issues.map(
      (r): IssueRecord => ({
        id: String(r.id),
        kind: kindOf.get(r.die_code) ?? 'forging',
        dieCode: r.die_code,
        issuedOn: r.issued_on,
        issuedTo: r.issued_to,
        remarks: str(r.remarks),
        returnedOn: r.returned_on ?? undefined,
        pieces: num(r.pieces),
        returnRemarks: r.return_remarks ?? undefined,
        demo: !!r.is_demo,
      }),
    ),
    images,
  };
}

// ------------------------------------------------------- access settings ---
export interface AccessMatrix {
  resources: { key: string; label: string; section: string; sort: number; writable: boolean }[];
  groups: { key: string; label: string; description: string; sort: number; isCustom: boolean; catalogKey?: string }[];
  /** columns an admin can still add to the sensitive list */
  catalog: { key: string; label: string; pageLabel: string; sort: number }[];
  /** role → page key → level */
  pages: Record<string, Record<string, Level>>;
  /** role → information type → visible */
  fields: Record<string, Record<string, boolean>>;
}

/** The full settings matrix. Only the Director / Plant Head can read it (database policy). */
export async function loadAccessMatrix(): Promise<AccessMatrix> {
  const [res, grp, cat, pages, fields] = await Promise.all([
    read('app_resources', [['sort', true]]).catch(() => [] as Row[]),
    read('field_groups', [['sort', true]]),
    read('column_catalog', [['sort', true]]).catch(() => [] as Row[]), // migration 19 not installed yet → no catalog
    read('role_page_access').catch(() => [] as Row[]),
    read('role_field_access').catch(() => [] as Row[]),
  ]);

  // Master definition of resources from TypeScript:
  // APP_RESOURCES is the source of truth for code-supported pages.
  // Any newly added page in TS appears immediately, and removed demo pages are omitted.
  const dbResMap = new Map(res.map((r) => [r.key, r]));
  const resources = APP_RESOURCES.map((appRes) => {
    const dbRes = dbResMap.get(appRes.key);
    return {
      key: appRes.key,
      label: dbRes?.label ?? appRes.label,
      section: (dbRes?.section ?? appRes.section) as string,
      sort: dbRes?.sort ?? appRes.sort,
      writable: appRes.writable,
    };
  }).sort((a, b) => a.sort - b.sort);

  const overrides = getPageOverrides();
  const m: AccessMatrix = {
    resources,
    groups: grp.map((g) => ({ key: g.key, label: g.label, description: g.description, sort: g.sort, isCustom: !!g.is_custom, catalogKey: g.catalog_key ?? undefined })),
    catalog: cat.map((c) => ({ key: c.key, label: c.label, pageLabel: c.page_label, sort: c.sort })),
    pages: {},
    fields: {},
  };

  // Seed default levels from TypeScript for all roles
  for (const r of ROLES) {
    m.pages[r.value] = getAllDefaultPagesForRole(r.value);
    if (overrides[r.value]) {
      Object.assign(m.pages[r.value], overrides[r.value]);
    }
  }

  // Overlay saved database permissions (persisted DB values take precedence)
  for (const p of pages) {
    (m.pages[p.role] ??= {})[p.resource] = p.level;
  }
  for (const f of fields) {
    (m.fields[f.role] ??= {})[f.field_group] = !!f.visible;
  }
  return m;
}
