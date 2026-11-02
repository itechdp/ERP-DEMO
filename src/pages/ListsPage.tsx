import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Confirm, Empty, Field, Modal, PageHeader } from '../components/ui';
import { MaterialModal } from '../masters/AddItem';
import { OPTION_LISTS, defaultsOf } from '../masters/optionLists';
import { deleteMaterial, saveMasterName, saveOptionList } from '../masters/service';
import type { MasterRow } from '../masters/types';
import { MATERIAL_FAMILIES, MATERIAL_MASTER, type MaterialSpec } from '../store/materials';
import { useStore } from '../store/StoreContext';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const STAGES: [string, string][] = [['cutting', 'Cutting'], ['forging', 'Forging'], ['trimming', 'Trimming'], ['heatTreatment', 'Heat Treatment']];

type Pick = { kind: 'materials' } | { kind: 'list'; key: string } | { kind: 'master'; which: 'machine' | 'operator' | 'inspector' };
const same = (a: Pick, b: Pick) => JSON.stringify(a) === JSON.stringify(b);

/** Settings → Drop-down Lists: every list behind a drop-down in one place. Director / Plant Head only. */
export function ListsPage() {
  const [pick, setPick] = useState<Pick>({ kind: 'materials' });
  const entries: { pick: Pick; label: string; hint: string }[] = [
    { pick: { kind: 'materials' }, label: 'Raw materials', hint: 'The Material drop-down (stock, products, jobs)' },
    ...OPTION_LISTS.map((l) => ({ pick: { kind: 'list', key: l.key } as Pick, label: l.label, hint: l.hint })),
    { pick: { kind: 'master', which: 'machine' }, label: 'Machines', hint: 'Cutting, forging, trimming, heat-treatment machines' },
    { pick: { kind: 'master', which: 'operator' }, label: 'Operators', hint: 'The operator names offered when a stage is run' },
    { pick: { kind: 'master', which: 'inspector' }, label: 'Inspectors', hint: 'The inspector names offered in QC and hardness' },
  ];
  const cur = entries.find((e) => same(e.pick, pick)) ?? entries[0];

  return (
    <>
      <PageHeader eyebrow="Settings" title="Drop-down Lists" subtitle="Add, rename, reorder or remove the choices offered in the forms. You can also add a choice straight from a drop-down (the last line, “+ Add new…”)." />
      <div className="lists-layout">
        <nav className="card lists-nav" aria-label="Lists">
          {entries.map((e) => (
            <button key={e.label} className={`lists-nav-item ${same(e.pick, pick) ? 'on' : ''}`} onClick={() => setPick(e.pick)}>
              <span className="strong">{e.label}</span>
              <span className="text-xs muted">{e.hint}</span>
            </button>
          ))}
        </nav>
        <div className="card lists-body">
          <div className="card-head"><h3 style={{ margin: 0 }}>{cur.label}</h3></div>
          <div style={{ padding: 16 }}>
            {pick.kind === 'materials' && <MaterialsEditor />}
            {pick.kind === 'list' && <OptionEditor key={pick.key} listKey={pick.key} />}
            {pick.kind === 'master' && <MasterEditor key={pick.which} which={pick.which} />}
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ a plain list
function OptionEditor({ listKey }: { listKey: string }) {
  const { masters, refresh, toast } = useStore();
  const def = OPTION_LISTS.find((l) => l.key === listKey)!;
  const saved = masters.options[listKey] ?? defaultsOf(listKey);
  const [items, setItems] = useState<string[]>(saved);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setItems(saved), [saved.join('\u0001')]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = items.join('\u0001') !== saved.join('\u0001');

  const move = (i: number, d: -1 | 1) =>
    setItems((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (def.unit && !(Number(v) > 0)) return toast({ kind: 'error', title: 'Enter a number', message: `Sizes are numbers in ${def.unit}.` });
    if (items.some((x) => x.toLowerCase() === v.toLowerCase())) return toast({ kind: 'error', title: 'Already in the list', message: v });
    setItems((l) => [...l, def.unit ? String(Number(v)) : v]);
    setDraft('');
  };
  const save = async (list: string[]) => {
    setBusy(true);
    try {
      await saveOptionList(listKey, list);
      await refresh();
      toast({ kind: 'success', title: 'List saved', message: def.label });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the list', message: errText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm muted" style={{ marginTop: 0 }}>{def.hint} Saved records keep what they were saved with, whatever you change here.</p>
      <ul className="opt-list">
        {items.map((it, i) => (
          <li key={i} className="opt-row">
            <span className="mono muted opt-n">{i + 1}</span>
            <input className="input" value={it} type={def.unit ? 'number' : 'text'} step="any" onChange={(e) => setItems((l) => l.map((x, k) => (k === i ? e.target.value : x)))} />
            {def.unit && <span className="muted">{def.unit}</span>}
            <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={15} /></button>
            <button className="icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={15} /></button>
            <button className="icon-btn danger" title="Remove" disabled={items.length <= 1} onClick={() => setItems((l) => l.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input className="input" value={draft} type={def.unit ? 'number' : 'text'} step="any" placeholder={def.unit ? `New size (${def.unit})` : 'New item'} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} style={{ maxWidth: 280 }} />
        <button className="btn btn-subtle" onClick={add}><Plus size={15} /> Add</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save(items)}>{busy ? 'Saving…' : 'Save List'}</button>
        <button className="btn btn-subtle" disabled={!dirty || busy} onClick={() => setItems(saved)}>Discard changes</button>
        <button className="btn btn-subtle" disabled={busy} style={{ marginLeft: 'auto' }} title="Go back to the built-in choices" onClick={() => void save(defaultsOf(listKey))}><RotateCcw size={14} /> Reset to built-in</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ raw materials
function MaterialsEditor() {
  const { refresh, toast } = useStore();
  const [editing, setEditing] = useState<MaterialSpec | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MaterialSpec | null>(null);
  const remove = async (m: MaterialSpec) => {
    try {
      await deleteMaterial(m.material);
      await refresh();
      toast({ kind: 'success', title: 'Material deleted', message: m.material });
    } catch (e) {
      toast({ kind: 'error', title: 'Could not delete', message: errText(e) });
    }
  };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <p className="text-sm muted" style={{ margin: 0 }}>A material that is already used by stock, products or jobs can be renamed or edited, but not deleted.</p>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}><Plus size={15} /> Add Material</button>
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Family</th><th>Material</th><th>Grade / specification</th><th className="r">Density</th><th className="r">Usual size</th><th className="act">Actions</th></tr>
          </thead>
          <tbody>
            {MATERIAL_FAMILIES.flatMap((fam) => MATERIAL_MASTER.filter((m) => m.family === fam)).map((m) => (
              <tr key={m.material}>
                <td>{m.family}</td>
                <td className="strong">{m.material}</td>
                <td>{m.grade}</td>
                <td className="r num">{m.density}</td>
                <td className="r num">{m.defaultOd} mm</td>
                <td className="r nowrap">
                  <div className="icon-actions">
                    <button className="icon-btn" title="Edit" aria-label={`Edit ${m.material}`} onClick={() => setEditing(m)}><Pencil size={16} /></button>
                    <button className="icon-btn danger" title="Delete" aria-label={`Delete ${m.material}`} onClick={() => setDeleting(m)}><Trash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <MaterialModal edit={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />}
      <Confirm open={!!deleting} title="Delete material" message={deleting ? `Delete ${deleting.material}?` : ''} confirmLabel="Delete" tone="danger" onConfirm={() => deleting && void remove(deleting)} onClose={() => setDeleting(null)} />
    </>
  );
}

// ------------------------------------------------------------------ machines / operators / inspectors
function MasterEditor({ which }: { which: 'machine' | 'operator' | 'inspector' }) {
  const { masters, refresh, toast } = useStore();
  const rows: MasterRow[] = which === 'machine' ? masters.rows.machines : which === 'operator' ? masters.rows.operators : masters.rows.inspectors;
  const [editing, setEditing] = useState<MasterRow | 'new' | null>(null);
  const toggle = async (r: MasterRow) => {
    try {
      await saveMasterName(which, r.id, r.name, r.stage ?? null, !r.active);
      await refresh();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not change it', message: errText(e) });
    }
  };
  const noun = which === 'machine' ? 'machine' : which === 'operator' ? 'operator' : 'inspector';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <p className="text-sm muted" style={{ margin: 0 }}>Switch one off to stop offering it in the forms — nothing already saved changes.</p>
        <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing('new')}><Plus size={15} /> Add {noun}</button>
      </div>
      {rows.length === 0 ? (
        <Empty icon={ListOrdered} title={`No ${noun}s yet`} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Name</th>{which === 'machine' && <th>Process</th>}<th>Status</th><th className="act">Actions</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.active ? undefined : { opacity: 0.6 }}>
                  <td className="strong">{r.name}</td>
                  {which === 'machine' && <td>{STAGES.find(([k]) => k === r.stage)?.[1] ?? r.stage}</td>}
                  <td><button role="switch" aria-checked={r.active} aria-label={`${r.name} in use`} className={`tg ${r.active ? 'on' : ''}`} onClick={() => void toggle(r)} /></td>
                  <td className="r nowrap"><button className="icon-btn" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <MasterModal which={which} row={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MasterModal({ which, row, onClose }: { which: 'machine' | 'operator' | 'inspector'; row?: MasterRow; onClose: () => void }) {
  const { refresh, toast } = useStore();
  const [name, setName] = useState(row?.name ?? '');
  const [stage, setStage] = useState(row?.stage ?? 'cutting');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await saveMasterName(which, row?.id ?? null, name.trim(), which === 'machine' ? stage : null, row?.active ?? true);
      await refresh();
      toast({ kind: 'success', title: row ? 'Saved' : 'Added', message: name.trim() });
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: errText(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={`${row ? 'Edit' : 'Add'} ${which}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Field label="Name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        {which === 'machine' && (
          <Field label="Process" required>
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
