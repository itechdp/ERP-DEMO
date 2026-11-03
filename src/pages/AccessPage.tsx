// Settings → Access Control: the Director / Plant Head decide, per role, which pages open (hidden / read / write)
// and which kinds of sensitive information are visible. Everything is stored in the database and enforced there.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { useAccess, ROLES, type Level, type Role } from '../auth/access';
import { loadAccessMatrix, type AccessMatrix } from '../db/load';
import * as api from '../db/api';
import { dbMessage } from '../db/client';
import { Empty, Modal, PageHeader, Tabs } from '../components/ui';

type Draft = { pages: Record<string, Level>; fields: Record<string, boolean> };

const LEVELS: { value: Level; label: string; icon: typeof Eye; hint: string }[] = [
  { value: 'hidden', label: 'Hidden', icon: EyeOff, hint: 'Removed from the menu; the page cannot be opened' },
  { value: 'read', label: 'Read', icon: Eye, hint: 'Can open and look, cannot change anything' },
  { value: 'write', label: 'Write', icon: Pencil, hint: 'Can open, enter and change data' },
];

/** small segmented control: one option is always selected */
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon: typeof Eye; hint: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.hint} className={`seg-btn tone-${o.value} ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          <o.icon size={14} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

const same = (a: Draft, b: Draft) => JSON.stringify([a.pages, a.fields]) === JSON.stringify([b.pages, b.fields]);

export function AccessPage() {
  const { run } = useStore();
  const { reloadAccess } = useAccess();
  const [matrix, setMatrix] = useState<AccessMatrix | null>(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState<Role>('accounts');
  const [drafts, setDrafts] = useState<Partial<Record<Role, Draft>>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keepDrafts = false) => {
    setError('');
    try {
      const m = await loadAccessMatrix();
      setMatrix(m);
      // keep what the admin has already edited, and give new columns their starting value
      setDrafts((prev) => {
        if (!keepDrafts) return {};
        const next: Partial<Record<Role, Draft>> = {};
        for (const r of Object.keys(prev) as Role[]) {
          const d = structuredClone(prev[r]!);
          for (const [k, v] of Object.entries(m.fields[r] ?? {})) if (!(k in d.fields)) d.fields[k] = v;
          for (const k of Object.keys(d.fields)) if (!(k in (m.fields[r] ?? {}))) delete d.fields[k];
          next[r] = d;
        }
        return next;
      });
    } catch (e) {
      setError(dbMessage(e));
    }
  }, []);
  useEffect(() => void load(), [load]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const saved = (r: Role): Draft => ({ pages: { ...(matrix?.pages[r] ?? {}) }, fields: { ...(matrix?.fields[r] ?? {}) } });
  const shown = (r: Role): Draft => drafts[r] ?? saved(r);
  const dirtyRoles = useMemo(() => (matrix ? (Object.keys(drafts) as Role[]).filter((r) => drafts[r] && !same(drafts[r]!, saved(r))) : []), [drafts, matrix]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn: (d: Draft) => void) =>
    setDrafts((all) => {
      const next = structuredClone(all[role] ?? saved(role));
      fn(next);
      return { ...all, [role]: next };
    });

  const notInstalled = /app_resources|role_page_access|schema cache|could not find/i.test(error);
  if (error)
    return (
      <>
        <PageHeader eyebrow="Settings" title="Access Control" />
        <div className="card">
          <Empty
            icon={KeyRound}
            title={notInstalled ? 'One database step is missing' : 'Access settings are not available'}
            text={notInstalled ? 'Run supabase/migrations/18_access_control.sql once in the Supabase SQL editor, then reload this page. Until then the app uses the standard fixed access rules.' : error}
            action={<button className="btn btn-primary" onClick={() => void load()}>Try again</button>}
          />
        </div>
      </>
    );
  if (!matrix)
    return (
      <>
        <PageHeader eyebrow="Settings" title="Access Control" />
        <div className="card" style={{ padding: 28 }}>
          <span className="muted">Loading access settings…</span>
        </div>
      </>
    );

  const cur = shown(role);
  const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)!.label;
  const counts = { write: 0, read: 0, hidden: 0 };
  for (const r of matrix.resources) counts[cur.pages[r.key] ?? 'hidden']++;
  const builtIn = matrix.groups.filter((g) => !g.isCustom);
  const added = matrix.groups.filter((g) => g.isCustom);
  const visibleFields = builtIn.filter((g) => cur.fields[g.key]).length;
  const addedKeys = new Set(added.map((g) => g.catalogKey));
  const catalogPages = [...new Set(matrix.catalog.map((c) => c.pageLabel))];
  const SECTION_ORDER = ['Main Menu', 'Sales & Orders', 'Purchase & Procurement', 'Workflow', 'Die Management', 'Reports & Masters'];
  const sections = [...new Set(matrix.resources.map((r) => r.section))].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  const setAllPages = (level: Level) =>
    edit((d) => {
      for (const r of matrix.resources) d.pages[r.key] = level === 'write' && !r.writable ? 'read' : level;
    });

  const save = async () => {
    setBusy(true);
    const ok = await run(
      async () => {
        for (const r of dirtyRoles) await api.saveRoleAccess(r, drafts[r]!.pages, drafts[r]!.fields);
      },
      { title: 'Access saved', message: `${dirtyRoles.map(roleLabel).join(', ')} — applies the next time they open or return to the app.` },
    );
    setBusy(false);
    if (ok) {
      await load();
      void reloadAccess();
    }
  };

  const addColumns = async () => {
    setBusy(true);
    const ok = await run(() => api.addProtectedColumns(picked), { title: picked.length === 1 ? 'Column added' : `${picked.length} columns added`, message: 'New items start Visible for Accounts and Hidden for QC, Operator and Viewer — change them below.' });
    setBusy(false);
    if (ok) {
      setPicking(false);
      setPicked([]);
      await load(true);
    }
  };

  const removeColumn = async (key: string, label: string) => {
    if (!window.confirm(`Remove "${label}" from the list? It becomes visible to every role again.`)) return;
    setBusy(true);
    const ok = await run(() => api.removeProtectedColumn(key), { title: 'Column removed', message: label });
    setBusy(false);
    if (ok) await load(true);
  };

  const reset = async () => {
    if (!window.confirm(`Reset ${roleLabel(role)} to the standard settings? Any unsaved changes for this role are lost.`)) return;
    setBusy(true);
    const ok = await run(() => api.resetRoleAccess(role), { title: 'Reset to standard', message: roleLabel(role) });
    setBusy(false);
    if (ok) await load();
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Access Control" />

      <div className="card acc-card">
        <div className="acc-fixed">
          <Lock size={15} />
          <span>
            <b>Director</b> always has full access and cannot be changed, so nobody can lock the administrator out.
          </span>
        </div>

        <div className="toolbar" style={{ paddingBottom: 10 }}>
          <Tabs value={role} onChange={setRole} items={ROLES.filter((r) => r.editable).map((r) => ({ value: r.value, label: r.label, tone: 'blue' as const }))} />
        </div>
        <div className="acc-subbar">
          <div className="acc-sum" aria-live="polite">
            <span className="badge b-green">{counts.write} Write</span>
            <span className="badge b-blue">{counts.read} Read</span>
            <span className="badge b-neutral">{counts.hidden} Hidden</span>
            <span className="muted">· sensitive info visible: {visibleFields} of {builtIn.length}{added.length > 0 && ` + ${added.filter((g) => cur.fields[g.key]).length} of ${added.length} added`}</span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => void reset()} disabled={busy}>
            <RotateCcw size={14} /> Reset to standard
          </button>
        </div>

        {/* ---------------------------------------------------------------- pages */}
        <div className="acc-block">
          <div className="acc-title">
            <h3>Pages</h3>
            <span className="acc-bulk">
              Set all:
              {LEVELS.map((l) => (
                <button key={l.value} className="btn-link" onClick={() => setAllPages(l.value)}>
                  {l.label}
                </button>
              ))}
            </span>
          </div>
          {sections.map((sec) => (
            <div className="acc-sec" key={sec}>
              <div className="acc-sec-h">{sec}</div>
              {matrix.resources
                .filter((r) => r.section === sec && !r.key.includes('__'))
                .flatMap((r) => [r, ...matrix.resources.filter((t) => t.key.startsWith(`${r.key}__`))])
                .map((r) => (
                  <div className={`acc-row ${r.key.includes('__') ? 'acc-tab' : ''}`} key={r.key}>
                    <div className="acc-name">
                      <b>{r.key.includes('__') ? r.label.split(' › ').slice(1).join(' › ') : r.label}</b>
                      {r.key.includes('__') ? <span className="muted">tab</span> : !r.writable && <span className="muted">view-only page</span>}
                    </div>
                    <Seg
                      label={`${r.label} access for ${roleLabel(role)}`}
                      value={cur.pages[r.key] ?? 'hidden'}
                      options={LEVELS.filter((l) => r.writable || l.value !== 'write')}
                      onChange={(v) => edit((d) => void (d.pages[r.key] = v))}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>

        {/* ------------------------------------------------------ sensitive info */}
        <div className="acc-block">
          <div className="acc-title">
            <h3>Sensitive information</h3>
            <button className="btn btn-sm acc-add" disabled={matrix.catalog.length === 0} title={matrix.catalog.length === 0 ? 'Run supabase/migrations/19_custom_protected_columns.sql once to enable this' : undefined} onClick={() => { setPicked([]); setPicking(true); }}>
              <Plus size={14} /> Add data column
            </button>
          </div>
          <div className="acc-sec">
            {builtIn.map((g) => (
                <div className="acc-row" key={g.key}>
                  <div className="acc-name">
                    <b>
                      {g.label}
                    </b>
                    <span className="muted">{g.description}</span>
                  </div>
                  <div className="acc-ctl">
                    <Seg
                      label={`${g.label} for ${roleLabel(role)}`}
                      value={cur.fields[g.key] ? 'write' : 'hidden'}
                      options={[
                        { value: 'hidden', label: 'Hidden', icon: EyeOff, hint: 'Not shown anywhere to this role' },
                        { value: 'write', label: 'Visible', icon: Eye, hint: 'Shown to this role' },
                      ]}
                      onChange={(v) => edit((d) => void (d.fields[g.key] = v === 'write'))}
                    />
                  </div>
                </div>
            ))}
          </div>
          {added.length > 0 && (
            <div className="acc-sec">
              <div className="acc-sec-h">Columns you added</div>
              {added.map((g) => (
                <div className="acc-row" key={g.key}>
                  <div className="acc-name">
                    <b>
                      {g.label}
                      <span className="acc-tag">{g.description}</span>
                    </b>
                    
                  </div>
                  <div className="acc-ctl">
                    <Seg
                      label={`${g.label} for ${roleLabel(role)}`}
                      value={cur.fields[g.key] ? 'write' : 'hidden'}
                      options={[
                        { value: 'hidden', label: 'Hidden', icon: EyeOff, hint: 'Not shown anywhere to this role' },
                        { value: 'write', label: 'Visible', icon: Eye, hint: 'Shown to this role' },
                      ]}
                      onChange={(v) => edit((d) => void (d.fields[g.key] = v === 'write'))}
                    />
                    <button className="icon-btn acc-del" title="Remove from the list (the column becomes visible to everyone again)" aria-label={`Remove ${g.label}`} onClick={() => void removeColumn(g.catalogKey!, g.label)} disabled={busy}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {picking && (
        <Modal
          open
          onClose={() => setPicking(false)}
          icon={Plus}
          title="Add data column"
          subtitle="Pick the columns you want to protect. New items start Visible for Accounts and Hidden for QC, Operator and Viewer — you can change that afterwards."
          footer={
            <>
              <button className="btn" onClick={() => setPicking(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={picked.length === 0 || busy} onClick={() => void addColumns()}>
                {picked.length ? `Add ${picked.length} column${picked.length === 1 ? '' : 's'}` : 'Add'}
              </button>
            </>
          }
        >
          {catalogPages.map((page) => (
            <div className="pick-group" key={page}>
              <div className="acc-sec-h">{page}</div>
              {matrix.catalog
                .filter((c) => c.pageLabel === page)
                .map((c) => {
                  const done = addedKeys.has(c.key);
                  return (
                    <label className={`pick-row ${done ? 'done' : ''}`} key={c.key}>
                      <input type="checkbox" disabled={done} checked={done || picked.includes(c.key)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.key] : p.filter((k) => k !== c.key)))} />
                      <span>{c.label}</span>
                      {done && <span className="muted">already in the list</span>}
                    </label>
                  );
                })}
            </div>
          ))}
        </Modal>
      )}

      {dirtyRoles.length > 0 && (
        <div className="savebar" role="status">
          <span>
            Unsaved changes for <b>{dirtyRoles.map(roleLabel).join(', ')}</b>
          </span>
          <button className="btn" onClick={() => setDrafts({})} disabled={busy}>
            Discard
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            <Save size={15} /> {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </>
  );
}
