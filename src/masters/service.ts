import { dbMessage, supabase } from '../db/client';
import type { Customer } from './types';

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(/save_customer|save_dropdown_list|save_material|save_master_name|dropdown_lists|schema cache|does not exist/i.test(e.message) ? 'This is not set up in the database yet. Run migration 42 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function saveCustomer(id: number | null, c: Partial<Customer> & { name: string }): Promise<number> {
  const { data, error } = await supabase.rpc('save_customer', {
    p_id: id,
    p_payload: {
      name: c.name, code: c.code ?? '', contact: c.contact ?? '', phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', city: c.city ?? '', state: c.state ?? '',
      gstin: c.gstin ?? '', payment_terms: c.paymentTerms ?? '', notes: c.notes ?? '', active: c.active ?? true,
    },
  });
  fail(error);
  return Number(data);
}

export async function saveOptionList(key: string, items: string[]) {
  fail((await supabase.rpc('save_dropdown_list', { p_key: key, p_items: items })).error);
}

export interface MaterialInput { old?: string; family: string; material: string; grade: string; density: number; defaultOd: number }
export async function saveMaterial(m: MaterialInput) {
  fail((await supabase.rpc('save_material', { p_old: m.old ?? null, p_family: m.family, p_material: m.material, p_grade: m.grade, p_density: m.density, p_default_od: m.defaultOd })).error);
}
export async function deleteMaterial(name: string) {
  fail((await supabase.rpc('delete_material', { p_material: name })).error);
}

export async function saveMasterName(kind: 'machine' | 'operator' | 'inspector', id: number | null, name: string, stage: string | null, active: boolean) {
  fail((await supabase.rpc('save_master_name', { p_kind: kind, p_id: id, p_name: name, p_stage: stage, p_active: active })).error);
}
