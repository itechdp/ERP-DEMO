/**
 * QC → Dimension Report (the final inspection sheet).
 *  measure — a number with its tolerance: specification, upper / lower limit, five observed values; the result is worked out (OK when every
 *            observation is between the lower and the upper limit)
 *  text    — "as per program", radius, … : the specification and the observations are text, the result is chosen by hand
 *  gonogo  — a go / no-go gauge: the tolerance cells read "Go & Nogo" and each observation is OK / NOT OK
 */
export type LineKind = 'measure' | 'text' | 'gonogo';
export const SAMPLES = 5;

export interface DimLine {
  kind: LineKind;
  parameter: string;
  instrument: string;
  spec: string;
  usl: string;
  lsl: string;
  samples: string[];
  /** only used by text lines (measure and go / no-go lines are worked out) */
  result: '' | 'OK' | 'NOT OK';
}

export interface DimReport {
  id: number;
  reportNo: string;
  reportDate: string;
  itemName: string;
  itemNo: string;
  customer: string;
  invoiceDate: string;
  invoiceQty: string;
  dieNo: string;
  jobNo: string;
  lines: DimLine[];
  conclusion: string;
  customerApproval: string;
  remarks: string;
  checkedBy: string;
  reviewedBy: string;
  createdBy: string;
  updatedAt: string;
}

export const CONCLUSIONS = ['Lot Accepted', 'Lot Rejected', 'Accepted Under deviation'] as const;
export const INSTRUMENTS = ['Vernier', 'Height Gauge', 'Depth Gauge', 'Micrometer', 'TPG', 'Plug Gauge', 'Profile Projector', 'AS PER PROGRAM'];

export const blankSamples = () => Array.from({ length: SAMPLES }, () => '');
export const blankLine = (kind: LineKind = 'measure'): DimLine => ({ kind, parameter: '', instrument: kind === 'text' ? 'AS PER PROGRAM' : kind === 'gonogo' ? 'TPG' : 'Vernier', spec: '', usl: '', lsl: '', samples: blankSamples(), result: kind === 'text' ? 'OK' : '' });

const num = (v: string) => (v.trim() === '' ? NaN : Number(v));

/** one observation: true = within limits, false = outside, null = not entered */
export function sampleOk(line: DimLine, v: string): boolean | null {
  if (v.trim() === '') return null;
  if (line.kind === 'gonogo') return v.trim().toUpperCase() === 'OK';
  if (line.kind === 'text') return null;
  const x = num(v);
  if (!Number.isFinite(x)) return false;
  const hi = num(line.usl);
  const lo = num(line.lsl);
  return !(Number.isFinite(hi) && x > hi) && !(Number.isFinite(lo) && x < lo);
}

/** the result shown for a line */
export function lineResult(line: DimLine): '' | 'OK' | 'NOT OK' {
  if (line.kind === 'text') return line.result;
  const res = line.samples.map((s) => sampleOk(line, s));
  if (res.includes(false)) return 'NOT OK';
  return res.includes(true) ? 'OK' : '';
}

/** a number as the sheet prints it: the specification and limits keep the decimals typed ("90.0", "17.50") */
export const show = (v: string) => v;
