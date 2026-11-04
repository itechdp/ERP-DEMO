// ---------------------------------------------------------------------------
// TypeScript Page & Resource Registry Layer
//
// This is the single source of truth for all pages and resources in the ERP.
// Adding, updating, or removing pages here immediately updates:
//   1. Sidebar navigation & page routing
//   2. Route permission checks (Hidden / Read / Write)
//   3. Settings → Access Control matrix (WITHOUT needing to run SQL for every change)
//   4. Default role permissions
// ---------------------------------------------------------------------------

import type { Role, Level } from './access';

export type ResourceSection =
  | 'Main Menu'
  | 'Sales & Orders'
  | 'Purchase & Procurement'
  | 'Workflow'
  | 'Die Management'
  | 'Reports & Masters';

export interface AppResourceDefinition {
  /** Database/permission resource key (e.g. 'purchase_dashboard') */
  key: string;
  /** Sidebar / URL route (e.g. 'purchase-dashboard') */
  route: string;
  /** Human-readable page label */
  label: string;
  /** Grouping section in sidebar and Access Control */
  section: ResourceSection;
  /** Numerical ordering in Access Control matrix */
  sort: number;
  /** Whether the page has actions/editing (Write vs Read is distinct) */
  writable: boolean;
  /** Optional role-specific defaults (overrides general rule) */
  defaultLevels?: Partial<Record<Role, Level>>;
}

const BASE_RESOURCES: AppResourceDefinition[] = [
  // --------------------------------------------------------- Main Menu ---
  {
    key: 'dashboard',
    route: 'dashboard',
    label: 'Dashboard',
    section: 'Main Menu',
    sort: 10,
    writable: false,
  },
  {
    key: 'work_hub',
    route: 'work-hub',
    label: 'Work Hub',
    section: 'Main Menu',
    sort: 12,
    writable: true,
    defaultLevels: { viewer: 'read' },
  },
  {
    key: 'followups',
    route: 'follow-ups',
    label: 'Follow-ups',
    section: 'Main Menu',
    sort: 11,
    writable: false,
    defaultLevels: { qc: 'hidden', operator: 'hidden' },
  },
  {
    key: 'workflow_overview',
    route: 'workflow-overview',
    label: 'Workflow Overview',
    section: 'Main Menu',
    sort: 13,
    writable: false,
    defaultLevels: { accounts: 'hidden', qc: 'hidden', operator: 'hidden', viewer: 'hidden' },
  },

  // ---------------------------------------------------- Sales & Orders ---
  {
    key: 'customers',
    route: 'customers',
    label: 'Customers',
    section: 'Sales & Orders',
    sort: 10,
    writable: true,
    defaultLevels: { qc: 'hidden', operator: 'hidden', viewer: 'read' },
  },
  {
    key: 'sales_dashboard',
    route: 'sales-dashboard',
    label: 'Sales Dashboard',
    section: 'Sales & Orders',
    sort: 11,
    writable: false,
    defaultLevels: { operator: 'hidden' },
  },
  {
    key: 'sales_quotation',
    route: 'sales-quotation',
    label: 'Sales Quotations',
    section: 'Sales & Orders',
    sort: 12,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'quotation_approvals',
    route: 'quotation-approvals',
    label: 'Quotation Approvals',
    section: 'Sales & Orders',
    sort: 14,
    writable: true,
    defaultLevels: { plant_head: 'read', accounts: 'read', viewer: 'read', qc: 'hidden', operator: 'hidden' },
  },
  {
    key: 'sales_reports',
    route: 'sales-reports',
    label: 'Sales Reports',
    section: 'Sales & Orders',
    sort: 19,
    writable: false,
    defaultLevels: { accounts: 'read', operator: 'hidden', qc: 'hidden' },
  },
  {
    key: 'inquiries',
    route: 'inquiry',
    label: 'Sales Opportunities & Enquiries',
    section: 'Sales & Orders',
    sort: 14,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_orders',
    route: 'purchase-order',
    label: 'Customer Purchase Orders',
    section: 'Sales & Orders',
    sort: 15,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'sales_orders',
    route: 'sales-order',
    label: 'Sales Orders',
    section: 'Sales & Orders',
    sort: 16,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'task_assignment',
    route: 'task-assignment',
    label: 'Order Task Assignment',
    section: 'Sales & Orders',
    sort: 18,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },

  // -------------------------------------------- Purchase & Procurement ---
  {
    key: 'purchase_dashboard',
    route: 'purchase-dashboard',
    label: 'Purchase Dashboard',
    section: 'Purchase & Procurement',
    sort: 19,
    writable: false,
    defaultLevels: { accounts: 'read', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'procurement_po',
    route: 'purchase-orders',
    label: 'Purchase Orders',
    section: 'Purchase & Procurement',
    sort: 20,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_approvals',
    route: 'purchase-approvals',
    label: 'Purchase Approvals',
    section: 'Purchase & Procurement',
    sort: 21,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'write' },
  },
  {
    key: 'suppliers',
    route: 'suppliers',
    label: 'Suppliers & Vendors',
    section: 'Purchase & Procurement',
    sort: 22,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_requisitions',
    route: 'purchase-requisitions',
    label: 'Purchase Requisitions',
    section: 'Purchase & Procurement',
    sort: 23,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'read', qc: 'read' },
  },
  {
    key: 'rfq',
    route: 'rfqs',
    label: 'Procurement of Material',
    section: 'Purchase & Procurement',
    sort: 24,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'supplier_quotations',
    route: 'supplier-quotations',
    label: 'Supplier Quotations',
    section: 'Purchase & Procurement',
    sort: 25,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_reports',
    route: 'purchase-reports',
    label: 'Purchase Reports',
    section: 'Purchase & Procurement',
    sort: 26,
    writable: false,
    defaultLevels: { accounts: 'read', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_invoices',
    route: 'purchase-invoices',
    label: 'Purchase Invoices',
    section: 'Purchase & Procurement',
    sort: 28,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'read' },
  },
  {
    key: 'purchase_payments',
    route: 'purchase-payments',
    label: 'Purchase Payments',
    section: 'Purchase & Procurement',
    sort: 29,
    writable: true,
    defaultLevels: { accounts: 'write', operator: 'hidden', qc: 'hidden' },
  },
  {
    key: 'supplier_payables',
    route: 'supplier-payables',
    label: 'Supplier Payables',
    section: 'Purchase & Procurement',
    sort: 30,
    writable: false,
    defaultLevels: { accounts: 'read', operator: 'hidden', qc: 'hidden' },
  },
  {
    key: 'supplier_performance',
    route: 'supplier-performance',
    label: 'Supplier Performance',
    section: 'Purchase & Procurement',
    sort: 27,
    writable: false,
    defaultLevels: { accounts: 'read', operator: 'hidden', qc: 'read' },
  },

  // ---------------------------------------------------------- Workflow ---
  {
    key: 'raw_inventory',
    route: 'raw-inventory',
    label: 'Raw Material Inventory',
    section: 'Main Menu',
    sort: 13,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'cutting',
    route: 'cutting',
    label: 'Cutting Process',
    section: 'Workflow',
    sort: 40,
    writable: true,
    defaultLevels: { operator: 'write', qc: 'read' },
  },
  {
    key: 'forging',
    route: 'forging',
    label: 'Forging Process',
    section: 'Workflow',
    sort: 50,
    writable: true,
    defaultLevels: { operator: 'write', qc: 'read' },
  },
  {
    key: 'trimming',
    route: 'trimming',
    label: 'Trimming Process',
    section: 'Workflow',
    sort: 60,
    writable: true,
    defaultLevels: { operator: 'write', qc: 'read' },
  },
  {
    key: 'instruction',
    route: 'instruction',
    label: 'Instruction',
    section: 'Workflow',
    sort: 65,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'heat_treatment',
    route: 'heat-treatment',
    label: 'Heat Treatment',
    section: 'Workflow',
    sort: 70,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'write' },
  },
  {
    key: 'cnc',
    route: 'cnc',
    label: 'Machinery · CNC',
    section: 'Workflow',
    sort: 77,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'vmc',
    route: 'vmc',
    label: 'Machinery · VMC',
    section: 'Workflow',
    sort: 78,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'qc',
    route: 'qc',
    label: 'Quality Control (QC)',
    section: 'Workflow',
    sort: 80,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'write' },
  },
  {
    key: 'finished_goods',
    route: 'finished-goods',
    label: 'Finished Goods Inventory',
    section: 'Workflow',
    sort: 90,
    writable: false,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'dispatch',
    route: 'dispatch',
    label: 'Dispatch',
    section: 'Workflow',
    sort: 100,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'production_planning',
    route: 'production-planning',
    label: 'Heat Treatment Planning',
    section: 'Workflow',
    sort: 105,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'furnaces',
    route: 'furnaces',
    label: 'Furnace Management',
    section: 'Workflow',
    sort: 106,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'job_work',
    route: 'job-work',
    label: 'Job Work In',
    section: 'Workflow',
    sort: 110,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'job_work_out',
    route: 'job-work-out',
    label: 'Job Work Out',
    section: 'Workflow',
    sort: 111,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },

  // ---------------------------------------------------- Die Management ---
  {
    key: 'die_master',
    route: 'die-master',
    label: 'Die Master',
    section: 'Die Management',
    sort: 120,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'forging_dies',
    route: 'forging-die-master',
    label: 'Forging Dies',
    section: 'Die Management',
    sort: 130,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'trimming_dies',
    route: 'trimming-die-master',
    label: 'Trimming Dies',
    section: 'Die Management',
    sort: 140,
    writable: true,
    defaultLevels: { operator: 'read', qc: 'read' },
  },
  {
    key: 'die_details',
    route: 'die-details',
    label: 'Die Analytics & History',
    section: 'Die Management',
    sort: 150,
    writable: false,
    defaultLevels: { operator: 'read', qc: 'read' },
  },

  // ------------------------------------------------- Reports & Masters ---
  {
    key: 'traceability',
    route: 'traceability',
    label: 'Job Traceability',
    section: 'Reports & Masters',
    sort: 160,
    writable: false,
    defaultLevels: { operator: 'hidden' },
  },
  {
    key: 'ledger',
    route: 'ledger',
    label: 'Quantity Ledger',
    section: 'Reports & Masters',
    sort: 170,
    writable: false,
    defaultLevels: { operator: 'hidden' },
  },
  {
    key: 'products',
    route: 'products',
    label: 'Product Master',
    section: 'Reports & Masters',
    sort: 180,
    writable: true,
    defaultLevels: { accounts: 'write', qc: 'read', operator: 'read', viewer: 'read' },
  },
];

/**
 * The tabs of the pages that have them. Each is its own item in Settings → Access Control, listed under its page as "Page › Tab" and keyed
 * `<page key>__<tab key>`; a role that is given a page can still be refused a tab. A tab that has no setting yet follows its page.
 */
export const PAGE_TABS: Record<string, { key: string; label: string }[]> = {
  work_hub: [{ key: 'overview', label: 'Work Hub' }, { key: 'mytasks', label: 'My Tasks' }],
  qc: [{ key: 'register', label: 'Inspection Register' }, { key: 'hardness', label: 'Hardness Reports' }, { key: 'dimension', label: 'Dimension Reports' }],
  job_work: [{ key: 'batches', label: 'Job Work In' }, { key: 'report', label: 'Job Card Report' }],
  raw_inventory: [{ key: 'stock', label: 'Raw Material Stock' }, { key: 'inward', label: 'Inward Register' }, { key: 'issues', label: 'Issues to Production' }],
  die_details: [{ key: 'forging', label: 'Forging Dies' }, { key: 'trimming', label: 'Trimming Dies' }, { key: 'history', label: 'Die History' }, { key: 'images', label: 'Images & Drawings' }],
  procurement_po: [{ key: 'items', label: 'Items & Receipt Progress' }, { key: 'receipts', label: 'Receipts' }, { key: 'approvals', label: 'Approval Trail' }, { key: 'revisions', label: 'Revision History' }],
  purchase_invoices: [{ key: 'lines', label: 'Lines & Three-way Match' }, { key: 'payments', label: 'Payments' }],
  quotation_approvals: [{ key: 'pending', label: 'Waiting for approval' }, { key: 'decided', label: 'Decided' }],
};

const TAB_RESOURCES: AppResourceDefinition[] = BASE_RESOURCES.flatMap((p) =>
  (PAGE_TABS[p.key] ?? []).map((t) => ({
    key: `${p.key}__${t.key}`,
    route: `${p.route}#${t.key}`, // never opened as a page; only keeps the key / route lists one-to-one
    label: `${p.label} › ${t.label}`,
    section: p.section,
    sort: p.sort,
    writable: true,
    ...(p.key === 'work_hub' && t.key === 'overview' ? { defaultLevels: { plant_head: 'write', accounts: 'hidden', qc: 'hidden', operator: 'hidden', viewer: 'hidden' } as AppResourceDefinition['defaultLevels'] } : {}),
  })),
);

export const APP_RESOURCES: AppResourceDefinition[] = [...BASE_RESOURCES, ...TAB_RESOURCES];

/** Route → Resource Key map (e.g. 'purchase-dashboard' → 'purchase_dashboard') */
export const ROUTE_RESOURCE: Record<string, string> = {
  ...Object.fromEntries(APP_RESOURCES.map((r) => [r.route, r.key])),
};

/** Resource Key → Route map */
export const RESOURCE_ROUTE: Record<string, string> = Object.fromEntries(
  APP_RESOURCES.map((r) => [r.key, r.route])
);

/** Set of page keys where Write vs Read is distinct */
export const WRITABLE_PAGES: Set<string> = new Set(
  APP_RESOURCES.filter((r) => r.writable).map((r) => r.key)
);

/** Get the default access level for a role on a given resource key */
export function getDefaultPageLevel(role: Role, key: string): Level {
  const def = APP_RESOURCES.find((r) => r.key === key);
  if (!def) return 'hidden';

  // Director always has full write (or read if page is view-only)
  if (role === 'director') return def.writable ? 'write' : 'read';

  // Viewer is always read-only
  if (role === 'viewer') return 'read';

  // Check role override if declared in APP_RESOURCES
  if (def.defaultLevels?.[role]) {
    const lvl = def.defaultLevels[role]!;
    // For non-admin roles, default without a database row is at most 'read' (never 'write').
    // Write access must come from a saved database entry so UI and database functions agree.
    return lvl === 'write' ? 'read' : lvl;
  }

  // Fallback if page has no write operations
  if (!def.writable) return 'read';

  // For non-admin roles without a database entry, default to at most 'read'
  return 'read';
}

/** Get default dictionary of all page levels for a given role */
export function getAllDefaultPagesForRole(role: Role): Record<string, Level> {
  const pages: Record<string, Level> = {};
  for (const r of APP_RESOURCES) {
    pages[r.key] = getDefaultPageLevel(role, r.key);
  }
  return pages;
}

// -------------------------------------------------- Local Overrides ---
// Used when an admin changes access for a page that isn't yet present in DB
// app_resources table, so settings are saved instantly without any SQL error.
const OVERRIDES_STORAGE_KEY = 'forgeflow.page_access_overrides';

export function getPageOverrides(): Partial<Record<Role, Record<string, Level>>> {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveLocalPageOverride(role: Role, key: string, level: Level): void {
  try {
    const all = getPageOverrides();
    all[role] = { ...(all[role] || {}), [key]: level };
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore localStorage errors */
  }
}

export function clearLocalPageOverrides(role?: Role): void {
  try {
    if (!role) {
      localStorage.removeItem(OVERRIDES_STORAGE_KEY);
      return;
    }
    const all = getPageOverrides();
    delete all[role];
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}
