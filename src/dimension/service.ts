import { dbMessage, supabase } from '../db/client';
import { SAMPLES, blankSamples, type DimLine, type DimReport } from './types';

const notSetUp = (m: string) => /v_dimension_reports|save_dimension_report|delete_dimension_report|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'Dimension reports are not set up in the database yet. Run migration 55 in the Supabase SQL editor.' : dbMessage(e as never));
};

const line = (x: Partial<DimLine>): DimLine => ({
  kind: x.kind ?? 'measure',
  parameter: x.parameter ?? '',
  instrument: x.instrument ?? '',
  spec: x.spec ?? '',
  usl: x.usl ?? '',
  lsl: x.lsl ?? '',
  samples: Array.from({ length: SAMPLES }, (_, i) => x.samples?.[i] ?? ''),
  result: x.result ?? '',
});

export async function fetchDimensionReports(): Promise<DimReport[]> {
  const { data, error } = await supabase.from('v_dimension_reports').select('*').order('report_date', { ascending: false }).order('id', { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    reportNo: r.report_no as string,
    reportDate: (r.report_date as string) ?? '',
    itemName: (r.item_name as string) ?? '',
    itemNo: (r.item_no as string) ?? '',
    customer: (r.customer as string) ?? '',
    invoiceDate: (r.invoice_date as string) ?? '',
    invoiceQty: (r.invoice_qty as string) ?? '',
    dieNo: (r.die_no as string) ?? '',
    jobNo: (r.job_no as string) ?? '',
    lines: ((r.lines as Partial<DimLine>[]) ?? []).map(line),
    conclusion: (r.conclusion as string) ?? '',
    customerApproval: (r.customer_approval as string) ?? '',
    remarks: (r.remarks as string) ?? '',
    checkedBy: (r.checked_by as string) ?? '',
    reviewedBy: (r.reviewed_by as string) ?? '',
    createdBy: (r.created_by as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  }));
}

export type DimInput = Omit<DimReport, 'id' | 'createdBy' | 'updatedAt'>;

export async function saveDimensionReport(id: number | null, i: DimInput, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_dimension_report', {
    p_id: id,
    p_payload: {
      report_no: i.reportNo,
      report_date: i.reportDate || null,
      item_name: i.itemName,
      item_no: i.itemNo,
      customer: i.customer,
      invoice_date: i.invoiceDate || null,
      invoice_qty: i.invoiceQty,
      die_no: i.dieNo,
      job_no: i.jobNo,
      lines: i.lines.map((l) => ({ ...l, samples: l.samples.slice(0, SAMPLES) })),
      conclusion: i.conclusion,
      customer_approval: i.customerApproval,
      remarks: i.remarks,
      checked_by: i.checkedBy,
      reviewed_by: i.reviewedBy,
    },
    p_user: user,
  });
  fail(error);
  return Number(data);
}

export async function deleteDimensionReport(id: number) {
  fail((await supabase.rpc('delete_dimension_report', { p_id: id })).error);
}

export { blankSamples };
