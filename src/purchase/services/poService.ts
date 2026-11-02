import { dbMessage, supabase } from '../../db/client';
import {
  mapPOApproval,
  mapPOEmailLog,
  mapPOItem,
  mapPORevision,
  mapPurchaseOrder,
} from '../mappers';
import type {
  PODetail,
  PurchaseOrder,
  SavePOHeaderInput,
  SavePOItemInput,
} from '../types';

export async function fetchPORegister(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('v_po_register')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => mapPurchaseOrder(r as Record<string, unknown>));
}

export async function fetchPOUrgent(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('v_po_urgent')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(dbMessage(error));
  return (data || []).map((r) => mapPurchaseOrder(r as Record<string, unknown>));
}

export async function fetchPODetail(id: number): Promise<PODetail> {
  // 1. Header (join supplier info if not in table)
  let { data: poData, error: poError } = await supabase
    .from('v_po_register')
    .select('*')
    .eq('id', id)
    .single();

  if (poError || !poData) {
    // Fallback directly to purchase_orders table if view fails
    const { data: poRaw, error: poRawErr } = await supabase
      .from('purchase_orders')
      .select('*, suppliers(name, email)')
      .eq('id', id)
      .single();

    if (poRawErr || !poRaw) {
      throw new Error(dbMessage(poError || poRawErr));
    }

    const sup = (poRaw as Record<string, unknown>).suppliers as Record<string, unknown> | undefined;
    poData = {
      ...poRaw,
      supplier_name: sup?.name,
      supplier_email: sup?.email,
    };
  }

  // 2. Items
  const { data: itemsData, error: itemsError } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('po_id', id)
    .order('line_no', { ascending: true });

  if (itemsError) throw new Error(dbMessage(itemsError));

  // 3. Approvals
  const { data: appData, error: appError } = await supabase
    .from('po_approvals')
    .select('*')
    .eq('po_id', id)
    .order('acted_at', { ascending: false });

  if (appError) throw new Error(dbMessage(appError));

  // 4. Revisions
  const { data: revData, error: revError } = await supabase
    .from('po_revisions')
    .select('*')
    .eq('po_id', id)
    .order('rev_no', { ascending: false });

  if (revError) throw new Error(dbMessage(revError));

  // 5. Email Logs
  const { data: emailData, error: emailError } = await supabase
    .from('po_email_log')
    .select('*')
    .eq('po_id', id)
    .order('sent_at', { ascending: false });

  if (emailError) throw new Error(dbMessage(emailError));

  const po = mapPurchaseOrder(poData as Record<string, unknown>);
  return {
    ...po,
    items: (itemsData || []).map((r) => mapPOItem(r as Record<string, unknown>)),
    approvals: (appData || []).map((r) => mapPOApproval(r as Record<string, unknown>)),
    revisions: (revData || []).map((r) => mapPORevision(r as Record<string, unknown>)),
    emailLogs: (emailData || []).map((r) => mapPOEmailLog(r as Record<string, unknown>)),
  };
}

export async function savePO(
  id: number | null,
  header: SavePOHeaderInput,
  items: SavePOItemInput[],
  user: string
): Promise<number> {
  const { data, error } = await supabase.rpc('save_po', {
    p_id: id,
    p_header: header,
    p_items: items,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function submitPO(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('submit_po', {
    p_id: id,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function decidePO(
  id: number,
  approve: boolean,
  note: string,
  user: string
): Promise<void> {
  const { error } = await supabase.rpc('decide_po', {
    p_id: id,
    p_approve: approve,
    p_note: note,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function releasePO(id: number, user: string): Promise<void> {
  const { error } = await supabase.rpc('release_po', {
    p_id: id,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
}

export async function amendPO(id: number, reason: string, user: string): Promise<number> {
  const { data, error } = await supabase.rpc('amend_po', {
    p_id: id,
    p_reason: reason,
    p_user: user,
  });

  if (error) throw new Error(dbMessage(error));
  return Number(data);
}

export async function uploadPOAttachment(file: File): Promise<{ name: string; path: string }> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${Date.now()}_${cleanName}`;

  const { error } = await supabase.storage.from('po-attachments').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) throw new Error(dbMessage(error));
  return { name: file.name, path };
}

export async function getPOAttachmentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('po-attachments').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    throw new Error(dbMessage(error) || 'Could not generate download URL');
  }
  return data.signedUrl;
}

export interface POPrefillData {
  sourceType: 'PR' | 'SQ';
  sourceDocNo: string;
  supplierId?: number;
  prId?: number | null;
  prNo?: string;
  sqId?: number | null;
  sqNo?: string;
  urgency?: import('../types').Urgency;
  paymentTerms?: string;
  deliveryTerms?: string;
  items: {
    prItemId?: number | null;
    item: string;
    material?: string;
    grade?: string;
    size?: string;
    uom: string;
    qty: number;
    rate: number;
    gstPct: number;
  }[];
}

export async function getPOPrefillFromPR(prId: number): Promise<POPrefillData> {
  const [prRes, itemsRes] = await Promise.all([
    supabase.from('purchase_requisitions').select('*').eq('id', prId).single(),
    supabase.from('purchase_requisition_items').select('*').eq('pr_id', prId).order('line_no', { ascending: true }),
  ]);

  if (prRes.error || !prRes.data) throw new Error(dbMessage(prRes.error));
  const pr = prRes.data;
  const items = (itemsRes.data || [])
    .map((it: any) => {
      const remaining = Math.max(0, Number(it.qty || 0) - Number(it.ordered_qty || 0));
      return {
        prItemId: Number(it.id),
        item: String(it.item || ''),
        material: it.material ? String(it.material) : undefined,
        grade: it.grade ? String(it.grade) : undefined,
        size: it.size ? String(it.size) : undefined,
        uom: String(it.uom || 'KG'),
        qty: remaining > 0 ? remaining : Number(it.qty || 0),
        rate: 0,
        gstPct: 18,
      };
    })
    .filter((it: any) => it.qty > 0);

  return {
    sourceType: 'PR',
    sourceDocNo: pr.pr_no,
    prId: Number(pr.id),
    prNo: pr.pr_no,
    urgency: (pr.urgency || 'Normal') as import('../types').Urgency,
    items,
  };
}

export async function getPOPrefillFromSQ(sqId: number): Promise<POPrefillData> {
  const [sqRes, itemsRes] = await Promise.all([
    supabase
      .from('supplier_quotations')
      .select('*, purchase_requisitions (pr_no), suppliers (name)')
      .eq('id', sqId)
      .single(),
    supabase.from('supplier_quotation_items').select('*').eq('sq_id', sqId),
  ]);

  if (sqRes.error || !sqRes.data) throw new Error(dbMessage(sqRes.error));
  const sq = sqRes.data;

  // If items are linked to PR items, look up remaining qty on those PR items
  const prItemIds = (itemsRes.data || []).map((it: any) => it.pr_item_id).filter(Boolean);
  const remainingMap = new Map<number, number>();
  if (prItemIds.length > 0) {
    const { data: prItems } = await supabase
      .from('purchase_requisition_items')
      .select('id, qty, ordered_qty')
      .in('id', prItemIds);
    (prItems || []).forEach((p: any) => {
      remainingMap.set(p.id, Math.max(0, Number(p.qty || 0) - Number(p.ordered_qty || 0)));
    });
  }

  const items = (itemsRes.data || []).map((it: any) => {
    let qty = Number(it.qty || 0);
    if (it.pr_item_id && remainingMap.has(it.pr_item_id)) {
      const rem = remainingMap.get(it.pr_item_id)!;
      if (rem > 0) qty = Math.min(qty, rem);
    }
    return {
      prItemId: it.pr_item_id ? Number(it.pr_item_id) : undefined,
      item: String(it.item || ''),
      material: it.material ? String(it.material) : undefined,
      grade: it.grade ? String(it.grade) : undefined,
      size: it.size ? String(it.size) : undefined,
      uom: String(it.uom || 'KG'),
      qty,
      rate: Number(it.rate || 0),
      gstPct: 18,
    };
  });

  return {
    sourceType: 'SQ',
    sourceDocNo: sq.sq_no,
    supplierId: Number(sq.supplier_id),
    prId: sq.pr_id ? Number(sq.pr_id) : undefined,
    prNo: sq.purchase_requisitions?.pr_no,
    sqId: Number(sq.id),
    sqNo: sq.sq_no,
    paymentTerms: sq.payment_terms || undefined,
    deliveryTerms: sq.delivery_terms || undefined,
    items,
  };
}

// ---------------------------------------------------------------------------------------------
// The PO's PDF (Edge Function po-pdf). Nothing is e-mailed from the ERP: the PDF / Excel is attached to a mail by hand.
// ---------------------------------------------------------------------------------------------
/**
 * The message to show for a failed Edge Function call. Order of preference: the text the function itself returned; then a plain-words reason
 * for the common failures (function not deployed, browser could not reach it, server error); then the fallback.
 */
export async function functionError(error: unknown, fallback: string, fn: string): Promise<string> {
  const err = error as { name?: string; context?: unknown } | null;
  const ctx = err?.context as Response | undefined;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
      if (body?.message && ctx.status !== 404) return String(body.message);
    } catch {
      /* not JSON */
    }
    if (ctx.status === 404) return `The ${fn} function is not deployed on this Supabase project yet. Deploy it (see supabase/functions/README.md) and try again.`;
    if (ctx.status === 401) return 'Your sign-in has expired. Sign in again and retry.';
    if (ctx.status >= 500) return `The ${fn} function failed on the server (error ${ctx.status}). Check its logs in Supabase → Edge Functions → ${fn} → Logs.`;
  }
  // the request never got an answer: a function that is not deployed (or whose CORS answer is missing) looks exactly like this in the browser
  if (err?.name === 'FunctionsFetchError' || err?.name === 'FunctionsRelayError') {
    return `Could not reach the ${fn} function. It is probably not deployed yet (Supabase → Edge Functions should list it), or its secrets are missing.`;
  }
  return fallback;
}

/** true when the signed-in user may send / download this PO (Write on Purchase Orders or Approvals, PO Released or Sent). */
export async function canSendPO(poId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_send_po', { p_po_id: poId });
  return !error && data === true;
}

/** A short-lived link to the final PDF (nothing is e-mailed). */
export async function getPOPdfUrl(poId: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke('po-pdf', { body: { poId } });
  if (error) throw new Error(await functionError(error, 'The PDF could not be created. Please try again.', 'po-pdf'));
  if (!data?.ok || !data?.url) throw new Error(String(data?.error ?? 'The PDF could not be created.'));
  return String(data.url);
}
