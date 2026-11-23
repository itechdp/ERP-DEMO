import { fmtNum } from '../components/format';
import type { JobWork } from '../store/types';

/** what a job-work receipt line is, e.g. "Round Bar · Brass · Ø70 mm" (empty for batches saved before migration 91) */
export const lineText = (w: JobWork) => [w.itemName, w.material, w.sizeMm ? `Ø${fmtNum(w.sizeMm)} mm` : ''].filter(Boolean).join(' · ');
