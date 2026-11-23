// Standalone scratch tables (migration 75). Not linked to inventory or accounting.
// Petty cash is kept per role (migration 84): each role reads, edits and totals only the entries its own users added.
import { supabase } from '../db/client';
import { announceChange } from '../db/sync';
import type { Role } from '../auth/access';

export interface PettyCashRow { id: number; date: string; amount: number; description: string; createdAt: string }
/** one bag of a Quick Material Log: pieces and weight, both typed by hand (the weight is never worked out from the pieces) */
export interface Bag { no: number; qty: number; weight: number }
/** one log: a date, an item name and its bags. A log saved before the bags existed has none: it has just a total weight. */
export interface MaterialLogRow { id: number; date: string; material: string; bags: Bag[]; totalQty: number; weightKg: number; createdAt: string }

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

/** The signed-in role's own petty cash entries. The database enforces the same rule (row security, migration 84); the filter here
 *  makes the query say what it means and refuses to show a shared list if the migration is missing. */
export async function fetchPettyCash(role: Role): Promise<PettyCashRow[]> {
  const { data, error } = await supabase.from('petty_cash_logs').select('id, entry_date, amount, description, created_at').eq('created_role', role).order('entry_date', { ascending: false }).order('id', { ascending: false });
  if (error && /created_role/i.test(error.message)) throw new Error('Petty cash is not separated by role in the database yet. Run migration 84 (84_petty_cash_by_role.sql) in the Supabase SQL editor.');
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id as number, date: r.entry_date as string, amount: Number(r.amount), description: r.description as string, createdAt: r.created_at as string }));
}
/** the role is not sent: the database stamps the saver's own role on the entry */
export async function addPettyCash(date: string, amount: number, description: string) {
  const { error } = await supabase.from('petty_cash_logs').insert({ entry_date: date, amount, description: description.trim() });
  fail(error);
  announceChange('petty');
}
export async function deletePettyCash(id: number) {
  const { error } = await supabase.from('petty_cash_logs').delete().eq('id', id);
  fail(error);
  announceChange('petty');
}

type MRow = { id: number; entry_date: string; material_name: string; weight_kg: number | string; created_at: string; bags?: unknown; total_qty?: number | string | null };
const toBags = (v: unknown): Bag[] => (Array.isArray(v) ? v.map((b, i) => ({ no: Number((b as Bag).no) || i + 1, qty: Number((b as Bag).qty), weight: Number((b as Bag).weight) })) : []);

export async function fetchMaterialLog(): Promise<MaterialLogRow[]> {
  let res = await supabase.from('quick_material_logs').select('id, entry_date, material_name, bags, total_qty, weight_kg, created_at').order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(200);
  // migration 78 not installed yet: the list still works from the older columns (each log then has just a weight)
  if (res.error && /bags|total_qty/i.test(res.error.message)) {
    res = (await supabase.from('quick_material_logs').select('id, entry_date, material_name, weight_kg, created_at').order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(200)) as typeof res;
  }
  fail(res.error);
  return ((res.data ?? []) as unknown as MRow[]).map((r) => ({
    id: r.id, date: r.entry_date, material: r.material_name, bags: toBags(r.bags), totalQty: Number(r.total_qty ?? 0), weightKg: Number(r.weight_kg), createdAt: r.created_at,
  }));
}
const bagsJson = (bags: { qty: number; weight: number }[]) => bags.map((b, i) => ({ no: i + 1, qty: b.qty, weight: b.weight }));
/** The totals are worked out by the database from the bags (migration 78), so only the bags are sent. */
export async function addMaterialLog(date: string, item: string, bags: { qty: number; weight: number }[]) {
  const { error } = await supabase.from('quick_material_logs').insert({ entry_date: date, material_name: item.trim(), bags: bagsJson(bags) });
  fail(error);
  announceChange('material');
}
export async function deleteMaterialLog(id: number) {
  const { error } = await supabase.from('quick_material_logs').delete().eq('id', id);
  fail(error);
  announceChange('material');
}

export async function updatePettyCash(id: number, date: string, amount: number, description: string) {
  const { error } = await supabase.from('petty_cash_logs').update({ entry_date: date, amount, description: description.trim() }).eq('id', id);
  fail(error);
  announceChange('petty');
}
export async function updateMaterialLog(id: number, date: string, item: string, bags: { qty: number; weight: number }[]) {
  const { error } = await supabase.from('quick_material_logs').update({ entry_date: date, material_name: item.trim(), bags: bagsJson(bags) }).eq('id', id);
  fail(error);
  announceChange('material');
}
