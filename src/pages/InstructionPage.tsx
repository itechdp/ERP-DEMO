import { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Eye, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Write, currentUserName } from '../auth/access';
import { Confirm, Empty, Field, FilterMenu, Modal, PageHeader, Search } from '../components/ui';
import { fmtDate, matches, todayISO } from '../components/format';
import { usePaged } from '../components/Pager';
import { DocButtons, ListButtons } from '../export/docOutput';
import * as docs from '../export/documents';
import { FORM_FORMATS } from '../export/xlsxSheet';
import { INSTRUCTION_PROCESSES, deleteInstruction, saveInstruction, setInstructionStatus, stepLines, useInstructions, type Instruction, type InstructionInput, type InstructionParam, type InstructionStatus } from '../instructions/service';
import { useStore } from '../store/StoreContext';

const STATUS_CHIP: Record<InstructionStatus, string> = { Draft: 'chip chip-wait', Active: 'chip chip-up', Obsolete: 'chip chip-subtle' };

/**
 * Workflow → Instruction. The work instructions of the shop floor: for each process (and, if wanted, each product) what to do, step by step,
 * with which tools and settings, what to check and what to watch out for — each with a number, a revision, an effective date and a status.
 * Only ACTIVE instructions are meant to be followed; an old one is marked Obsolete, never deleted by mistake. Printable as a form (Excel / PDF).
 * Later: show the active instruction on the stage page, operator sign-off, attach drawings and photos, revision history.
 */
export function InstructionPage() {
  const { state, toast } = useStore();
  const ins = useInstructions();
  const [q, setQ] = useState('');
  const [procF, setProcF] = useState('all');
  const [statF, setStatF] = useState('all');
  const [prodF, setProdF] = useState('all');
  const [editing, setEditing] = useState<Instruction | 'new' | null>(null);
  const [viewing, setViewing] = useState<Instruction | null>(null);
  const [deleting, setDeleting] = useState<Instruction | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      await ins.reload();
      toast({ kind: 'success', title: done });
      return true;
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save', message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const rows = useMemo(
    () =>
      ins.items
        .filter((w) => procF === 'all' || w.process === procF)
        .filter((w) => statF === 'all' || w.status === statF)
        .filter((w) => prodF === 'all' || (prodF === 'none' ? !w.productId : w.productId === prodF))
        .filter((w) => matches(q, w.docNo, w.title, w.process, w.productName, w.tools, w.steps))
        .sort((a, b) => (a.status === 'Active' ? 0 : a.status === 'Draft' ? 1 : 2) - (b.status === 'Active' ? 0 : b.status === 'Draft' ? 1 : 2) || a.process.localeCompare(b.process) || a.title.localeCompare(b.title)),
    [ins.items, procF, statF, prodF, q],
  );
  const pg = usePaged(rows, `${procF}|${statF}|${prodF}|${q}`);
  const count = (s: InstructionStatus) => ins.items.filter((w) => w.status === s).length;

  const add = (
    <Write res="instruction">
      <button className="btn btn-primary" onClick={() => setEditing('new')}>
        <Plus size={15} /> New instruction
      </button>
    </Write>
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow"
        title="Instruction"
        subtitle="Work instructions for the shop floor, by process and product."
        actions={
          <>
            {ins.items.length > 0 && (
              <ListButtons
                doc={() => ({
                  filename: 'Work-Instructions',
                  title: 'Work Instruction Register',
                  form: FORM_FORMATS.workInstruction,
                  rows: rows.map((w) => ({ no: w.docNo, title: w.title, process: w.process, product: w.productName, rev: w.revNo, date: w.effectiveDate, status: w.status })),
                  cols: [{ label: 'Instruction No.', key: 'no' }, { label: 'Title', key: 'title', width: 36 }, { label: 'Process', key: 'process', width: 18 }, { label: 'Product', key: 'product', width: 24 }, { label: 'Rev.', key: 'rev' }, { label: 'Effective', key: 'date', kind: 'date' }, { label: 'Status', key: 'status' }],
                })}
              />
            )}
            {add}
          </>
        }
      />
      {ins.error && <div className="callout warn" style={{ marginBottom: 16 }}>{ins.error}</div>}
      <div className="fstats">
        <div className="fstat fstat-free"><span>Active</span><b>{count('Active')}</b></div>
        <div className={`fstat ${count('Draft') ? 'fstat-hold' : ''}`}><span>Draft</span><b>{count('Draft')}</b></div>
        <div className="fstat"><span>Obsolete</span><b>{count('Obsolete')}</b></div>
        <div className="fstat"><span>Processes covered</span><b>{new Set(ins.items.filter((w) => w.status === 'Active').map((w) => w.process)).size}</b></div>
      </div>

      <div className="card">
        {!ins.loaded ? (
          <div className="card-center-msg">Loading…</div>
        ) : ins.items.length === 0 ? (
          <Empty icon={BookOpen} title="No work instructions yet" text="Write down how a job is done — for a process or for one product: the steps, the tools and settings, what to check and what to watch out for. Give it a revision and activate it when it is ready." action={add} />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder="Search number, title, process, product, steps…" />
              <FilterMenu
                groups={[
                  { label: 'Process', value: procF, onChange: setProcF, options: [{ value: 'all', label: 'All processes' }, ...INSTRUCTION_PROCESSES.filter((p) => ins.items.some((w) => w.process === p)).map((p) => ({ value: p, label: p, count: ins.items.filter((w) => w.process === p).length }))] },
                  { label: 'Status', value: statF, onChange: setStatF, options: [{ value: 'all', label: 'All' }, ...(['Active', 'Draft', 'Obsolete'] as InstructionStatus[]).map((s) => ({ value: s, label: s, count: count(s) }))] },
                  { label: 'Product', value: prodF, onChange: setProdF, options: [{ value: 'all', label: 'All' }, { value: 'none', label: 'General (no product)' }, ...state.products.filter((p) => ins.items.some((w) => w.productId === p.id)).map((p) => ({ value: p.id, label: p.name }))] },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <Empty icon={BookOpen} title="No matches" text="Try a different search or filter." />
            ) : (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr><th>Instruction</th><th>Process</th><th>Product</th><th>Rev.</th><th>Effective</th><th>Status</th><th className="act">Action</th></tr>
                  </thead>
                  <tbody>
                    {pg.rows.map((w) => (
                      <tr key={w.id}>
                        <td>
                          <div className="strong">{w.title}</div>
                          <div className="sub mono">{w.docNo}</div>
                        </td>
                        <td>{w.process}</td>
                        <td>{w.productName || <span className="muted">General</span>}</td>
                        <td className="mono">{w.revNo}</td>
                        <td className="nowrap">{w.effectiveDate ? fmtDate(w.effectiveDate) : '—'}</td>
                        <td><span className={STATUS_CHIP[w.status]}>{w.status}</span></td>
                        <td className="r nowrap">
                          <div className="icon-actions">
                            <button className="icon-btn" title="View" aria-label={`View ${w.docNo}`} onClick={() => setViewing(w)}><Eye size={16} /></button>
                            <DocButtons compact build={(u) => docs.workInstructionSpec(w, u)} />
                            <Write res="instruction">
                              {w.status !== 'Active' && <button className="icon-btn" title="Make this the active instruction" aria-label="Activate" onClick={() => void act(() => setInstructionStatus(w.id, 'Active'), `${w.docNo} is active`)}><CheckCircle2 size={16} /></button>}
                              {w.status === 'Active' && <button className="icon-btn" title="Mark obsolete" aria-label="Mark obsolete" onClick={() => void act(() => setInstructionStatus(w.id, 'Obsolete'), `${w.docNo} marked obsolete`)}><X size={16} /></button>}
                              <button className="icon-btn" title="Edit" aria-label={`Edit ${w.docNo}`} onClick={() => setEditing(w)}><Pencil size={16} /></button>
                              <button className="icon-btn danger" title="Delete" aria-label={`Delete ${w.docNo}`} onClick={() => setDeleting(w)}><Trash2 size={16} /></button>
                            </Write>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pg.pager}
              </div>
            )}
          </>
        )}
      </div>

      {viewing && <ViewModal w={viewing} onClose={() => setViewing(null)} />}
      {editing && <InstructionForm entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={(i) => act(() => saveInstruction(editing === 'new' ? null : editing.id, i, currentUserName()), editing === 'new' ? 'Instruction saved' : 'Instruction updated')} />}
      <Confirm open={!!deleting} title="Delete instruction" tone="danger" confirmLabel="Delete" message={<>Delete <b>{deleting?.docNo}</b> — {deleting?.title}? To keep it on record, mark it Obsolete instead.</>} onClose={() => setDeleting(null)} onConfirm={() => { const d = deleting!; setDeleting(null); void act(() => deleteInstruction(d.id), 'Instruction deleted'); }} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ read
function ViewModal({ w, onClose }: { w: Instruction; onClose: () => void }) {
  const steps = stepLines(w.steps);
  const checks = stepLines(w.checks);
  const params = w.parameters.filter((p) => p.name.trim());
  const sec = (title: string, body: JSX.Element | null) => (body ? <div style={{ marginTop: 14 }}><div className="section-label">{title}</div>{body}</div> : null);
  return (
    <Modal open size="lg" onClose={onClose} icon={BookOpen} title={w.title} subtitle={`${w.docNo} · Rev. ${w.revNo} · ${w.process}${w.productName ? ` · ${w.productName}` : ''}${w.effectiveDate ? ` · from ${fmtDate(w.effectiveDate)}` : ''}`}
      footer={<><DocButtons build={(u) => docs.workInstructionSpec(w, u)} /><button className="btn" onClick={onClose}>Close</button></>}>
      <span className={STATUS_CHIP[w.status]}>{w.status}</span>
      {sec('Tools / equipment', w.tools ? <p style={{ margin: '6px 0 0' }}>{w.tools}</p> : null)}
      {sec('Steps', steps.length ? <ol style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>{steps.map((t, i) => <li key={i}>{t}</li>)}</ol> : null)}
      {sec('Settings / parameters', params.length ? <table className="tbl compact" style={{ marginTop: 6 }}><tbody>{params.map((p, i) => <tr key={i}><td className="strong">{p.name}</td><td>{p.value}</td></tr>)}</tbody></table> : null)}
      {sec('What to check', checks.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.6 }}>{checks.map((t, i) => <li key={i}>{t}</li>)}</ul> : null)}
      {sec('Safety', w.safety ? <div className="callout warn" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{w.safety}</div> : null)}
      {sec('Remarks', w.remarks ? <p style={{ margin: '6px 0 0' }}>{w.remarks}</p> : null)}
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ write
function InstructionForm({ entry, onClose, onSave }: { entry: Instruction | null; onClose: () => void; onSave: (i: InstructionInput) => Promise<boolean> }) {
  const { state } = useStore();
  const [f, setF] = useState<InstructionInput>({
    docNo: entry?.docNo ?? '',
    title: entry?.title ?? '',
    process: entry?.process ?? 'General',
    productId: entry?.productId ?? '',
    revNo: entry?.revNo ?? '00',
    effectiveDate: entry?.effectiveDate ?? todayISO(),
    status: entry?.status ?? 'Draft',
    tools: entry?.tools ?? '',
    steps: entry?.steps ?? '',
    parameters: entry?.parameters?.length ? entry.parameters : [{ name: '', value: '' }],
    checks: entry?.checks ?? '',
    safety: entry?.safety ?? '',
    remarks: entry?.remarks ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof InstructionInput>(k: K, v: InstructionInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setParam = (i: number, patch: Partial<InstructionParam>) => set('parameters', f.parameters.map((p, n) => (n === i ? { ...p, ...patch } : p)));
  const valid = f.title.trim() !== '' && stepLines(f.steps).length > 0;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    if (await onSave({ ...f, title: f.title.trim() })) onClose();
    setBusy(false);
  };
  return (
    <Modal open size="lg" onClose={onClose} icon={BookOpen} title={entry ? `Edit ${entry.docNo}` : 'New work instruction'} subtitle="Write the steps one per line — they are numbered for you."
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>Save</button></>}>
      <div className="form-grid">
        <Field label="Title" required full><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Heat treatment — stress relief of brass forgings" autoFocus /></Field>
        <Field label="Process" required>
          <select value={f.process} onChange={(e) => set('process', e.target.value)}>
            {INSTRUCTION_PROCESSES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Product" hint="Leave empty for a general instruction">
          <select value={f.productId} onChange={(e) => set('productId', e.target.value)}>
            <option value="">— general —</option>
            {state.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Instruction no." hint="Leave empty to number it automatically"><input className="input mono" value={f.docNo} onChange={(e) => set('docNo', e.target.value)} placeholder="WI-2026-0001" /></Field>
        <Field label="Revision"><input className="input mono" value={f.revNo} onChange={(e) => set('revNo', e.target.value)} /></Field>
        <Field label="Effective from"><input className="input" type="date" value={f.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} /></Field>
        <Field label="Status">
          <select value={f.status} onChange={(e) => set('status', e.target.value as InstructionStatus)}>
            <option>Draft</option>
            <option>Active</option>
            <option>Obsolete</option>
          </select>
        </Field>
        <Field label="Tools / equipment" full><input className="input" value={f.tools} onChange={(e) => set('tools', e.target.value)} placeholder="e.g. Vernier, depth gauge, 5-ton hoist" /></Field>
        <Field label="Steps" required full hint="One step per line"><textarea rows={7} value={f.steps} onChange={(e) => set('steps', e.target.value)} placeholder={'Load the batch on the tray\nSet the furnace to 550 °C\nSoak for 45 minutes\nCool in still air'} /></Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <div className="section-label">Settings / parameters</div>
          {f.parameters.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <input className="input" style={{ flex: 1 }} value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} placeholder="Parameter (e.g. Temperature)" />
              <input className="input" style={{ flex: 1 }} value={p.value} onChange={(e) => setParam(i, { value: e.target.value })} placeholder="Value (e.g. 550 °C)" />
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => set('parameters', f.parameters.length > 1 ? f.parameters.filter((_, n) => n !== i) : [{ name: '', value: '' }])}><X size={16} /></button>
            </div>
          ))}
          <button type="button" className="btn btn-subtle btn-sm" onClick={() => set('parameters', [...f.parameters, { name: '', value: '' }])}><Plus size={14} /> Add a setting</button>
        </div>
        <Field label="What to check" full hint="One check per line"><textarea rows={3} value={f.checks} onChange={(e) => set('checks', e.target.value)} placeholder={'Hardness within the required range\nNo cracks or surface burns'} /></Field>
        <Field label="Safety" full><textarea rows={2} value={f.safety} onChange={(e) => set('safety', e.target.value)} placeholder="e.g. Wear heat-resistant gloves and a face shield" /></Field>
        <Field label="Remarks" full><input className="input" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
