import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Pencil, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { Conf, Write, canSee, currentUserName, searchable } from '../auth/access';
import { Confirm, Empty, Field, FilterMenu, JobLink, Modal, NumInput, PageHeader, Search } from '../components/ui';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { dueLabel, daysLeft, deleteJobWorkOut, saveJobWorkOut, setJobWorkOutStatus, useJobWorkOut, type JobWorkOut, type OutInput, type OutStatus } from '../jobworkout/service';
import { getProduct } from '../store/engine';
import { useStore } from '../store/StoreContext';
import { DocButtons } from '../export/docOutput';
import * as docs from '../export/documents';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';

const PROCESSES = ['Cutting', 'Forging', 'Trimming', 'Heat Treatment', 'CNC', 'VMC', 'Machining', 'Plating', 'Grinding', 'Other'];
const UOMS = ['PCS', 'KG', 'SET'];
const statusChip = { Sent: 'chip chip-run', Received: 'chip chip-up', Cancelled: 'chip chip-subtle' } as const;

/** how close the due date is, as a chip: red when late, amber inside the reminder window */
function DueChip({ j }: { j: JobWorkOut }) {
  const n = j.status === 'Sent' ? daysLeft(j) : null;
  if (n === null) return <span className="muted">{j.dueDate ? fmtDate(j.dueDate) : '—'}</span>;
  return (
    <>
      <div className="nowrap">{fmtDate(j.dueDate)}</div>
      <span className={n < 0 ? 'chip chip-hot' : n <= j.remindDays ? 'chip chip-wait' : 'chip'}>{dueLabel(n)}</span>
    </>
  );
}

/**
 * Workflow → Job Work Out: work we gave to somebody else. We only note it down — who has it, what, how many, the challan and the due date —
 * and the app reminds us as the due date gets close. Nothing here uses our inventory.
 */
export function JobWorkOutPage() {
  const { toast } = useStore();
  const jw = useJobWorkOut();
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState<'all' | OutStatus | 'late'>('all');
  const [editing, setEditing] = useState<JobWorkOut | 'new' | null>(null);
  const [receiving, setReceiving] = useState<JobWorkOut | null>(null);
  const [deleting, setDeleting] = useState<JobWorkOut | null>(null);

  const sent = jw.items.filter((j) => j.status === 'Sent');
  const late = sent.filter((j) => (daysLeft(j) ?? 1) < 0);
  const soon = sent.filter((j) => { const n = daysLeft(j); return n !== null && n >= 0 && n <= j.remindDays; });

  const rows = useMemo(
    () =>
      jw.items
        .filter((j) => (statusF === 'all' ? true : statusF === 'late' ? j.status === 'Sent' && (daysLeft(j) ?? 1) < 0 : j.status === statusF))
        .filter((j) => matches(q, j.outNo, j.item, j.process, j.challanNo, j.jobNo, searchable(j.vendor)))
        // open work first, the nearest due date at the top
        .sort((a, b) => (a.status === 'Sent' ? 0 : 1) - (b.status === 'Sent' ? 0 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.id - a.id),
    [jw.items, statusF, q],
  );

  const fail = (title: string) => (e: unknown) => toast({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) });

  if (editing) return <OutForm entry={editing === 'new' ? null : editing} items={jw.items} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await jw.reload(); }} />;

  const add = (
    <Write res="job_work_out">
      <button className="btn btn-primary" onClick={() => setEditing('new')}>
        <Plus size={15} /> Add Job Work Out
      </button>
    </Write>
  );

  return (
    <>
      <PageHeader eyebrow="Workflow" title="Job Work Out" actions={jw.items.length > 0 ? <><ListButtons doc={() => ({ filename: 'Job-Work-Out', title: 'Job Work Out', form: FORM_FORMATS.jobWorkOut, rows: rows.map((j) => ({ no: j.outNo, date: j.outDate, vendor: j.vendor, item: j.item, process: j.process, qty: j.qty, uom: j.uom, challan: j.challanNo, due: j.dueDate, status: j.status === 'Sent' ? 'With others' : j.status === 'Received' ? 'Received back' : j.status, back: j.receivedOn })), cols: [{ label: 'Entry', key: 'no' }, { label: 'Date', key: 'date', kind: 'date' }, { label: 'Given To', key: 'vendor', width: 24 }, { label: 'Item', key: 'item', width: 24 }, { label: 'Work', key: 'process' }, { label: 'Qty', key: 'qty', kind: 'num' }, { label: 'UOM', key: 'uom' }, { label: 'Challan', key: 'challan' }, { label: 'Due', key: 'due', kind: 'date' }, { label: 'Status', key: 'status' }, { label: 'Received On', key: 'back', kind: 'date' }] })} />{add}</> : undefined} />
      {jw.error && <div className="callout warn" style={{ marginBottom: 16 }}>{jw.error}</div>}
      <div className="fstats">
        <div className="fstat fstat-run">
          <span>With others</span>
          <b>{sent.length}</b>
        </div>
        <div className={`fstat ${soon.length ? 'fstat-hold' : ''}`}>
          <span>Due soon</span>
          <b>{soon.length}</b>
        </div>
        <div className="fstat">
          <span>Overdue</span>
          <b style={{ color: late.length ? 'var(--crit)' : undefined }}>{late.length}</b>
        </div>
        <div className="fstat fstat-free">
          <span>Received back</span>
          <b>{jw.items.filter((j) => j.status === 'Received').length}</b>
        </div>
      </div>

      <div className="card">
        {!jw.loaded ? (
          <div className="card-center-msg">Loading…</div>
        ) : jw.items.length === 0 ? (
          <Empty icon={Send} title="No job work given out yet" text="Note down the work you give to somebody else — who has it, what, how many and when it is due. You get a reminder as the due date gets close." action={add} />
        ) : (
          <>
            <div className="toolbar">
              <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search entry, vendor, item, challan…' : 'Search entry, item, challan…'} />
              <FilterMenu
                groups={[
                  {
                    label: 'Status',
                    value: statusF,
                    onChange: (v) => setStatusF(v as typeof statusF),
                    options: [
                      { value: 'all', label: 'All', count: jw.items.length },
                      { value: 'Sent', label: 'With others', count: sent.length },
                      { value: 'late', label: 'Overdue', count: late.length },
                      { value: 'Received', label: 'Received back', count: jw.items.filter((j) => j.status === 'Received').length },
                      { value: 'Cancelled', label: 'Cancelled', count: jw.items.filter((j) => j.status === 'Cancelled').length },
                    ],
                  },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <Empty icon={Send} title="No matches" text="Try a different search or filter." />
            ) : (
              <div className="table-wrap">
                <table className="tbl compact">
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <Conf g="party_names">
                        <th>Given to</th>
                      </Conf>
                      <th>Item / Work</th>
                      <th className="r">Qty</th>
                      <th>Challan</th>
                      <th>Due</th>
                      <th>Status</th>
                      <th className="act">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((j) => (
                      <tr key={j.id}>
                        <td className="nowrap">
                          <div className="mono strong">{j.outNo}</div>
                          <div className="sub">{fmtDate(j.outDate)}</div>
                        </td>
                        <Conf g="party_names">
                          <td>
                            <div className="strong">{j.vendor || '—'}</div>
                            <div className="sub">{[j.contact, j.phone].filter(Boolean).join(' · ')}</div>
                          </td>
                        </Conf>
                        <td>
                          <div className="strong">{j.item}</div>
                          <div className="sub">
                            {j.process}
                            {j.jobNo ? <> {j.process ? '· ' : ''}<JobLink jobNo={j.jobNo} /></> : null}
                          </div>
                        </td>
                        <td className="r num nowrap">
                          {fmtNum(j.qty)} {j.uom}
                          {j.status === 'Received' && j.receivedQty != null && j.receivedQty !== j.qty && <div className="sub">{fmtNum(j.receivedQty)} back</div>}
                        </td>
                        <td>{j.challanNo || '—'}</td>
                        <td>
                          <DueChip j={j} />
                        </td>
                        <td className="nowrap">
                          <span className={statusChip[j.status]}>{j.status === 'Sent' ? 'With others' : j.status === 'Received' ? 'Received back' : 'Cancelled'}</span>
                          {j.status === 'Received' && j.receivedOn && <div className="sub">{fmtDate(j.receivedOn)}</div>}
                        </td>
                        <td className="r nowrap">
                          <Write res="job_work_out">
                            <div className="icon-actions">
                              <DocButtons compact build={(u) => docs.jobWorkOutSpec(j, u)} />
                              {j.status === 'Sent' ? (
                                <button className="btn btn-subtle btn-sm" onClick={() => setReceiving(j)}>
                                  <CheckCircle2 size={14} /> Received
                                </button>
                              ) : (
                                <button className="icon-btn" title="Mark as with others again" aria-label={`Reopen ${j.outNo}`} onClick={() => void setJobWorkOutStatus(j.id, 'Sent').then(jw.reload).catch(fail('Could not update the entry'))}>
                                  <Undo2 size={16} />
                                </button>
                              )}
                              <button className="icon-btn" title="Edit" aria-label={`Edit ${j.outNo}`} onClick={() => setEditing(j)}>
                                <Pencil size={16} />
                              </button>
                              <button className="icon-btn danger" title="Delete" aria-label={`Delete ${j.outNo}`} onClick={() => setDeleting(j)}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </Write>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {receiving && <ReceiveModal entry={receiving} onClose={() => setReceiving(null)} onDone={async () => { setReceiving(null); await jw.reload(); }} />}
      <Confirm
        open={!!deleting}
        title="Delete job work out"
        message={deleting ? `Delete ${deleting.outNo} · ${deleting.item}?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          const d = deleting;
          if (!d) return;
          setDeleting(null);
          void deleteJobWorkOut(d.id)
            .then(async () => {
              toast({ kind: 'success', title: 'Entry deleted', message: d.outNo });
              await jw.reload();
            })
            .catch(fail('Could not delete'));
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** the work came back: the date and the quantity that came back */
function ReceiveModal({ entry, onClose, onDone }: { entry: JobWorkOut; onClose: () => void; onDone: () => void | Promise<void> }) {
  const { toast } = useStore();
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState(String(entry.qty));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await setJobWorkOutStatus(entry.id, 'Received', date, Number(qty) > 0 ? Number(qty) : undefined);
      toast({ kind: 'success', title: 'Marked as received back', message: entry.outNo });
      await onDone();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not update the entry', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      title={`Received back — ${entry.outNo}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !date} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Received on" required>
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Quantity received" hint={`${fmtNum(entry.qty)} ${entry.uom} were given`}>
          <NumInput value={qty} onChange={setQty} suffix={entry.uom} step="any" />
        </Field>
      </div>
    </Modal>
  );
}

/** suggested number: JWO-<year>-0001, 0002 … (the database still refuses a number that is already used) */
function suggestNo(list: JobWorkOut[]) {
  const y = new Date().getFullYear();
  const re = new RegExp(`^JWO-${y}-(\\d+)$`);
  const max = list.reduce((m, r) => Math.max(m, Number(re.exec(r.outNo)?.[1] ?? 0)), 0);
  return `JWO-${y}-${String(max + 1).padStart(4, '0')}`;
}

function OutForm({ entry, items, onClose, onSaved }: { entry: JobWorkOut | null; items: JobWorkOut[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { state, masters, toast } = useStore();
  const [f, setF] = useState({
    outNo: entry?.outNo ?? suggestNo(items),
    outDate: entry?.outDate ?? todayISO(),
    vendor: canSee('party_names') ? entry?.vendor ?? '' : entry ? '—' : '',
    contact: entry?.contact ?? '',
    phone: entry?.phone ?? '',
    jobNo: entry?.jobNo ?? '',
    item: entry?.item ?? '',
    process: entry?.process ?? '',
    qty: entry ? String(entry.qty) : '',
    uom: entry?.uom ?? 'PCS',
    challanNo: entry?.challanNo ?? '',
    dueDate: entry?.dueDate ?? '',
    remindDays: String(entry?.remindDays ?? 2),
    charges: entry?.charges != null ? String(entry.charges) : '',
    remarks: entry?.remarks ?? '',
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const valid = f.vendor.trim() !== '' && f.item.trim() !== '' && Number(f.qty) > 0 && (!f.dueDate || f.dueDate >= f.outDate);

  // picking one of our job cards fills the item
  const pickJob = (no: string) => {
    const job = state.jobs.find((j) => j.jobNo === no);
    setF((x) => ({ ...x, jobNo: no, item: job && !x.item ? getProduct(state, job.productId).name : x.item }));
  };

  const save = async () => {
    setBusy(true);
    try {
      const input: OutInput = { ...f, qty: Number(f.qty), remindDays: Math.max(0, Math.floor(Number(f.remindDays)) || 0), charges: f.charges.trim() === '' ? undefined : Number(f.charges) };
      await saveJobWorkOut(entry?.id ?? null, input, currentUserName());
      toast({ kind: 'success', title: entry ? 'Entry updated' : 'Entry saved', message: f.outNo || f.item });
      await onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the entry', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Job Work Out"
        title={entry ? `Edit ${entry.outNo}` : 'Add Job Work Out'}
        actions={
          <>
            <button className="btn btn-subtle" onClick={onClose} disabled={busy}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
              Save
            </button>
          </>
        }
      />
      <div className="card" style={{ padding: 20 }}>
        <div className="form-grid three">
          <Field label="Entry No." hint="Numbered automatically — you can change it. A number already in use is not accepted.">
            <input className="input mono" value={f.outNo} onChange={(e) => set('outNo', e.target.value)} />
          </Field>
          <Field label="Date given" required>
            <input className="input" type="date" value={f.outDate} onChange={(e) => set('outDate', e.target.value)} />
          </Field>
          <Field label="Our job card (optional)">
            <select value={f.jobNo} onChange={(e) => pickJob(e.target.value)}>
              <option value="">— Not linked to a job card —</option>
              {state.jobs.map((j) => (
                <option key={j.jobNo} value={j.jobNo}>
                  {j.jobNo} · {getProduct(state, j.productId).name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Given to" required hint="The party doing the work">
            <input className="input" list="jwo-vendors" value={f.vendor} onChange={(e) => set('vendor', e.target.value)} disabled={!canSee('party_names') && !!entry} />
            <datalist id="jwo-vendors">
              {masters.suppliers.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Contact person">
            <input className="input" value={f.contact} onChange={(e) => set('contact', e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Item" required>
            <input className="input" value={f.item} onChange={(e) => set('item', e.target.value)} placeholder="e.g. Brass Bush" />
          </Field>
          <Field label="Work to be done">
            <input className="input" list="jwo-process" value={f.process} onChange={(e) => set('process', e.target.value)} placeholder="e.g. CNC machining" />
            <datalist id="jwo-process">
              {PROCESSES.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </Field>
          <Field label="Quantity" required>
            <div style={{ display: 'flex', gap: 8 }}>
              <NumInput value={f.qty} onChange={(v) => set('qty', v)} step="any" />
              <select value={f.uom} onChange={(e) => set('uom', e.target.value)} style={{ width: 90 }} aria-label="Unit">
                {UOMS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Challan No." hint="Our delivery challan for the work sent out">
            <input className="input" value={f.challanNo} onChange={(e) => set('challanNo', e.target.value)} />
          </Field>
          <Field label="Due date" hint="Leave empty if there is none" error={f.dueDate && f.dueDate < f.outDate ? 'Cannot be before the date given' : null}>
            <input className="input" type="date" value={f.dueDate} min={f.outDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
          <Field label="Remind me" hint="Days before the due date (and again once it is late)">
            <NumInput value={f.remindDays} onChange={(v) => set('remindDays', v)} suffix="days before" readOnly={!f.dueDate} />
          </Field>
          {canSee('purchase_rates') && (
            <Field label="Charges (optional)" hint="Agreed charge for the work">
              <NumInput value={f.charges} onChange={(v) => set('charges', v)} suffix="₹" step="any" />
            </Field>
          )}
          <Field label="Remarks" full>
            <textarea value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
        </div>
      </div>
    </>
  );
}
