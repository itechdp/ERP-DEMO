// ---------------------------------------------------------------------------
// Supabase client. URL + anon (publishable) key come from .env — never the service_role key.
// Security does not depend on this file: every rule (who may read what, masking, validation) is enforced inside the
// database (supabase/migrations). This key can only do what a signed-in user's role allows.
// ---------------------------------------------------------------------------
import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** false when .env is missing / empty — the app then shows a setup message instead of failing obscurely */
export const dbConfigured = !!url && !!key;

// A number typed on an "add" form travels in the x-doc-no header of the create call (migration 37 reads it). Only these calls carry it.
const DOC_NO_RPCS = new Set([
  'add_inward', 'create_job', 'create_job_work', 'create_dispatch', 'save_hardness_report', 'save_sales_record', 'save_sales_quotation',
  'save_sales_order', 'save_pr', 'save_rfq', 'save_sq', 'save_po', 'save_purchase_invoice', 'save_purchase_payment',
]);
let pendingDocNo = '';

/** Runs a create call with the number the user typed ('' / undefined = number it automatically). */
export async function withDocNo<T>(no: string | undefined, run: () => Promise<T>): Promise<T> {
  pendingDocNo = (no ?? '').trim();
  try {
    return await run();
  } finally {
    pendingDocNo = '';
  }
}

const docNoFetch: typeof fetch = (input, init) => {
  if (pendingDocNo) {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const m = /\/rest\/v1\/rpc\/([a-z_]+)/.exec(u);
    if (m && DOC_NO_RPCS.has(m[1])) {
      const headers = new Headers(init?.headers);
      headers.set('x-doc-no', pendingDocNo);
      return fetch(input, { ...init, headers });
    }
  }
  return fetch(input, init);
};

/**
 * The database returns at most 1,000 rows per request (the API's "max rows"), and a list read that goes over it would silently come back
 * cut short. So every plain list read (a GET on a table or view with no limit / offset / range of its own, not a single row, not a count)
 * is fetched in pages of 1,000 and joined, so a list is always complete however many rows there are. Pages the screens ask for
 * themselves (fetchPage, the ledger) carry their own range and pass straight through.
 */
const PAGE = 1000;
const MAX_PAGES = 500; // a safety stop: 500,000 rows
const allPagesFetch: typeof fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  const plain =
    method === 'GET' &&
    /\/rest\/v1\/(?!rpc\/)/.test(u) &&
    !/[?&](limit|offset)=/.test(u) &&
    !headers.has('Range') &&
    !/count=/.test(headers.get('Prefer') ?? '') &&
    !/pgrst\.object/.test(headers.get('Accept') ?? '');
  if (!plain) return docNoFetch(input, init);

  const all: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const h = new Headers(headers);
    h.set('Range-Unit', 'items');
    h.set('Range', `${page * PAGE}-${page * PAGE + PAGE - 1}`);
    const res = await docNoFetch(u, { ...init, method: 'GET', headers: h });
    if (!res.ok) return res; // 200 / 206 are both fine; anything else is the real error
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return new Response(JSON.stringify(all), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: allPagesFetch },
});

/** Turns any Supabase / PostgREST error into the plain message the database raised (same texts as the old ERPError). */
export function dbMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return 'Unexpected error.';
}
