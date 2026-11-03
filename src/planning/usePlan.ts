import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store/StoreContext';
import type { ProcessStage } from '../store/types';
import { fetchPlan, type PlanItem } from './service';

/**
 * The approved production order, shared by the planning page and the stage pages.
 * Re-read whenever the store reloads (every action does that) and on demand with refresh().
 * `ready` is false until it has been read once; `enforce` is false when migration 50 is not run yet — nothing is blocked then.
 */
export function usePlan() {
  const { state } = useStore();
  const [items, setItems] = useState<PlanItem[]>([]);
  const [enforce, setEnforce] = useState(false);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchPlan();
      setItems(r.items);
      setEnforce(r.enforce);
    } catch {
      setItems([]);
      setEnforce(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, state]);

  const find = useCallback((jobNo: string, stage: ProcessStage) => items.find((i) => i.jobNo === jobNo && i.stage === stage), [items]);
  /** blocked = approval is required, it was read, and this Heat Treatment batch has none (only Heat Treatment is planned) */
  const blocked = useCallback((jobNo: string, stage: ProcessStage) => stage === 'heatTreatment' && ready && enforce && !find(jobNo, stage), [ready, enforce, find]);
  return { items, enforce, ready, refresh, find, blocked, setEnforce };
}
