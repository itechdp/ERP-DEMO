import { useCallback, useEffect, useState } from 'react';
import { useAccess } from '../auth/access';
import { dbMessage, supabase } from '../db/client';

/** Workflow → Instruction: work instructions per process (and, if wanted, per product), with a number, a revision and a status. */
export const INSTRUCTION_PROCESSES = ['General', 'Cutting', 'Forging', 'Trimming', 'Heat Treatment', 'CNC', 'VMC', 'QC', 'Packing & Dispatch', 'Safety'] as const;
export type InstructionStatus = 'Draft' | 'Active' | 'Obsolete';
export interface InstructionParam {
  name: string;
  value: string;
}
export interface Instruction {
  id: number;
  docNo: string;
  title: string;
  process: string;
  productId: string;
  productName: string;
  revNo: string;
  effectiveDate: string;
  status: InstructionStatus;
  tools: string;
  steps: string;
  parameters: InstructionParam[];
  checks: string;
  safety: string;
  remarks: string;
  createdBy: string;
  updatedAt: string;
}
export type InstructionInput = Omit<Instruction, 'id' | 'productName' | 'createdBy' | 'updatedAt'>;

const notSetUp = (m: string) => /v_work_instructions|save_work_instruction|set_work_instruction_status|delete_work_instruction|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'Instructions are not set up in the database yet. Run migration 73 in the Supabase SQL editor.' : dbMessage(e as never));
};

/** one step per line; a leading number or bullet the person typed is dropped so the steps are always numbered 1, 2, 3 … */
export const stepLines = (steps: string) =>
  steps
    .split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean);

export async function fetchInstructions(): Promise<Instruction[]> {
  const { data, error } = await supabase.from('v_work_instructions').select('*').order('process').order('doc_no', { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({
    id: Number(r.id),
    docNo: r.doc_no as string,
    title: r.title as string,
    process: (r.process as string) ?? 'General',
    productId: (r.product_id as string) ?? '',
    productName: (r.product_name as string) ?? '',
    revNo: (r.rev_no as string) ?? '00',
    effectiveDate: (r.effective_date as string) ?? '',
    status: r.status as InstructionStatus,
    tools: (r.tools as string) ?? '',
    steps: (r.steps as string) ?? '',
    parameters: Array.isArray(r.parameters) ? (r.parameters as InstructionParam[]) : [],
    checks: (r.checks as string) ?? '',
    safety: (r.safety as string) ?? '',
    remarks: (r.remarks as string) ?? '',
    createdBy: (r.created_by as string) ?? '',
    updatedAt: (r.updated_at as string) ?? '',
  }));
}

export async function saveInstruction(id: number | null, i: InstructionInput, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('save_work_instruction', {
    p_id: id,
    p_payload: {
      doc_no: i.docNo, title: i.title, process: i.process, product_id: i.productId, rev_no: i.revNo, effective_date: i.effectiveDate || null, status: i.status, tools: i.tools,
      steps: i.steps, parameters: i.parameters.filter((p) => p.name.trim()), checks: i.checks, safety: i.safety, remarks: i.remarks,
    },
    p_user: user,
  });
  fail(error);
  return Number(data);
}
export const setInstructionStatus = async (id: number, status: InstructionStatus) => fail((await supabase.rpc('set_work_instruction_status', { p_id: id, p_status: status })).error);
export const deleteInstruction = async (id: number) => fail((await supabase.rpc('delete_work_instruction', { p_id: id })).error);

export function useInstructions() {
  const { canRead } = useAccess();
  const allowed = canRead('instruction');
  const [items, setItems] = useState<Instruction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!allowed) return;
    try {
      setItems(await fetchInstructions());
      setError(null);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoaded(true);
  }, [allowed]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, loaded, error, reload };
}
