// ---------------------------------------------------------------------------
// Every create / edit form (raw inward, job card, product, stage entry, QC, hardness report, dispatch, and the die forms) is a
// full page with its own address:   #/form/inward?material=…   #/dieform/die?kind=forging&code=…
// This file turns a form request into that address and back, and remembers where to return to.
// ---------------------------------------------------------------------------
import type { Action } from './StoreContext';
import type { ProcessStage } from './types';
import type { DieUI } from '../dies/DieContext';
import type { DieKind } from '../dies/types';

const STAGES: ProcessStage[] = ['cutting', 'forging', 'trimming', 'heatTreatment', 'cnc', 'vmc'];
const STAGE_ROUTE: Record<ProcessStage, string> = { cutting: 'cutting', forging: 'forging', trimming: 'trimming', heatTreatment: 'heat-treatment', cnc: 'cnc', vmc: 'vmc' };

const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** the address of a shop-floor form */
export function actionToHash(a: Action): string {
  switch (a.kind) {
    case 'newJob':
      return 'form/new-job';
    case 'jobWork':
      return 'form/job-work';
    case 'product':
      return 'form/product' + qs({ id: a.id, view: a.view ? 1 : undefined });
    case 'inward':
      return 'form/inward' + qs({ material: a.material, od: a.od, id: a.id, view: a.view ? 1 : undefined });
    case 'stage':
      return 'form/stage' + qs({ job: a.jobNo, stage: a.stage });
    case 'qc':
      return 'form/qc' + qs({ job: a.jobNo });
    case 'hardness':
      return 'form/hardness' + qs({ id: a.id, job: a.jobNo, view: a.view ? 1 : undefined });
    case 'dispatch':
      return 'form/dispatch' + qs({ fg: a.fgId });
    default:
      return '';
  }
}

export function hashToAction(route: string, q: URLSearchParams): Action | null {
  switch (route) {
    case 'form/new-job':
      return { kind: 'newJob' };
    case 'form/job-work':
      return { kind: 'jobWork' };
    case 'form/product':
      return { kind: 'product', id: q.get('id') ?? undefined, view: q.get('view') === '1' };
    case 'form/inward': {
      const od = Number(q.get('od'));
      return { kind: 'inward', material: q.get('material') ?? undefined, od: od > 0 ? od : undefined, id: q.get('id') ?? undefined, view: q.get('view') === '1' };
    }
    case 'form/stage': {
      const stage = q.get('stage') as ProcessStage | null;
      const job = q.get('job');
      return stage && job && STAGES.includes(stage) ? { kind: 'stage', stage, jobNo: job } : null;
    }
    case 'form/qc':
      return q.get('job') ? { kind: 'qc', jobNo: q.get('job')! } : null;
    case 'form/hardness':
      return { kind: 'hardness', id: q.get('id') ?? undefined, jobNo: q.get('job') ?? undefined, view: q.get('view') === '1' };
    case 'form/dispatch':
      return { kind: 'dispatch', fgId: q.get('fg') ?? '' };
    default:
      return null;
  }
}

/** the list page a form belongs to (highlighted in the menu, and where Back goes when there is no history) */
export function actionParent(a: Action): string {
  switch (a.kind) {
    case 'newJob':
      return 'cutting';
    case 'jobWork':
      return 'job-work';
    case 'product':
      return 'products';
    case 'inward':
      return 'raw-inventory';
    case 'stage':
      return STAGE_ROUTE[a.stage];
    case 'dispatch':
      return 'dispatch';
    default:
      return 'qc';
  }
}

const DIE_PAGE_KINDS = ['replace', 'maintenance', 'issue', 'return'] as const;

/** the address of a die form ('' for the die viewer, which stays a pop-up) */
export function dieUiToHash(u: DieUI): string {
  switch (u.kind) {
    case 'main-form':
      return 'dieform/main' + qs({ code: u.code });
    case 'die-form':
      return 'dieform/die' + qs({ kind: u.dieKind, code: u.code, main: u.mainCode });
    case 'die-view':
      return '';
    default:
      return `dieform/${u.kind}` + qs({ kind: u.dieKind, code: u.code });
  }
}

export function hashToDieUi(route: string, q: URLSearchParams): DieUI | null {
  const kind = q.get('kind') === 'trimming' ? 'trimming' : q.get('kind') === 'forging' ? 'forging' : null;
  const code = q.get('code') ?? undefined;
  if (route === 'dieform/main') return { kind: 'main-form', code };
  if (route === 'dieform/die') return kind ? { kind: 'die-form', dieKind: kind, code, mainCode: q.get('main') ?? undefined } : null;
  for (const k of DIE_PAGE_KINDS) if (route === `dieform/${k}`) return kind && code ? { kind: k, dieKind: kind as DieKind, code } : null;
  return null;
}

export function dieUiParent(u: DieUI): string {
  return u.kind === 'main-form' ? 'die-master' : u.dieKind === 'forging' ? 'forging-die-master' : 'trimming-die-master';
}

export const isFormRoute = (route: string) => route.startsWith('form/') || route.startsWith('dieform/');

/** the list page behind a form address (null when the address is not a form) */
export function formParent(route: string, q: URLSearchParams): string | null {
  const a = hashToAction(route, q);
  if (a) return actionParent(a);
  const d = hashToDieUi(route, q);
  return d ? dieUiParent(d) : null;
}

// Back goes one step in the browser history when the form was opened from inside the app (so the list is exactly as it was
// left); a form opened from a typed / shared address goes to its list page instead.
let openedInApp = false;

export function openForm(hash: string) {
  openedInApp = true;
  window.location.hash = `/${hash}`;
  window.scrollTo({ top: 0 });
}

/** leave a form for some OTHER page (not its list): no browser "back" step, which would land after the new address and cancel it */
export function leaveForm(route: string) {
  openedInApp = false;
  window.location.hash = `/${route}`;
  window.scrollTo({ top: 0 });
}

export function closeForm(parent: string) {
  if (openedInApp) {
    openedInApp = false;
    window.history.back();
  }
  else window.location.hash = `/${parent}`;
}
