// The link between a die and production: a job card names its (forging) die, and the pieces its Forging process finished are the pieces
// that die has produced. Migration 68 adds them to the die's total when the Forging is completed, so the return form only takes pieces made
// outside a job card; this lists what production recorded.
import type { ERPState } from '../store/types';

export interface DieJobUse {
  jobNo: string;
  product: string;
  pieces: number;
  lastAt: string;
}

/** job cards that name this die, with the pieces their Forging finished (only those finished on/after `since`, yyyy-mm-dd) */
export function jobsOnDie(state: ERPState, code: string, since?: string): DieJobUse[] {
  const out: DieJobUse[] = [];
  for (const j of state.jobs) {
    if ((j.dieNo ?? '').trim().toLowerCase() !== code.toLowerCase()) continue;
    const done = state.forging.filter((r) => r.jobNo === j.jobNo && r.status === 'Completed' && (!since || (r.completedAt ?? '').slice(0, 10) >= since));
    if (!done.length) continue;
    out.push({
      jobNo: j.jobNo,
      product: state.products.find((p) => p.id === j.productId)?.name ?? '',
      pieces: done.reduce((t, r) => t + r.output, 0),
      lastAt: done.map((r) => r.completedAt ?? '').sort().pop() ?? '',
    });
  }
  return out;
}
