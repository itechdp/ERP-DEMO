import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Cog, Cpu, Pencil, Play, Plus, Square, Trash2, Wrench } from 'lucide-react';
import { Write, currentUserName } from '../auth/access';
import { Confirm, Empty, Field, FilterMenu, Modal, NumInput, PageHeader, Search, Tabs } from '../components/ui';
import { fmtDateTime, fmtNum, matches } from '../components/format';
import { usePaged } from '../components/Pager';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';
import { getProduct } from '../store/engine';
import { useStore } from '../store/StoreContext';
import { deleteMachine, deleteRun, finishRun, runTime, saveMachine, setMachineStatus, startRun, useMachining, type Machine, type MachineKind, type MachineStatus, type Run, type RunStatus } from './service';

const LABEL: Record<MachineKind, string> = { cnc: 'CNC', vmc: 'VMC' };
const MACHINE_CHIP: Record<MachineStatus, string> = { Available: 'chip chip-up', Running: 'chip chip-run', Maintenance: 'chip chip-wait', Breakdown: 'chip chip-hot' };
const RUN_CHIP: Record<RunStatus, string> = { Running: 'chip chip-run', Done: 'chip chip-up', Stopped: 'chip chip-subtle' };

/**
 * Workflow → Machinery → CNC / VMC. Two things per machine kind:
 *   · the MACHINES (name, make, controller, axes) and what each is doing now — Available, Running a job, in Maintenance, or Broken down
 *   · the RUN LOG: every job run on them — the part, the job card, the program number, the operator, how many were planned and made, how long it took
 * Starting a run puts the machine to Running; finishing it frees the machine again. Later: tool life, program library, OEE, maintenance plan.
 */
export function MachinePage({ kind }: { kind: MachineKind }) {
  const { toast } = useStore();
  const m = useMachining(kind);
  const [tab, setTab] = useState<'machines' | 'runs'>('machines');
  const [q, setQ] = useState('');
  const [machF, setMachF] = useState('all');
  const [statF, setStatF] = useState('all');
  const [editing, setEditing] = useState<Machine | 'new' | null>(null);
  const [starting, setStarting] = useState<Machine | 'any' | null>(null);
  const [finishing, setFinishing] = useState<Run | null>(null);
  const [delMachine, setDelMachine] = useState<Machine | null>(null);
  const [delRun, setDelRun] = useState<Run | null>(null);
  const Icon = kind === 'cnc' ? Cpu : Cog;

  const act = async (fn: () => Promise<unknown>, done: string, title = 'Could not save') => {
    try {
      await fn();
      await m.reload();
      toast({ kind: 'success', title: done });
      return true;
    } catch (e) {
      toast({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) });
      return false;
    }
  };

  const active = m.machines.filter((x) => x.active);
  const running = active.filter((x) => x.status === 'Running');
  const free = active.filter((x) => x.status === 'Available');
  const down = active.filter((x) => x.status === 'Maintenance' || x.status === 'Breakdown');
  const openRun = (machineId: number) => m.runs.find((r) => r.machineId === machineId && r.status === 'Running');

  const runRows = useMemo(
    () =>
      m.runs
        .filter((r) => machF === 'all' || String(r.machineId) === machF)
        .filter((r) => statF === 'all' || r.status === statF)
        .filter((r) => matches(q, r.machineName, r.part, r.jobNo, r.programNo, r.operator)),
    [m.runs, machF, statF, q],
  );
  const pg = usePaged(runRows, `${machF}|${statF}|${q}`);
  const pm = usePaged(m.machines, m.machines.length);

  const add = (
    <Write res={kind}>
      <button className="btn btn-primary" onClick={() => setEditing('new')}>
        <Plus size={15} /> Add {LABEL[kind]} machine
      </button>
    </Write>
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Machinery"
        title={LABEL[kind]}
        subtitle={`${LABEL[kind]} machines and the jobs run on them.`}
        actions={
          <>
            {m.runs.length > 0 && (
              <ListButtons
                doc={() => ({
                  filename: `${LABEL[kind]}-Run-Log`,
                  title: `${LABEL[kind]} Run Log`,
                  form: FORM_FORMATS.report,
                  rows: runRows.map((r) => ({ machine: r.machineName, part: r.part, job: r.jobNo, program: r.programNo, operator: r.operator, planned: r.qtyPlanned, done: r.qtyDone, started: r.startedAt.slice(0, 16).replace('T', ' '), took: runTime(r), cycle: r.cycleSec, status: r.status })),
                  cols: [{ label: 'Machine', key: 'machine', width: 18 }, { label: 'Part', key: 'part', width: 26 }, { label: 'Job No.', key: 'job' }, { label: 'Program', key: 'program' }, { label: 'Operator', key: 'operator', width: 18 }, { label: 'Planned', key: 'planned', kind: 'num' }, { label: 'Made', key: 'done', kind: 'num' }, { label: 'Started', key: 'started', width: 18 }, { label: 'Time', key: 'took' }, { label: 'Sec / piece', key: 'cycle', kind: 'num' }, { label: 'Status', key: 'status' }],
                  totals: ['planned', 'done'],
                })}
              />
            )}
            {add}
          </>
        }
      />
      {m.error && <div className="callout warn" style={{ marginBottom: 16 }}>{m.error}</div>}

      <div className="fstats">
        <div className="fstat"><span>Machines</span><b>{active.length}</b></div>
        <div className="fstat fstat-run"><span>Running</span><b>{running.length}</b></div>
        <div className="fstat fstat-free"><span>Available</span><b>{free.length}</b></div>
        <div className={`fstat ${down.length ? 'fstat-hold' : ''}`}><span>Maintenance / breakdown</span><b>{down.length}</b></div>
      </div>

      <div className="card">
        {!m.loaded ? (
          <div className="card-center-msg">Loading…</div>
        ) : m.machines.length === 0 ? (
          <Empty icon={Icon} title={`No ${LABEL[kind]} machines yet`} text={`Add your ${LABEL[kind]} machines first. Then start a job on a machine to keep the run log: which part, which program, who ran it, how many were made and how long it took.`} action={add} />
        ) : (
          <>
            <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
              <Tabs value={tab} onChange={setTab} items={[{ value: 'machines', label: 'Machines', count: m.machines.length }, { value: 'runs', label: 'Run log', count: m.runs.length }]} />
              {tab === 'runs' && (
                <div className="toolbar" style={{ padding: 0, marginLeft: 'auto' }}>
                  <Search value={q} onChange={setQ} placeholder="Search machine, part, job, program, operator…" />
                  <FilterMenu
                    groups={[
                      { label: 'Machine', value: machF, onChange: setMachF, options: [{ value: 'all', label: 'All machines' }, ...m.machines.map((x) => ({ value: String(x.id), label: x.name }))] },
                      { label: 'Status', value: statF, onChange: setStatF, options: [{ value: 'all', label: 'All' }, ...(['Running', 'Done', 'Stopped'] as RunStatus[]).map((s) => ({ value: s, label: s, count: m.runs.filter((r) => r.status === s).length }))] },
                    ]}
                  />
                </div>
              )}
              {tab === 'machines' && (
                <Write res={kind}>
                  <button className="btn btn-subtle" style={{ marginLeft: 'auto' }} onClick={() => setStarting('any')} disabled={free.length === 0} title={free.length ? '' : 'No machine is available'}>
                    <Play size={14} /> Start a job
                  </button>
                </Write>
              )}
            </div>

            {tab === 'machines' && (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr><th>Machine</th><th>Make / model</th><th>Controller · axes</th><th>Status</th><th>Running now</th><th className="act">Action</th></tr>
                  </thead>
                  <tbody>
                    {pm.rows.map((x) => {
                      const r = openRun(x.id);
                      return (
                        <tr key={x.id} style={x.active ? undefined : { opacity: 0.55 }}>
                          <td className="strong">{x.name}{!x.active && <span className="chip chip-subtle" style={{ marginLeft: 6 }}>inactive</span>}</td>
                          <td>{x.makeModel || '—'}</td>
                          <td>{[x.controller, x.axes].filter(Boolean).join(' · ') || '—'}</td>
                          <td><span className={MACHINE_CHIP[x.status]}>{x.status}</span></td>
                          <td>
                            {r ? (
                              <>
                                <div className="strong">{r.part}</div>
                                <div className="sub">{[r.jobNo, r.programNo && `Prog ${r.programNo}`, r.operator].filter(Boolean).join(' · ')} · {runTime(r)}</div>
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="r nowrap">
                            <Write res={kind}>
                              <div className="icon-actions">
                                {r ? (
                                  <button className="icon-btn" title="Finish the job" aria-label={`Finish the job on ${x.name}`} onClick={() => setFinishing(r)}><Square size={16} /></button>
                                ) : (
                                  <>
                                    {x.active && x.status === 'Available' && <button className="icon-btn" title="Start a job" aria-label={`Start a job on ${x.name}`} onClick={() => setStarting(x)}><Play size={16} /></button>}
                                    {x.status !== 'Maintenance' && <button className="icon-btn" title="Put under maintenance" aria-label="Maintenance" onClick={() => void act(() => setMachineStatus(x.id, 'Maintenance'), `${x.name} is under maintenance`)}><Wrench size={16} /></button>}
                                    {x.status !== 'Breakdown' && <button className="icon-btn" title="Mark as broken down" aria-label="Breakdown" onClick={() => void act(() => setMachineStatus(x.id, 'Breakdown'), `${x.name} marked as broken down`)}><AlertTriangle size={16} /></button>}
                                    {x.status !== 'Available' && <button className="icon-btn" title="Back to available" aria-label="Available" onClick={() => void act(() => setMachineStatus(x.id, 'Available'), `${x.name} is available`)}><CheckCircle2 size={16} /></button>}
                                  </>
                                )}
                                <button className="icon-btn" title="Edit" aria-label={`Edit ${x.name}`} onClick={() => setEditing(x)}><Pencil size={16} /></button>
                                {!r && <button className="icon-btn danger" title="Delete" aria-label={`Delete ${x.name}`} onClick={() => setDelMachine(x)}><Trash2 size={16} /></button>}
                              </div>
                            </Write>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pm.pager}
              </div>
            )}

            {tab === 'runs' &&
              (runRows.length === 0 ? (
                <Empty icon={Icon} title={m.runs.length ? 'No matches' : 'No jobs run yet'} text={m.runs.length ? 'Try a different search or filter.' : 'Start a job on a machine and it is logged here.'} />
              ) : (
                <div className="table-wrap">
                  <table className="tbl compact">
                    <thead>
                      <tr><th>Machine</th><th>Part / Job</th><th>Program</th><th>Operator</th><th className="r">Planned</th><th className="r">Made</th><th>Started</th><th>Time</th><th>Status</th><th className="act" /></tr>
                    </thead>
                    <tbody>
                      {pg.rows.map((r) => (
                        <tr key={r.id}>
                          <td className="strong">{r.machineName}</td>
                          <td>
                            <div className="strong">{r.part}</div>
                            {r.jobNo && <div className="sub mono">{r.jobNo}</div>}
                          </td>
                          <td className="mono">{r.programNo || '—'}</td>
                          <td>{r.operator || '—'}</td>
                          <td className="r">{r.qtyPlanned ? fmtNum(r.qtyPlanned) : '—'}</td>
                          <td className="r">{r.status === 'Running' ? <span className="muted">—</span> : fmtNum(r.qtyDone)}</td>
                          <td className="nowrap">{fmtDateTime(r.startedAt)}</td>
                          <td className="nowrap">{runTime(r)}{r.cycleSec ? <div className="sub">{r.cycleSec} s / piece</div> : null}</td>
                          <td><span className={RUN_CHIP[r.status]}>{r.status}</span></td>
                          <td className="r nowrap">
                            <Write res={kind}>
                              <div className="icon-actions">
                                {r.status === 'Running' && <button className="icon-btn" title="Finish the job" aria-label="Finish the job" onClick={() => setFinishing(r)}><Square size={16} /></button>}
                                <button className="icon-btn danger" title="Delete this run" aria-label="Delete this run" onClick={() => setDelRun(r)}><Trash2 size={16} /></button>
                              </div>
                            </Write>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pg.pager}
                </div>
              ))}
          </>
        )}
      </div>

      {editing && <MachineModal kind={kind} machine={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={(i) => act(() => saveMachine(kind, editing === 'new' ? null : editing.id, i), editing === 'new' ? 'Machine added' : 'Machine updated')} />}
      {starting && <StartModal machines={free} preset={starting === 'any' ? null : starting} onClose={() => setStarting(null)} onStart={(i) => act(() => startRun(i, currentUserName()), 'Job started', 'Could not start the job')} />}
      {finishing && <FinishModal run={finishing} onClose={() => setFinishing(null)} onFinish={(qty, status, remarks) => act(() => finishRun(finishing.id, qty, status, remarks), status === 'Done' ? 'Job finished' : 'Job stopped')} />}
      <Confirm open={!!delMachine} title="Delete machine" tone="danger" confirmLabel="Delete" message={<>Delete <b>{delMachine?.name}</b>? A machine that has runs on record cannot be deleted — mark it inactive instead (Edit).</>} onClose={() => setDelMachine(null)} onConfirm={() => { const d = delMachine!; setDelMachine(null); void act(() => deleteMachine(d.id), 'Machine deleted', 'Could not delete'); }} />
      <Confirm open={!!delRun} title="Delete this run" tone="danger" confirmLabel="Delete" message={<>Remove the run of <b>{delRun?.part}</b> on {delRun?.machineName} from the log?</>} onClose={() => setDelRun(null)} onConfirm={() => { const d = delRun!; setDelRun(null); void act(() => deleteRun(d.id), 'Run deleted', 'Could not delete'); }} />
    </>
  );
}

// ------------------------------------------------------------------------------------------------ forms
function MachineModal({ kind, machine, onClose, onSave }: { kind: MachineKind; machine: Machine | null; onClose: () => void; onSave: (i: { name: string; makeModel: string; controller: string; axes: string; notes: string; active: boolean }) => Promise<boolean> }) {
  const [name, setName] = useState(machine?.name ?? '');
  const [makeModel, setMake] = useState(machine?.makeModel ?? '');
  const [controller, setController] = useState(machine?.controller ?? '');
  const [axes, setAxes] = useState(machine?.axes ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [active, setActive] = useState(machine?.active ?? true);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    if (await onSave({ name: name.trim(), makeModel, controller, axes, notes, active })) onClose();
    setBusy(false);
  };
  return (
    <Modal open dialog onClose={onClose} title={machine ? `Edit ${machine.name}` : `Add ${LABEL[kind]} machine`} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || busy} onClick={submit}>Save</button></>}>
      <div className="form-grid">
        <Field label="Machine name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${LABEL[kind]}-01`} autoFocus /></Field>
        <Field label="Make / model"><input className="input" value={makeModel} onChange={(e) => setMake(e.target.value)} placeholder="e.g. BFW Agni" /></Field>
        <Field label="Controller"><input className="input" value={controller} onChange={(e) => setController(e.target.value)} placeholder="e.g. Fanuc 0i" /></Field>
        <Field label="Axes"><input className="input" value={axes} onChange={(e) => setAxes(e.target.value)} placeholder="e.g. 3-axis" /></Field>
        <Field label="Notes" full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className={`check ${active ? 'on' : ''}`}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> In use (untick to retire the machine without deleting its history)</label>
      </div>
    </Modal>
  );
}

function StartModal({ machines, preset, onClose, onStart }: { machines: Machine[]; preset: Machine | null; onClose: () => void; onStart: (i: { machineId: number; jobNo: string; part: string; programNo: string; operator: string; qtyPlanned: number; remarks: string }) => Promise<boolean> }) {
  const { state } = useStore();
  const [machineId, setMachineId] = useState(preset?.id ?? machines[0]?.id ?? 0);
  const [jobNo, setJobNo] = useState('');
  const [part, setPart] = useState('');
  const [programNo, setProgramNo] = useState('');
  const [operator, setOperator] = useState('');
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const jobs = state.jobs.filter((j) => j.currentStage !== 'dispatched' && j.currentStage !== 'scrapped');
  const pickJob = (no: string) => {
    setJobNo(no);
    const j = jobs.find((x) => x.jobNo === no);
    if (j) {
      setPart(getProduct(state, j.productId).name);
      setQty(String(j.plannedQty));
    }
  };
  const list = preset ? [preset] : machines;
  const valid = machineId > 0 && part.trim() !== '' && (qty === '' || (Number(qty) >= 0 && Number.isInteger(Number(qty))));
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    if (await onStart({ machineId, jobNo, part: part.trim(), programNo, operator, qtyPlanned: Number(qty) || 0, remarks })) onClose();
    setBusy(false);
  };
  return (
    <Modal open dialog icon={Play} onClose={onClose} title="Start a job" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>Start</button></>}>
      <div className="form-grid">
        <Field label="Machine" required>
          <select value={machineId} onChange={(e) => setMachineId(Number(e.target.value))} disabled={!!preset}>
            {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Job card" hint="Optional — fills in the part and quantity">
          <select value={jobNo} onChange={(e) => pickJob(e.target.value)}>
            <option value="">— not for a job card —</option>
            {jobs.map((j) => <option key={j.jobNo} value={j.jobNo}>{j.jobNo} · {getProduct(state, j.productId).name}</option>)}
          </select>
        </Field>
        <Field label="Part" required><input className="input" value={part} onChange={(e) => setPart(e.target.value)} placeholder="What is being machined" /></Field>
        <Field label="Program no."><input className="input mono" value={programNo} onChange={(e) => setProgramNo(e.target.value)} /></Field>
        <Field label="Operator"><input className="input" value={operator} onChange={(e) => setOperator(e.target.value)} /></Field>
        <Field label="Quantity planned"><NumInput value={qty} onChange={setQty} suffix="PCS" /></Field>
        <Field label="Remarks" full><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function FinishModal({ run, onClose, onFinish }: { run: Run; onClose: () => void; onFinish: (qty: number, status: 'Done' | 'Stopped', remarks: string) => Promise<boolean> }) {
  const [qty, setQty] = useState(run.qtyPlanned ? String(run.qtyPlanned) : '');
  const [status, setStatus] = useState<'Done' | 'Stopped'>('Done');
  const [remarks, setRemarks] = useState(run.remarks);
  const [busy, setBusy] = useState(false);
  const n = Number(qty);
  const valid = qty !== '' && Number.isInteger(n) && n >= 0;
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    if (await onFinish(n, status, remarks)) onClose();
    setBusy(false);
  };
  return (
    <Modal open dialog icon={Square} onClose={onClose} title={`Finish — ${run.part}`} subtitle={`${run.machineName} · running ${runTime(run)}`} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{status === 'Done' ? 'Finish the job' : 'Stop the job'}</button></>}>
      <div className="form-grid">
        <Field label="Pieces made" required error={qty !== '' && !valid ? 'Enter a whole number' : null}><NumInput value={qty} onChange={setQty} suffix="PCS" autoFocus /></Field>
        <Field label="How did it end?">
          <select value={status} onChange={(e) => setStatus(e.target.value as 'Done' | 'Stopped')}>
            <option value="Done">Done</option>
            <option value="Stopped">Stopped before completion</option>
          </select>
        </Field>
        <Field label="Remarks" full><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. tool changed twice" /></Field>
      </div>
    </Modal>
  );
}
