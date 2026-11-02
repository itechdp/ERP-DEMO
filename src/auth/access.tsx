// ---------------------------------------------------------------------------
// Sign-in (Supabase Auth) + configurable access.
//
// What a person may do is decided by the Director / Plant Head in Settings → Access Control and stored in the database:
//   PAGES   per role: hidden | read | write         (the database refuses an action on a page that is not "write")
//   FIELDS  per role: five kinds of sensitive information, each shown or hidden
//             party_names · invoices · purchase_rates · sales_rates · die_cost
//           The database withholds hidden values; the screens then drop the column / line / field (nothing is blurred).
//
// Director and Plant Head always have full access. The settings are read from the view v_my_access, never from the browser.
// See supabase/migrations/18_access_control.sql and supabase/PLAN.md §10.
// ---------------------------------------------------------------------------
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase, dbConfigured, dbMessage } from '../db/client';
import { resetUnits } from '../units/useUnits';

export type Role = 'director' | 'plant_head' | 'accounts' | 'qc' | 'operator' | 'viewer';

export const ROLES: { value: Role; label: string; hint: string; editable: boolean }[] = [
  { value: 'director', label: 'Director', hint: 'Full access', editable: false },
  { value: 'plant_head', label: 'Plant Head', hint: 'Configurable', editable: true },
  { value: 'accounts', label: 'Accounts Team', hint: 'Configurable', editable: true },
  { value: 'qc', label: 'QC Inspector', hint: 'Configurable', editable: true },
  { value: 'operator', label: 'Operator', hint: 'Configurable', editable: true },
  { value: 'viewer', label: 'Viewer', hint: 'Configurable', editable: true },
];

export type Level = 'hidden' | 'read' | 'write';
export type FieldGroup = 'party_names' | 'invoices' | 'purchase_rates' | 'sales_rates' | 'die_cost' | 'margins';

export {
  APP_RESOURCES,
  ROUTE_RESOURCE,
  WRITABLE_PAGES,
  getAllDefaultPagesForRole,
  getDefaultPageLevel,
  getPageOverrides,
} from './appResources';
import {
  APP_RESOURCES,
  ROUTE_RESOURCE,
  getAllDefaultPagesForRole,
  getPageOverrides,
} from './appResources';

export interface Session {
  email: string;
  name: string;
  role: Role;
  /** page key → hidden | read | write */
  pages: Record<string, Level>;
  /** information type → may this person see it */
  fields: Record<string, boolean>;
  /** Director / Plant Head: may open Settings → Access Control */
  canManageAccess: boolean;
  /** true when migration 18 is not installed yet — the app then falls back to the old fixed rules (Settings shows how to install it) */
  legacy: boolean;
}

// Module-level mirror of the current permissions, for code that is not a React component (print templates, Excel export,
// search filters). Defaults to NO access, so anything that runs while signed out shows nothing sensitive.
let current: Session | null = null;
export const canSee = (g: FieldGroup) => !!current?.fields[g];
/** the signed-in person's name, for printouts and exports */
export const currentUserName = () => current?.name || current?.email || '';
export const levelOf = (resource: string): Level => current?.pages[resource] ?? 'hidden';
export const canWriteNow = (resource: string) => levelOf(resource) === 'write';
/** a column the admin added to the protected list (Settings → Access Control → Add data column); not in the list = visible */
export const colOk = (key: string) => !!current && current.fields['col:' + key] !== false;

/** Text for printouts / exports: the real value, or nothing at all. */
export const maskText = (v: string | number | null | undefined, g: FieldGroup = 'party_names'): string => (v == null || v === '' || !canSee(g) ? '' : String(v));
/** For search filters: a role without access must not be able to probe hidden values by typing them. */
export const searchable = (v: string | undefined, g: FieldGroup = 'party_names'): string | undefined => (canSee(g) ? v : '');
export const searchableCol = (v: string | undefined, key: string): string | undefined => (colOk(key) ? v : '');

interface AccessValue {
  /** null = signed out */
  user: Session | null;
  /** true while the stored session is being checked on start-up */
  loading: boolean;
  role: Role;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  /** re-reads this person's access (after an admin changed it) */
  reloadAccess: () => Promise<void>;
  can: (g: FieldGroup) => boolean;
  /** a catalog column (see colOk) */
  col: (key: string) => boolean;
  level: (resource: string) => Level;
  canRead: (resource: string) => boolean;
  canWrite: (resource: string) => boolean;
  canManageAccess: boolean;
}
const Ctx = createContext<AccessValue | null>(null);

type Meta = { full_name?: string };
const ALL_FIELDS: FieldGroup[] = ['party_names', 'invoices', 'purchase_rates', 'sales_rates', 'die_cost', 'margins'];

/** Reads who the database says this user is and what they may see / do. null = no active profile. */
async function loadSession(): Promise<Session | null> {
  const { data: auth } = await supabase.auth.getSession();
  const u = auth.session?.user;
  if (!u) return null;
  const base = { email: u.email ?? '', name: (u.user_metadata as Meta | undefined)?.full_name || u.email || 'User' };

  const access = await supabase.from('v_my_access').select('role, can_manage_access, pages, fields').maybeSingle();
  if (!access.error && access.data) {
    const role = access.data.role as Role;
    const defaults = getAllDefaultPagesForRole(role);
    const overrides = getPageOverrides()[role] || {};
    const dbPages = (access.data.pages as Record<string, Level>) || {};
    const mergedPages: Record<string, Level> = {
      ...defaults,
      ...overrides,
      ...dbPages,
    };
    if (role === 'director') {
      for (const r of APP_RESOURCES) {
        mergedPages[r.key] = r.writable ? 'write' : 'read';
      }
    }
    return {
      ...base,
      role,
      pages: mergedPages,
      fields: (access.data.fields as Record<string, boolean>) || {},
      canManageAccess: !!access.data.can_manage_access || role === 'director' || role === 'plant_head',
      legacy: false,
    };
  }

  // Migration 18 not installed yet: fall back to the old fixed rules from v_me so the app keeps working.
  const { data: me, error } = await supabase.from('v_me').select('role, can_see_confidential, can_see_management').maybeSingle();
  if (error || !me) return null;
  const pages: Record<string, Level> = {};
  for (const r of Object.values(ROUTE_RESOURCE)) pages[r] = 'write';
  pages.products = me.can_see_management ? 'write' : 'read';
  for (const r of ['dashboard', 'finished_goods', 'die_details', 'traceability', 'ledger']) pages[r] = 'read';
  return { ...base, role: me.role as Role, pages, fields: Object.fromEntries(ALL_FIELDS.map((g) => [g, !!me.can_see_confidential])), canManageAccess: !!me.can_see_management, legacy: true };
}

/** A new sign-in (or sign-out) always starts on the dashboard, never on the previous user's last page. */
function goHome() {
  resetUnits();
  try {
    window.location.hash = '/dashboard';
  } catch {
    /* no window — nothing to reset */
  }
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(null);
  const [loading, setLoading] = useState(dbConfigured);

  const apply = useCallback((s: Session | null) => {
    current = s;
    setUser(s);
  }, []);

  useEffect(() => {
    if (!dbConfigured) return;
    let alive = true;
    loadSession()
      .then((s) => alive && apply(s))
      .catch(() => alive && apply(null))
      .finally(() => alive && setLoading(false));
    // signed out in another tab, or the session expired
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') apply(null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [apply]);

  const reloadAccess = useCallback(async () => {
    try {
      const s = await loadSession();
      if (s) apply(s);
    } catch {
      /* keep what we have */
    }
  }, [apply]);

  // an admin may have changed this person's access while they were working: pick it up when they come back to the tab
  useEffect(() => {
    if (!user) return;
    const onFocus = () => void reloadAccess();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, reloadAccess]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (!dbConfigured) return 'Supabase is not configured — fill in .env and restart.';
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return /invalid login/i.test(error.message) ? 'Invalid email or password.' : dbMessage(error);
      const s = await loadSession();
      if (!s) {
        await supabase.auth.signOut();
        return 'Your account is not active. Ask the Director to enable it.';
      }
      goHome();
      apply(s);
      return null;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    goHome();
    apply(null);
  }, [apply]);

  const value = useMemo<AccessValue>(() => {
    const level = (r: string): Level => user?.pages[r] ?? 'hidden';
    return {
      user,
      loading,
      role: user?.role ?? 'viewer',
      login,
      logout,
      reloadAccess,
      can: (g) => !!user?.fields[g],
      col: (k) => !!user && user.fields['col:' + k] !== false,
      level,
      canRead: (r) => level(r) !== 'hidden',
      canWrite: (r) => level(r) === 'write',
      canManageAccess: !!user?.canManageAccess,
    };
  }, [user, loading, login, logout, reloadAccess]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAccess outside RoleProvider');
  return v;
}

/**
 * Renders its children only when this person may see that kind of information. Otherwise it renders NOTHING — no blur, no dots —
 * so wrap the whole column (`<th>` and `<td>`), line or field, title included, not just the value.
 */
export function Conf({ g, col, children }: { g?: FieldGroup; col?: string; children?: ReactNode }) {
  const { can, col: colVisible } = useAccess();
  const ok = (g ? can(g) : true) && (col ? colVisible(col) : true);
  return ok ? <>{children}</> : null;
}

/** Renders its children only when the person has Write access to that page (for buttons that change data). */
export function Write({ res, children }: { res: string; children?: ReactNode }) {
  const { canWrite } = useAccess();
  return canWrite(res) ? <>{children}</> : null;
}
