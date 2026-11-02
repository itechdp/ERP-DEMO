// po-pdf — builds the final PDF of a released purchase order and returns a short-lived download link. Nothing is e-mailed.
//
// POST  { poId: number }                                           (Authorization: Bearer <the signed-in user's JWT>)
//   200 { ok: true, url, path, expiresIn }      url is a signed link valid for `expiresIn` seconds
//   4xx { ok: false, error }                    permission check: can_send_po(poId) with the caller's own login
import { adminClient, bearer, corsHeaders, HttpError, json, userClient } from '../_shared/http.ts';
import { loadPo, pdfPath, storePdf } from '../_shared/po-data.ts';
import { buildPoPdf } from '../_shared/po-pdf.ts';

const EXPIRES_IN = 600;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405);
  try {
    const jwt = bearer(req);
    if (!jwt) throw new HttpError(401, 'Sign in to download a purchase order.');
    const body = await req.json().catch(() => ({}));
    const poId = Number(body?.poId);
    if (!Number.isInteger(poId) || poId <= 0) throw new HttpError(400, 'poId is required.');

    const { data: allowed, error: permErr } = await userClient(jwt).rpc('can_send_po', { p_po_id: poId });
    if (permErr || allowed !== true) throw new HttpError(403, 'You are not allowed to download this purchase order (it must be Released or Sent to Supplier, and you need Write access to Purchase Orders or Purchase Approvals).');

    const admin = adminClient();
    const po = await loadPo(admin, poId);
    const path = pdfPath(po.pdf.po.po_no, po.pdf.po.rev_no);
    await storePdf(admin, path, await buildPoPdf(po.pdf));
    const { data, error } = await admin.storage.from('po-pdfs').createSignedUrl(path, EXPIRES_IN);
    if (error || !data?.signedUrl) throw new Error('Could not create the download link.');
    return json({ ok: true, url: data.signedUrl, path, expiresIn: EXPIRES_IN });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Could not build the PDF.';
    console.error('po-pdf failed:', status, message);
    return json({ ok: false, error: message }, status);
  }
});
