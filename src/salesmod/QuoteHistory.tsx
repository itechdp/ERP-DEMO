import { useState } from 'react';
import { History } from 'lucide-react';
import { supabase } from '../db/client';
import { inr } from './calc';
import { fmtDate } from '../components/format';

interface Past { quotationId: number; docNo: string; status: string; qtDate: string; netRate: number | null }

/** match a typed name exactly, ignoring capitals (the % and _ wildcards are escaped) */
const exact = (v: string) => v.trim().replace(/[\\%_]/g, (c) => `\\${c}`);

async function fetchHistory(customer: string, product: string, excludeId: number | null): Promise<Past[]> {
  let q = supabase
    .from('v_sales_quotation_items')
    .select('quotation_id, doc_no, status, qt_date, net_rate')
    .ilike('customer', exact(customer))
    .ilike('product', exact(product))
    .order('qt_date', { ascending: false })
    .limit(30);
  if (excludeId) q = q.neq('quotation_id', excludeId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ quotationId: Number(r.quotation_id), docNo: String(r.doc_no ?? ''), status: String(r.status ?? ''), qtDate: String(r.qt_date ?? ''), netRate: r.net_rate == null ? null : Number(r.net_rate) }));
}

/**
 * New / Edit Quotation → one product: its earlier quotations for THIS customer only (date, quote no., status, rate / final cost),
 * so the new price can be checked against what was quoted before. Opens on request; nothing is loaded until then.
 */
export function QuoteHistory({ customer, product, excludeId }: { customer: string; product: string; excludeId: number | null }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Past[] | null>(null);
  const [err, setErr] = useState('');
  const [key, setKey] = useState('');
  const ready = customer.trim() !== '' && product.trim() !== '';
  const k = `${customer.trim().toLowerCase()}|${product.trim().toLowerCase()}`;

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (rows && key === k) return;
    setRows(null);
    setErr('');
    setKey(k);
    try {
      setRows(await fetchHistory(customer, product, excludeId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-sm btn-subtle" disabled={!ready} onClick={() => void toggle()} title={ready ? `Earlier quotations of ${product.trim()} for ${customer.trim()}` : 'Choose the customer and enter the product first'}>
        <History size={14} /> {open ? 'Hide history' : 'History'}
      </button>
      {open && (
        <div className="card" style={{ marginTop: 8, padding: 0 }}>
          <div className="text-xs muted" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            Earlier quotations of <b>{product.trim()}</b> for <b>{customer.trim()}</b>
          </div>
          {rows === null ? (
            <div className="card-center-msg">Loading…</div>
          ) : err ? (
            <div className="card-center-msg">{err}</div>
          ) : rows.length === 0 ? (
            <div className="card-center-msg">No earlier quotation of this product for this customer.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Quote No.</th>
                    <th>Status</th>
                    <th className="r">Rate / Final Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.quotationId}-${i}`}>
                      <td className="nowrap">{fmtDate(r.qtDate)}</td>
                      <td className="mono">{r.docNo}</td>
                      <td>{r.status}</td>
                      <td className="r num strong nowrap">{r.netRate == null ? '—' : inr(r.netRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
