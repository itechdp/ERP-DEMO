import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, Eye, FileSpreadsheet, FileText, ListChecks, Pause, Pencil, Play, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Badge, Empty, Field, go, Modal, Search } from '../components/ui';
import { fmtDate, fmtDateTime } from '../components/format';
import { useStore } from '../store/StoreContext';
import { UrgencyBadge } from './UrgencyBadge';
import { TASK_REPORT_FIELDS, downloadTaskReport, taskReportSpec } from './taskReport';
import { printSpec } from '../export/docOutput';
import { TASK_STATUSES, URGENCIES, fetchTasks, fmtDuration, setTaskStatus, taskOverdueDays, taskTimeTaken, type Task } from './service';

const RANK: Record<string, number> = { Urgent: 4, High: 3, Medium: 2, Low: 1 };
const isActive = (t: Task) => t.status === 'Open' || t.status === 'In Progress' || t.status === 'On Hold';
const dayStart = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').getTime();

/**
 * The tasks inside the Work Hub.
 *  · mode "overview" (the Work Hub tab, for the administrators): everybody's tasks, the figures, the report and New Task
 *  · mode "mine" (the My Tasks tab, for everybody): only the tasks given to me — Start, put On Hold, Resume, Complete
 */
export function TaskPanel({ mode = 'overview' }: { mode?: 'overview' | 'mine' }) {
  const { user, canWrite } = useAccess();
  const { toast } = useStore();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const scope = mode === 'mine' ? 'mine' : 'all';
  const [statusF, setStatusF] = useState('active');
  const [urgencyF, setUrgencyF] = useState('all');
  const [q, setQ] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const canAdd = canWrite('task_assignment');

  const reload = useCallback(async () => {
    try {
      setTasks(await fetchTasks());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const move = async (t: Task, to: string, label: string) => {
    setBusy(t.id);
    try {
      await setTaskStatus(t.id, to);
      toast({ kind: 'success', title: label, message: `${t.docNo} · ${t.title}` });
      await reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not update the task', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const mineCount = tasks.filter((t) => t.mine && isActive(t)).length;
  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return tasks
      .filter((t) => (scope === 'all' ? true : t.mine))
      .filter((t) => (statusF === 'all' ? true : statusF === 'active' ? isActive(t) : t.status === statusF))
      .filter((t) => urgencyF === 'all' || t.urgency === urgencyF)
      .filter((t) => !ql || [t.docNo, t.title, t.assignee, t.assignedBy, t.refNo].some((v) => v.toLowerCase().includes(ql)))
      .sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || (RANK[b.urgency] ?? 0) - (RANK[a.urgency] ?? 0) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  }, [tasks, scope, statusF, urgencyF, q]);

  const overdue = tasks.filter((t) => isActive(t) && taskOverdueDays(t) > 0).length;
  const mine = tasks.filter((t) => t.mine);
  const tile = (label: string, value: number, tone?: string) => (
    <div className="card" style={{ padding: '12px 16px', minWidth: 130 }}>
      <div className="text-xs muted">{label}</div>
      <div className={`strong mono ${tone ?? ''}`} style={{ fontSize: 22 }}>{value}</div>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {mode === 'mine' ? (
          <>
            {tile('To do', mine.filter((t) => t.status === 'Open').length)}
            {tile('In progress', mine.filter((t) => t.status === 'In Progress').length)}
            {tile('On hold', mine.filter((t) => t.status === 'On Hold').length)}
            {tile('Overdue', mine.filter((t) => isActive(t) && taskOverdueDays(t) > 0).length, mine.some((t) => isActive(t) && taskOverdueDays(t) > 0) ? 'text-red' : '')}
            {tile('Completed', mine.filter((t) => t.status === 'Done').length)}
          </>
        ) : (
          <>
            {tile('My open tasks', mineCount)}
            {tile('All open tasks', tasks.filter(isActive).length)}
            {tile('On hold', tasks.filter((t) => t.status === 'On Hold').length)}
            {tile('Overdue', overdue, overdue ? 'text-red' : '')}
            {tile('Completed', tasks.filter((t) => t.status === 'Done').length)}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Search value={q} onChange={setQ} placeholder="Search task, person, number…" />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Status" className="input" style={{ width: 'auto', minWidth: 170 }}>
            <option value="active">Open &amp; in progress</option>
            <option value="all">All statuses</option>
            {TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={urgencyF} onChange={(e) => setUrgencyF(e.target.value)} aria-label="Urgency" className="input" style={{ width: 'auto', minWidth: 140 }}>
            <option value="all">Any urgency</option>
            {URGENCIES.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          {mode === 'overview' && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn btn-subtle" onClick={() => setReportOpen(true)} disabled={!tasks.length}>
                <FileSpreadsheet size={15} /> Report
              </button>
              {canAdd && (
                <button className="btn btn-primary" onClick={() => go('task-assignment?new=1')}>
                  <Plus size={15} /> New Task
                </button>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="card-center-msg">Loading tasks…</div>
        ) : error ? (
          <Empty icon={ListChecks} title="Could not load the tasks" text={error} />
        ) : shown.length === 0 ? (
          <Empty icon={ListChecks} title={scope === 'mine' ? 'No tasks for you' : 'No tasks'} text="Nothing matches the filters." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task No.</th>
                  <th>Task</th>
                  <th>Assigned to</th>
                  <th>Urgency</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>Time taken</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const late = isActive(t) ? taskOverdueDays(t) : 0;
                  const can = t.mine || canAdd;
                  return (
                    <tr key={t.id}>
                      <td className="mono strong nowrap">{t.docNo}</td>
                      <td>
                        <div className="strong">{t.title || '—'}</div>
                        <div className="text-xs muted">
                          {t.assignedBy ? `by ${t.assignedBy} · ` : ''}
                          {fmtDateTime(t.assignedAt ?? t.createdAt)}
                          {t.refNo ? ` · ${t.refNo}` : ''}
                        </div>
                      </td>
                      <td>{t.assignee || '—'}</td>
                      <td><UrgencyBadge urgency={t.urgency} /></td>
                      <td className="nowrap">
                        {t.dueDate ? fmtDate(t.dueDate) : '—'}
                        {late > 0 && <div className="text-xs text-red">{late} day{late === 1 ? '' : 's'} late</div>}
                      </td>
                      <td><Badge status={t.status} /></td>
                      <td className="nowrap">
                        {fmtDuration(taskTimeTaken(t))}
                        {t.status === 'In Progress' && <div className="text-xs muted">running</div>}
                        {t.status === 'On Hold' && <div className="text-xs muted">paused</div>}
                      </td>
                      <td className="r nowrap">
                        <div className="icon-actions">
                          {can && t.status === 'Open' && (
                            <button className="btn btn-sm btn-subtle" disabled={busy === t.id} onClick={() => void move(t, 'In Progress', 'Task started')}><Play size={13} /> Start</button>
                          )}
                          {can && t.status === 'In Progress' && (
                            <button className="btn btn-sm btn-subtle" disabled={busy === t.id} onClick={() => void move(t, 'On Hold', 'Task put on hold')}><Pause size={13} /> Hold</button>
                          )}
                          {can && t.status === 'On Hold' && (
                            <button className="btn btn-sm btn-subtle" disabled={busy === t.id} onClick={() => void move(t, 'In Progress', 'Task resumed')}><Play size={13} /> Resume</button>
                          )}
                          {can && isActive(t) && (
                            <button className="btn btn-sm btn-primary" disabled={busy === t.id} onClick={() => void move(t, 'Done', 'Task completed')}><CheckCircle2 size={13} /> Complete</button>
                          )}
                          {can && (t.status === 'Done' || t.status === 'Cancelled') && (
                            <button className="btn btn-sm btn-subtle" disabled={busy === t.id} onClick={() => void move(t, 'Open', 'Task reopened')}><RotateCcw size={13} /> Reopen</button>
                          )}
                          {canAdd && isActive(t) && (
                            <button className="icon-btn danger" title="Cancel the task" aria-label={`Cancel ${t.docNo}`} disabled={busy === t.id} onClick={() => void move(t, 'Cancelled', 'Task cancelled')}><XCircle size={17} /></button>
                          )}
                          <button className="icon-btn" title="View" aria-label={`View ${t.docNo}`} onClick={() => go(`task-assignment?edit=${t.id}&view=1`)}><Eye size={17} /></button>
                          {canAdd && (
                            <button className="icon-btn" title="Edit" aria-label={`Edit ${t.docNo}`} onClick={() => go(`task-assignment?edit=${t.id}`)}><Pencil size={17} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reportOpen && <ReportModal tasks={tasks} user={user?.name || user?.email || ''} onClose={() => setReportOpen(false)} />}
    </>
  );
}

function ReportModal({ tasks, user, onClose }: { tasks: Task[]; user: string; onClose: () => void }) {
  const { toast } = useStore();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const [person, setPerson] = useState('all');
  const [urgency, setUrgency] = useState('all');
  const [keys, setKeys] = useState<string[]>(() => TASK_REPORT_FIELDS.filter((f) => f.on).map((f) => f.key));
  const [busy, setBusy] = useState(false);
  const people = [...new Set(tasks.map((t) => t.assignee).filter(Boolean))].sort();

  const rows = tasks
    .filter((t) => status === 'all' || t.status === status)
    .filter((t) => person === 'all' || t.assignee === person)
    .filter((t) => urgency === 'all' || t.urgency === urgency)
    .filter((t) => {
      const d = dayStart(t.assignedAt ?? t.createdAt);
      return (!from || d >= dayStart(from)) && (!to || d <= dayStart(to));
    });

  const download = async (as: 'excel' | 'pdf' = 'excel') => {
    setBusy(true);
    try {
      const period = from || to ? `${from ? fmtDate(from) : 'start'} to ${to ? fmtDate(to) : 'today'}` : 'All dates';
      const filters = [status !== 'all' && status, person !== 'all' && person, urgency !== 'all' && urgency].filter(Boolean).join(', ') || 'None';
      if (as === 'pdf') printSpec(taskReportSpec(rows, keys, user, period, filters));
      else await downloadTaskReport(rows, keys, user, period, filters);
      onClose();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the report', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={FileSpreadsheet}
      title="Task Report"
      subtitle="Pick the tasks and the columns, then download the Excel sheet or the PDF."
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !rows.length || !keys.length} onClick={() => void download('pdf')}>
            <FileText size={15} /> PDF ({rows.length})
          </button>
          <button className="btn btn-primary" disabled={busy || !rows.length || !keys.length} onClick={() => void download()}>
            <Download size={15} /> {busy ? 'Preparing…' : `Download Excel (${rows.length})`}
          </button>
        </>
      }
    >
      <div className="form-grid three">
        <Field label="Assigned from"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Assigned up to"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            {TASK_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Person">
          <select value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="all">Everyone</option>
            {people.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Urgency">
          <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
            <option value="all">Any</option>
            {URGENCIES.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
      </div>
      <div className="section-label">Columns in the report</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 16px' }}>
        {TASK_REPORT_FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5 }}>
            <input type="checkbox" checked={keys.includes(f.key)} onChange={(e) => setKeys((k) => (e.target.checked ? [...k, f.key] : k.filter((x) => x !== f.key)))} />
            {f.label}
          </label>
        ))}
      </div>
    </Modal>
  );
}
