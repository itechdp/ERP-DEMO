import { dbMessage, supabase } from '../../db/client';
import { mapPRItem, mapPurchaseRequisition } from '../mappers';
import type { PRDetail, PurchaseRequisition, SavePRHeaderInput, SavePRItemInput } from '../types';

export async function fetchPRs(): Promise<PurchaseRequisition[]> {
  const { data, error } = await supabase
    .from('purchase_requisitions')
    .select(`
      *,
      purchase_requisition_items (id, line_no, item, material, grade, size, uom, qty, ordered_qty)
    `)
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));

  return (data || []).map((row: any) => {
    const pr = mapPurchaseRequisition(row);
    const items = [...(row.purchase_requisition_items || [])].sort((a: any, b: any) => Number(a.line_no || 0) - Number(b.line_no || 0));
    // the item lines (name, material, size, quantity) so lists can describe the requisition without opening it
    pr.items = items.map((it: any) => ({
      id: Number(it.id), prId: Number(row.id), lineNo: Number(it.line_no || 0), item: String(it.item ?? ''), material: it.material || undefined, grade: it.grade || undefined,
      size: it.size || undefined, uom: String(it.uom ?? ''), qty: Number(it.qty || 0), orderedQty: Number(it.ordered_qty || 0),
    }));
    pr.itemCount = items.length;
    pr.totalQty = items.reduce((sum: number, it: any) => sum + Number(it.qty || 0), 0);
    pr.totalOrderedQty = items.reduce((sum: number, it: any) => sum + Number(it.ordered_qty || 0), 0);
    return pr;
  });
}

export async function fetchPRDetail(id: number): Promise<PRDetail> {
  const [prRes, itemsRes] = await Promise.all([
    supabase.from('purchase_requisitions').select('*').eq('id', id).single(),
    supabase.from('purchase_requisition_items').select('*').eq('pr_id', id).order('line_no', { ascending: true }),
  ]);

  if (prRes.error || !prRes.data) throw new Error(dbMessage(prRes.error));
  if (itemsRes.error) throw new Error(dbMessage(itemsRes.error));

  const pr = mapPurchaseRequisition(prRes.data);
  const items = (itemsRes.data || []).map(mapPRItem);
  pr.itemCount = items.length;
  pr.totalQty = items.reduce((sum, it) => sum + it.qty, 0);
  pr.totalOrderedQty = items.reduce((sum, it) => sum + it.orderedQty, 0);

  return {
    ...pr,
    items,
  };
}

export async function savePR(
  id: number | null,
  header: SavePRHeaderInput,
  items: SavePRItemInput[],
  user: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('save_pr', {
    p_id: id,
    p_header: header,
    p_items: items,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function submitPR(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('submit_pr', {
    p_id: id,
    p_user: user,
  });
  if (error) throw new Error(dbMessage(error));
}

export async function decidePR(id: number, approve: boolean, note: string, user: string): Promise<void> {
  const { error } = await supabase.rpc('decide_pr', {
    p_id: id,
    p_approve: approve,
    p_note: note,
    p_user: user,
  });
  if (error) throw new Error(dbMessage(error));
}

export async function cancelPR(id: number, reason: string, user: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_pr', {
    p_id: id,
    p_reason: reason,
    p_user: user,
  });
  if (error) throw new Error(dbMessage(error));
}
