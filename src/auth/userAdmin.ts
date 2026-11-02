import { dbMessage, supabase } from '../db/client';
import type { Role } from './access';

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastSignIn: string | null;
  isMe: boolean;
}

type R = Record<string, any>;
const fail = (e: { message: string } | null) => {
  if (e) throw new Error(/list_users|create_user|schema cache|does not exist/i.test(e.message) ? 'User management is not set up in the database yet. Run migration 41 in the Supabase SQL editor.' : dbMessage(e as never));
};

export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.rpc('list_users');
  fail(error);
  return ((data ?? []) as R[]).map((r) => ({
    id: r.id, email: r.email ?? '', name: r.full_name ?? '', role: r.role as Role, active: !!r.active, createdAt: r.created_at, lastSignIn: r.last_sign_in_at ?? null, isMe: !!r.is_me,
  }));
}

export async function createUser(i: { email: string; password: string; name: string; role: Role }) {
  fail((await supabase.rpc('create_user', { p_email: i.email, p_password: i.password, p_full_name: i.name, p_role: i.role })).error);
}

export async function updateUser(id: string, i: { name: string; role: Role; active: boolean }) {
  fail((await supabase.rpc('update_user', { p_id: id, p_full_name: i.name, p_role: i.role, p_active: i.active })).error);
}

export async function resetPassword(id: string, password: string) {
  fail((await supabase.rpc('reset_user_password', { p_id: id, p_password: password })).error);
}

/** a readable random password (no look-alike characters) */
export function generatePassword(len = 12): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#$%';
  const bytes = crypto.getRandomValues(new Uint32Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
