// Server-side paging: the database returns ONE page and the total number of rows that match, so a long table (the ledger, sales orders …)
// is never loaded whole. `apply` adds the filters to the query (eq / ilike / or …) so the filtering is done by the database too.
import { supabase } from './client';

type Query = ReturnType<ReturnType<typeof supabase.from>['select']>;

export interface PageRequest {
  /** 1-based */
  page: number;
  size: number;
  /** [column, ascending] pairs, applied in order */
  order?: [string, boolean][];
  /** add the filters to the query */
  apply?: (q: Query) => Query;
}

export async function fetchPage<T = Record<string, unknown>>(source: string, req: PageRequest): Promise<{ rows: T[]; total: number }> {
  let q = supabase.from(source).select('*', { count: 'exact' }) as Query;
  if (req.apply) q = req.apply(q);
  for (const [col, asc] of req.order ?? []) q = q.order(col, { ascending: asc });
  const from = (Math.max(1, req.page) - 1) * req.size;
  const { data, error, count } = await q.range(from, from + req.size - 1);
  if (error) throw new Error(`${source}: ${error.message}`);
  return { rows: (data ?? []) as T[], total: count ?? 0 };
}

/** text that goes into an ilike / or() filter must not contain the characters those filters use as syntax */
export const likeText = (s: string) => s.trim().replace(/[%,()*\\]/g, ' ');
