import * as api from '../db/api';
import { searchable, Write, Conf, searchableCol } from '../auth/access';
import { useMemo, useState } from 'react';
import { ClipboardCheck, Eye, PackageCheck, ShieldCheck } from 'lucide-react';
import { HardnessRegister } from './HardnessPage';
import { DimensionTab } from '../dimension/DimensionTab';
import { useStore } from '../store/StoreContext';
import { getJob, getProduct } from '../store/engine';
import { Badge, Empty, Field, InlineQty, JobLink, Modal, NumInput, PageHeader, QtyFlow, rowTone, Search, SummaryLine, Tabs, FilterMenu } from '../components/ui';
import { tsFor } from '../components/NewJobModal';
import { fmtNum, matches, todayISO } from '../components/format';
import { useProductFlows } from '../products/flow';
import { useTabAccess } from '../auth/tabs';
import { DocButtons } from '../export/docOutput';
import * as docs from '../export/documents';

type Filter = 'QC Pending' | 'inspected' | 'Rejections' | 'all';

export function QCPage() {
  const { state, openTrace, openAction } = useStore();
  const [view0, setView] = useState<'register' | 'hardness' | 'dimension'>('register');
  const ta = useTabAccess('qc', ['register', 'hardness', 'dimension'] as const);
  const view = ta.pick(view0);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [productF, setProductF] = useState('all');

  const recs = state.qc;
  const pending = recs.filter((r) => r.status === 'QC Pending');
  const inspected = recs.filter((r) => r.status !== 'QC Pending');
  const withRej = inspected.filter((r) => r.rejected > 0);
  const accepted = inspected.reduce((t, r) => t + r.accepted, 0);
  const rejected = inspected.reduce((t, r) => t + r.rejected, 0);
  const total = accepted + rejected;

  const rows = useMemo(
    () =>
      recs
        .filter((r) =>
          filter === 'all' ? true : filter === 'QC Pending' ? r.status === 'QC Pending' : filter === 'inspected' ? r.status !== 'QC Pending' : r.rejected > 0,
        )
        .filter((r) => productF === 'all' || getJob(state, r.jobNo).productId === productF)
        .filter((r) => {
          const job = getJob(state, r.jobNo);
          return matches(q, r.jobNo, getProduct(state, job.productId).name, searchable(job.customer), searchableCol(r.inspector, 'qc.inspector'), r.status);
        })
        .sort((a, b) => (a.status === 'QC Pending' ? -1 : 1) - (b.status === 'QC Pending' ? -1 : 1) || (b.inspectedAt ?? b.receivedAt).localeCompare(a.inspectedAt ?? a.receivedAt)),
    [recs, filter, q, productF, state],
  );

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 6 of 8"
        title="Quality Control"
        flow="qc"
        actions={
          <Write res="qc"><button className="btn btn-primary" onClick={() => openAction({ kind: 'hardness' })}>
            <ClipboardCheck size={16} /> New Hardness Report
          </button></Write>
        }
      />
      <div className="card">
        <div className="card-head">
          <Tabs
            value={view}
            onChange={setView}
            items={ta.only([
              { value: 'register', label: 'Inspection Register', count: recs.length, tone: 'blue' },
              { value: 'hardness', label: 'Hardness Reports', count: state.hardnessReports.length, tone: 'violet' },
              { value: 'dimension', label: 'Dimension Reports', tone: 'teal' },
            ])}
          />
          {view === 'register' && total > 0 && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: 'PCS accepted → FG', value: fmtNum(accepted), tone: 'good' },
                  { label: 'PCS rejected', value: fmtNum(rejected), tone: 'bad' },
                  { label: 'first-pass yield', value: `${((accepted / total) * 100).toFixed(1)}%`, tone: 'info' },
                ]}
              />
            </div>
          )}
        </div>
        {view === 'hardness' && <HardnessRegister />}
        {view === 'dimension' && <DimensionTab />}
        {view === 'register' && (<>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Search job, product, inspector…" />
          <FilterMenu
            groups={[
              {
                label: 'Status',
                value: filter,
                onChange: (v) => setFilter(v as Filter),
                options: [
                  { value: 'all', label: 'All', count: recs.length },
                  { value: 'QC Pending', label: 'Pending', count: pending.length },
                  { value: 'inspected', label: 'Inspected', count: inspected.length },
                  { value: 'Rejections', label: 'With Rejections', count: withRej.length },
                ],
              },
              { label: 'Product', value: productF, onChange: setProductF, options: [{ value: 'all', label: 'All products' }, ...state.products.map((p) => ({ value: p.id, label: p.name }))] },
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon={ShieldCheck} title="Nothing to inspect" text="Jobs appear here automatically once Heat Treatment is completed." />
        ) : (
          <div className="table-wrap">
            <table className="tbl compact">
              <thead>
                <tr>
                  <th>Job Card No.</th>
                  <th>Item</th>
                  <th>Received → Rejection → OK</th>
                  <Conf col="qc.inspector">
                    <th>Checked By</th>
                  </Conf>
                  <th>QC Status</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const job = getJob(state, r.jobNo);
                  const p = getProduct(state, job.productId);
                  const done = r.status !== 'QC Pending';
                  const act = () => !done && openAction({ kind: 'qc', jobNo: r.jobNo });
                  return (
                    <tr
                      key={r.id}
                      className={`${rowTone(r.status)} ${done ? '' : 'row-click'}`}
                      onClick={act}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          act();
                        }
                      }}
                      tabIndex={done ? undefined : 0}
                      title={done ? undefined : `Enter QC result for ${r.jobNo}`}
                    >
                      <td>
                        <JobLink jobNo={r.jobNo} />
                      </td>
                      <td className="strong nowrap">{p.name}</td>
                      <td>
                        {done ? (
                          <InlineQty input={r.input} loss={r.rejected} output={r.accepted} />
                        ) : (
                          <span className="inline-q">
                            {fmtNum(r.input)} <span className="muted" style={{ fontWeight: 500 }}>PCS received</span>
                          </span>
                        )}
                      </td>
                      <Conf col="qc.inspector">
                        <td>{done && r.inspector ? r.inspector : <span className="muted">—</span>}</td>
                      </Conf>
                      <td>
                        <Badge status={r.status} />
                      </td>
                      <td className="r nowrap">
                        {r.status !== 'QC Pending' && <DocButtons compact build={(u) => docs.qcRecordSpec(state, r, u)} />}
                        <button
                          className="icon-btn"
                          style={{ display: 'inline-grid', verticalAlign: 'middle' }}
                          title="View traceability"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTrace(r.jobNo);
                          }}
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>)}
      </div>
    </>
  );
}

/** QC row of the route card: Inward Date, Received Qty, Rejection Qty, OK Qty, Checked By. */
export function InspectModal({ jobNo, onClose }: { jobNo: string; onClose: () => void }) {
  const { state, run, masters, busy } = useStore();
  const pf = useProductFlows();
  const rec = state.qc.find((r) => r.jobNo === jobNo && r.status === 'QC Pending');
  const job = getJob(state, jobNo);
  const p = getProduct(state, job.productId);
  const [rejected, setRejected] = useState('0');
  const [checkedBy, setCheckedBy] = useState('');
  const [date, setDate] = useState(todayISO());
  if (!rec) return null;

  const r = Number(rejected);
  const a = rec.input - r;
  const bad = rejected === '' || !Number.isInteger(r) || r < 0 || r > rec.input;

  const submit = async () => {
    const ok = await run(
      (now) => api.completeQC(jobNo, { accepted: a, rejected: r, inspector: checkedBy, checks: { dimensional: true, visual: true, hardness: true } }, tsFor(date, now)),
      {
        title: 'QC saved',
        message: a > 0 ? `${jobNo}: ${a} OK PCS moved to Finished Goods${r ? `, ${r} PCS rejected` : ''}.` : `${jobNo}: all ${r} PCS rejected.`,
      },
    );
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={ShieldCheck}
      title={`QC Inspection — ${jobNo}`}
      subtitle={p.name}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={bad || busy} onClick={submit}>
            <PackageCheck size={15} /> Save &amp; send {!bad && a > 0 ? `${fmtNum(a)} PCS ` : ''}to Finished Goods
          </button>
        </>
      }
    >
      {pf.of(job.productId).hardnessRequired && (
        <div className={`callout ${state.hardnessReports.some((h) => h.jobNo === jobNo) ? 'info' : 'warn'}`} style={{ marginBottom: 16 }}>
          <ShieldCheck size={16} />
          <div>
            {state.hardnessReports.some((h) => h.jobNo === jobNo) ? (
              <>
                <b>Hardness report done</b> for this job ({state.hardnessReports.filter((h) => h.jobNo === jobNo).map((h) => h.id).join(', ')}).
              </>
            ) : (
              <>
                <b>This product needs a hardness check</b> ({pf.of(job.productId).hardnessMin}–{pf.of(job.productId).hardnessMax} {pf.of(job.productId).hardnessScale}) and no hardness report has been entered for {jobNo} yet. Add it from the Hardness tab.
              </>
            )}
          </div>
        </div>
      )}
      <div className="form-grid three">
        <Field label="Inward Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Received Qty" hint="OK qty from Heat Treatment">
          <NumInput value={rec.input} readOnly />
        </Field>
        <Field label="Rejection Qty" required error={bad ? `0 to ${rec.input}` : null}>
          <NumInput value={rejected} onChange={setRejected} bad={bad} autoFocus />
        </Field>
        <Field label="OK Qty" hint="Received − Rejection">
          <NumInput value={bad ? '' : a} readOnly />
        </Field>
        <Field label="Checked By">
          <select value={checkedBy} onChange={(e) => setCheckedBy(e.target.value)}>
            <option value="">Select…</option>
            {masters.inspectors.map((i) => (
              <option key={i}>{i}</option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 18 }}>
        <QtyFlow input={rec.input} loss={bad ? 0 : r} output={bad ? '—' : a} />
      </div>
    </Modal>
  );
}
