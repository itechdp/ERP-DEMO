import { openUrl } from '../native/native';
import { printPurchaseOrder } from './print';
import { getPOPdfUrl } from './services/poService';
import type { PODetail } from './types';

type Toast = (t: { kind: 'success' | 'error' | 'info'; title: string; message?: string }) => void;

/**
 * Print a purchase order. The browser's own print can only print the PO page, so when the PO has files attached the PDF is built
 * on the server instead (the PO followed by the attached PDFs / pictures) and opened — print or save it from there.
 * Works in every status. If the server is not reachable it falls back to the plain print with a note saying why.
 */
export async function printPoWithAttachments(po: PODetail, toast: Toast) {
  if (po.attachments.length === 0) return printPurchaseOrder(po);
  try {
    await openUrl(await getPOPdfUrl(po.id));
  } catch (e) {
    toast({ kind: 'error', title: 'Printing the PO without its attachments', message: e instanceof Error ? e.message : String(e) });
    printPurchaseOrder(po);
  }
}
