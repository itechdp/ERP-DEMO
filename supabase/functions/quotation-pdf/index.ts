// quotation-pdf — builds the customer's PDF of an approved quotation and returns a short-lived download link. Nothing is e-mailed.
//
// POST  { quotationId: number }                                  (Authorization: Bearer <the signed-in user's JWT>)
//   200 { ok: true, url, path, expiresIn }
//   4xx { ok: false, error }                                      permission check: can_send_quotation(id) with the caller's login
import { adminClient, bearer, corsHeaders, HttpError, json, userClient } from '../_shared/http.ts';
import { loadQuotation, quotationPdfPath, storeQuotationPdf } from '../_shared/quotation-data.ts';
import { buildQuotationPdf } from '../_shared/quotation-pdf.ts';

const EXPIRES_IN = 600;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
  try {
    const jwt = bearer(req);
    if (!jwt) throw new HttpError(401, 'Sign in to download a quotation.');
    const body = await req.json().catch(() => ({}));
    const id = Number(body?.quotationId);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'quotationId is required.');

    const { data: allowed, error: permErr } = await userClient(jwt).rpc('can_send_quotation', { p_id: id });
    if (permErr || allowed !== true) throw new HttpError(403, 'You are not allowed to download this quotation (it must be Approved or Sent, and you need Write access to Sales Quotation with access to customer names and prices).');

    const admin = adminClient();
    const q = await loadQuotation(admin, id);
    const path = quotationPdfPath(q.pdf.quotation.qt_no);
    await storeQuotationPdf(admin, path, await buildQuotationPdf(q.pdf));
    const { data, error } = await admin.storage.from('quotation-pdfs').createSignedUrl(path, EXPIRES_IN);
    if (error || !data?.signedUrl) throw new Error('Could not create the download link.');
    return json({ ok: true, url: data.signedUrl, path, expiresIn: EXPIRES_IN });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Could not build the PDF.';
    console.error('quotation-pdf failed:', status, message);
    return json({ ok: false, error: message }, status);
  }
});
