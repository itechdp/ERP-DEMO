// Standalone scratch tables (migration 75). Not linked to inventory or accounting.
import { supabase } from '../db/client';

export interface PettyCashRow { id: number; date: string; amount: number; description: string; createdAt: string }
export interface MaterialLogRow { id: number; date: string; weightKg: number; material: string; createdAt: string }

const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };

export async function fetchPettyCash(): Promise<PettyCashRow[]> {
  const { data, error } = await supabase.from('petty_cash_logs').select('id, entry_date, amount, description, created_at').order('entry_date', { ascending: false }).order('id', { ascending: false });
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id as number, date: r.entry_date as string, amount: Number(r.amount), description: r.description as string, createdAt: r.created_at as string }));
}
export async function addPettyCash(date: string, amount: number, description: string) {
  const { error } = await supabase.from('petty_cash_logs').insert({ entry_date: date, amount, description: description.trim() });
  fail(error);
}
export async function deletePettyCash(id: number) {
  const { error } = await supabase.from('petty_cash_logs').delete().eq('id', id);
  fail(error);
}

export async function fetchMaterialLog(): Promise<MaterialLogRow[]> {
  const { data, error } = await supabase.from('quick_material_logs').select('id, entry_date, weight_kg, material_name, created_at').order('entry_date', { ascending: false }).order('id', { ascending: false }).limit(200);
  fail(error);
  return (data ?? []).map((r) => ({ id: r.id as number, date: r.entry_date as string, weightKg: Number(r.weight_kg), material: r.material_name as string, createdAt: r.created_at as string }));
}
export async function addMaterialLog(date: string, weightKg: number, material: string) {
  const { error } = await supabase.from('quick_material_logs').insert({ entry_date: date, weight_kg: weightKg, material_name: material.trim() });
  fail(error);
}
export async function deleteMaterialLog(id: number) {
  const { error } = await supabase.from('quick_material_logs').delete().eq('id', id);
  fail(error);
}

export async function updatePettyCash(id: number, date: string, amount: number, description: string) {
  const { error } = await supabase.from('petty_cash_logs').update({ entry_date: date, amount, description: description.trim() }).eq('id', id);
  fail(error);
}
export async function updateMaterialLog(id: number, date: string, weightKg: number, material: string) {
  const { error } = await supabase.from('quick_material_logs').update({ entry_date: date, weight_kg: weightKg, material_name: material.trim() }).eq('id', id);
  fail(error);
}
