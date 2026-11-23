// Loads everything the quotation PDF and the e-mail need, with the service-role client (call it only after the permission check).
import type { QuotationPdfData } from './quotation-pdf.ts';
import { HttpError } from './http.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

export interface LoadedQuotation {
  id: number;
  status: string;
  validUntil: string | null;
  customerEmail: string | null;
  pdf: QuotationPdfData;
}

export async function loadQuotation(admin: Admin, id: number): Promise<LoadedQuotation> {
  const { data: q, error } = await admin.from('sales_quotations').select('*').eq('id', id).maybeSingle();
  if (error || !q) throw new HttpError(404, 'That quotation was not found.');
  if (!q.qt_no) throw new HttpError(409, 'This quotation has no number yet: it has not been approved.');
  const [{ data: items }, { data: co }, { data: cust }] = await Promise.all([
    admin.from('sales_quotation_items').select('*').eq('quotation_id', id).order('line_no', { ascending: true }),
    admin.from('company_settings').select('name, address, gstin, phone, email').eq('id', 1).maybeSingle(),
    // the customer's address and GSTIN from the customer master (matched by name, as the quotation stores the name)
    admin.from('customers').select('address, city, state, gstin').ilike('name', String(q.customer ?? '').trim().replace(/[\\%_]/g, (c: string) => `\\${c}`)).limit(1).maybeSingle(),
  ]);
  if (!items || items.length === 0) throw new HttpError(409, 'This quotation has no products.');
  return {
    id: q.id,
    status: q.status,
    validUntil: q.valid_until ?? null,
    customerEmail: q.email || null,
    pdf: {
      company: { name: co?.name || 'Everest Auto Forge Pvt. Ltd.', address: co?.address, gstin: co?.gstin, phone: co?.phone, email: co?.email },
      quotation: {
        qt_no: q.qt_no,
        qt_date: q.qt_date,
        valid_until: q.valid_until,
        enquiry_no: q.enquiry_no,
        payment_terms: q.payment_terms,
        delivery_terms: q.delivery_terms,
        remarks: q.remarks,
        salesperson: q.salesperson,
        approved_by: q.approved_by,
        approved_at: q.approved_at,
      },
      customer: { name: q.customer, contact: q.contact, phone: q.phone, email: q.email, address: cust?.address, city: cust?.city, state: cust?.state, gstin: cust?.gstin },
      // deno-lint-ignore no-explicit-any
      items: items.map((i: any) => {
        const net = num(i.rate) * (1 - num(i.discount_pct) / 100);
        return {
          line_no: num(i.line_no),
          product: i.product,
          grade: i.grade,
          size: i.size,
          uom: i.uom,
          qty: num(i.qty),
          rate: num(i.rate),
          discount_pct: num(i.discount_pct),
          net_rate: Math.round(net * 10000) / 10000,
          amount: Math.round(num(i.qty) * net * 100) / 100,
        };
      }),
    },
  };
}

/** quotation/<qt no>.pdf in the private quotation-pdfs bucket */
export const quotationPdfPath = (qtNo: string) => `quotation/${qtNo}.pdf`;

export async function storeQuotationPdf(admin: Admin, path: string, bytes: Uint8Array) {
  const { error } = await admin.storage.from('quotation-pdfs').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Could not store the PDF: ${error.message}`);
}
