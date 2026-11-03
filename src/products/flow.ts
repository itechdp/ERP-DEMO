import { useCallback, useEffect, useState } from 'react';
import { dbMessage, supabase } from '../db/client';
import { useStore } from '../store/StoreContext';
import type { HardnessScale } from '../store/types';

/** What a product goes through, and whether it needs a hardness check (Product Master → Work to be done / Hardness). */
export interface ProductFlow {
  forging: boolean;
  trimming: boolean;
  heatTreatment: boolean;
  hardnessRequired: boolean;
  hardnessMin?: number;
  hardnessMax?: number;
  hardnessScale: HardnessScale;
}

/** a product with nothing saved yet does every process and needs no hardness check */
export const DEFAULT_FLOW: ProductFlow = { forging: true, trimming: true, heatTreatment: true, hardnessRequired: false, hardnessScale: 'HRB' };

const notSetUp = (m: string) => /v_product_flow|set_product_flow|schema cache|does not exist/i.test(m);

export async function fetchProductFlows(): Promise<Record<string, ProductFlow>> {
  const { data, error } = await supabase.from('v_product_flow').select('*');
  if (error) throw new Error(notSetUp(error.message) ? 'Run migration 51 in the Supabase SQL editor.' : dbMessage(error as never));
  return Object.fromEntries(
    (data ?? []).map((r) => [
      r.id as string,
      {
        forging: !!r.do_forging,
        trimming: !!r.do_trimming,
        heatTreatment: !!r.do_heat_treatment,
        hardnessRequired: !!r.hardness_required,
        hardnessMin: r.hardness_min == null ? undefined : Number(r.hardness_min),
        hardnessMax: r.hardness_max == null ? undefined : Number(r.hardness_max),
        hardnessScale: ((r.hardness_scale as HardnessScale) ?? 'HRB'),
      } satisfies ProductFlow,
    ]),
  );
}

export async function saveProductFlow(id: string, f: ProductFlow) {
  const { error } = await supabase.rpc('set_product_flow', {
    p_id: id,
    p_payload: { do_forging: f.forging, do_trimming: f.trimming, do_heat_treatment: f.heatTreatment, hardness_required: f.hardnessRequired, hardness_min: f.hardnessMin ?? null, hardness_max: f.hardnessMax ?? null, hardness_scale: f.hardnessScale },
  });
  if (error) throw new Error(notSetUp(error.message) ? 'Run migration 51 in the Supabase SQL editor to save the work to be done and hardness settings.' : dbMessage(error as never));
}

/** the flow of every product, re-read whenever the store reloads; `of(id)` falls back to the default */
export function useProductFlows() {
  const { state } = useStore();
  const [flows, setFlows] = useState<Record<string, ProductFlow>>({});
  const refresh = useCallback(() => {
    fetchProductFlows().then(setFlows).catch(() => setFlows({}));
  }, []);
  useEffect(refresh, [refresh, state]);
  const of = useCallback((productId: string): ProductFlow => flows[productId] ?? DEFAULT_FLOW, [flows]);
  return { flows, of, refresh };
}
