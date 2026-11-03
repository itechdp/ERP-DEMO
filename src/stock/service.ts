import { useCallback, useEffect, useState } from 'react';
import { dbMessage, supabase } from '../db/client';
import { useStore } from '../store/StoreContext';

export type StockStatus = 'ok' | 'low' | 'out';
/** raw bar by material and OD: what is in stock, what job cards already planned (reserved), what is really free */
export interface RawStock {
  material: string;
  od: number;
  available: number;
  reserved: number;
  free: number;
  min: number;
  status: StockStatus;
}
/** our own parts, by product and the process they are ready for */
export interface SemiStock {
  productId: string;
  stage: 'forging' | 'trimming' | 'heatTreatment';
  available: number;
  min: number;
  status: StockStatus;
}

const notSetUp = (m: string) => /v_stock_raw|v_stock_semi|add_semi_stock|set_stock_min|delete_semi_lot|schema cache|does not exist/i.test(m);
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(notSetUp(e.message) ? 'Stock is not set up in the database yet. Run migration 54 in the Supabase SQL editor.' : dbMessage(e as never));
};

export const rawKey = (material: string, od: number) => `raw|${material}|${od}`;
export const semiKey = (productId: string, stage: string) => `semi|${productId}|${stage}`;

export async function fetchStock(): Promise<{ raw: RawStock[]; semi: SemiStock[] }> {
  const [r, s] = await Promise.all([supabase.from('v_stock_raw').select('*').order('material'), supabase.from('v_stock_semi').select('*').order('product_id')]);
  fail(r.error);
  fail(s.error);
  return {
    raw: (r.data ?? []).map((x) => ({ material: x.material as string, od: Number(x.od), available: Number(x.available), reserved: Number(x.reserved), free: Number(x.free), min: Number(x.min_qty), status: x.status as StockStatus })),
    semi: (s.data ?? []).map((x) => ({ productId: x.product_id as string, stage: x.stage as SemiStock['stage'], available: Number(x.available), min: Number(x.min_qty), status: x.status as StockStatus })),
  };
}

export async function addSemiStock(productId: string, stage: string, qty: number, supplier: string, note: string, user: string) {
  fail((await supabase.rpc('add_semi_stock', { p_product: productId, p_stage: stage, p_qty: qty, p_supplier: supplier, p_note: note, p_user: user })).error);
}
export async function setStockMin(key: string, min: number) {
  fail((await supabase.rpc('set_stock_min', { p_key: key, p_min: min })).error);
}

/** the stock levels, re-read whenever the store reloads (every stock movement does that) */
export function useStock() {
  const { state } = useStore();
  const [data, setData] = useState<{ raw: RawStock[]; semi: SemiStock[] }>({ raw: [], semi: [] });
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setData(await fetchStock());
    } catch {
      setData({ raw: [], semi: [] });
    }
    setReady(true);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, state]);
  const rawOf = (material: string, od: number) => data.raw.find((x) => x.material === material && x.od === od);
  const semiOf = (productId: string, stage: string) => data.semi.find((x) => x.productId === productId && x.stage === stage);
  return { ...data, ready, refresh, rawOf, semiOf };
}
