// Loads everything the PDF and the e-mail need, with the service-role client (call it only after the permission check).
import type { PoPdfData } from './po-pdf.ts';
import { HttpError } from './http.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

export interface LoadedPo {
  id: number;
  status: string;
  deliveryDate: string | null;
  supplierEmail: string | null;
  /** files attached to the PO (name + path in the po-attachments bucket) */
  attachments: { name: string; path: string }[];
  pdf: PoPdfData;
}

export async function loadPo(admin: Admin, poId: number): Promise<LoadedPo> {
  const { data: po, error } = await admin.from('purchase_orders').select('*').eq('id', poId).maybeSingle();
  if (error || !po) throw new HttpError(404, 'That purchase order was not found.');
  const [{ data: items }, { data: sup }, { data: co }] = await Promise.all([
    admin.from('purchase_order_items').select('*').eq('po_id', poId).order('line_no', { ascending: true }),
    admin.from('suppliers').select('name, gstin, email, address, phone').eq('id', po.supplier_id).maybeSingle(),
    admin.from('company_settings').select('name, address, gstin, phone, email').eq('id', 1).maybeSingle(),
  ]);
  if (!items || items.length === 0) throw new HttpError(409, 'This purchase order has no items.');
  return {
    id: po.id,
    status: po.status,
    deliveryDate: po.delivery_date ?? null,
    supplierEmail: sup?.email ?? null,
    attachments: Array.isArray(po.attachments) ? po.attachments.filter((a: { path?: string }) => a && a.path).map((a: { name?: string; path: string }) => ({ name: String(a.name ?? ''), path: String(a.path) })) : [],
    pdf: {
      // blank fields are simply left out of the PDF
      company: { name: co?.name || 'Everest Auto Forge Pvt. Ltd.', address: co?.address, gstin: co?.gstin, phone: co?.phone, email: co?.email },
      supplier: { name: sup?.name ?? '', gstin: sup?.gstin, email: sup?.email, address: sup?.address, phone: sup?.phone },
      po: {
        po_no: po.po_no,
        rev_no: num(po.rev_no),
        po_date: po.po_date,
        delivery_date: po.delivery_date,
        urgency: po.urgency,
        payment_terms: po.payment_terms,
        delivery_terms: po.delivery_terms,
        other_terms: po.other_terms,
        tax_type: po.tax_type === 'inter' ? 'inter' : 'intra',
        taxable_amount: num(po.taxable_amount),
        gst_amount: num(po.gst_amount),
        total_amount: num(po.total_amount),
        created_by: po.created_by,
        approved_by: po.approved_by,
        approved_at: po.approved_at,
        released_by: po.released_by,
        released_at: po.released_at,
      },
      // deno-lint-ignore no-explicit-any
      items: items.map((i: any) => ({
        line_no: num(i.line_no),
        item: i.item,
        material: i.material,
        grade: i.grade,
        size: i.size,
        hsn: i.hsn,
        uom: i.uom,
        qty: num(i.qty),
        rate: num(i.rate),
        gst_pct: num(i.gst_pct),
        amount: num(i.amount),
      })),
    },
  };
}

/** po/<po_no>/rev<rev_no>.pdf in the private po-pdfs bucket */
export const pdfPath = (poNo: string, rev: number) => `po/${poNo}/rev${rev}.pdf`;

export async function storePdf(admin: Admin, path: string, bytes: Uint8Array) {
  const { error } = await admin.storage.from('po-pdfs').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Could not store the PDF: ${error.message}`);
}
