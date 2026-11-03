import { useMemo, useState } from 'react';
import { ClipboardList, FileSpreadsheet, FileText } from 'lucide-react';
import { Conf, canSee, currentUserName, searchable } from '../auth/access';
import { Empty, FilterMenu, JobLink, Search } from '../components/ui';
import { fmtDate, matches } from '../components/format';
import { FORM_FORMATS, downloadFormSheet, type SheetSpec } from '../export/xlsxSheet';
import { printSpec } from '../export/docOutput';
import { STAGE_LABEL } from '../store/engine';
import { useStore } from '../store/StoreContext';
import type { ERPState, JobWork, ProcessStage, StageRecord } from '../store/types';

const ORDER: ProcessStage[] = ['cutting', 'forging', 'trimming', 'heatTreatment'];
const COUNT_LABEL = ['', 'Single process', 'Dual process', 'Triple process', 'Four processes'];

type StepState = 'done' | 'running' | 'waiting';
interface Step {
  stage: ProcessStage;
  state: StepState;
  rec?: StageRecord;
  text: string;
}

/** how every chosen process of a job-work batch stands: waiting, running or done, with the quantities and the date */
function stepsOf(s: ERPState, w: JobWork): Step[] {
  return ORDER.filter((k) => w.processes[k]).map((stage) => {
    const rec = (s[stage] as StageRecord[]).find((r) => r.jobNo === w.jobNo);
    if (!rec || rec.status === 'Pending') return { stage, rec, state: 'waiting' as const, text: rec ? `${rec.input} PCS waiting` : 'Not reached' };
    if (rec.status === 'In Progress') return { stage, rec, state: 'running' as const, text: `${rec.input} PCS in progress` };
    return { stage, rec, state: 'done' as const, text: `${rec.output} OK${rec.loss ? ` · ${rec.loss} rejected` : ''}${rec.completedAt ? ` · ${fmtDate(rec.completedAt)}` : ''}` };
  });
}

function afterText(s: ERPState, w: JobWork) {
  const job = s.jobs.find((j) => j.jobNo === w.jobNo);
  const qc = s.qc.find((r) => r.jobNo === w.jobNo);
  const fg = s.finishedGoods.filter((f) => f.jobNo === w.jobNo);
  const disp = s.dispatches.filter((d) => d.jobNo === w.jobNo);
  const shipped = disp.filter((d) => d.status === 'Dispatched').reduce((t, d) => t + d.qty, 0);
  return {
    qc: !w.qcRequired ? 'Not required' : qc ? (qc.status === 'QC Pending' ? 'Waiting for QC' : `${qc.status} · ${qc.accepted} OK${qc.rejected ? ` · ${qc.rejected} rejected` : ''}`) : 'Not reached',
    dispatch: shipped > 0 ? `${shipped} PCS returned` : disp.length ? 'Packed, waiting' : fg.length ? 'In parts store' : '—',
    nowAt: job ? STAGE_LABEL[job.currentStage] : '—',
  };
}

const progressOf = (steps: Step[]) => (steps.length ? Math.round((steps.filter((x) => x.state === 'done').length / steps.length) * 100) : 0);

const chipClass = (st: StepState) => (st === 'done' ? 'chip chip-up' : st === 'running' ? 'chip chip-run' : 'chip chip-wait');

/** Job Work → Job Card Report: for every batch, which processes it goes through (one, two or more) and how each one is going. */
export function JobCardReport() {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [countF, setCountF] = useState('all');
  const [procF, setProcF] = useState('all');
  const [doneF, setDoneF] = useState('all');

  const rows = useMemo(
    () =>
      [...state.jobWork]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.jobNo.localeCompare(a.jobNo))
        .map((w) => {
          const steps = stepsOf(state, w);
          return { w, steps, pct: progressOf(steps), job: state.jobs.find((j) => j.jobNo === w.jobNo), product: state.products.find((p) => p.id === state.jobs.find((j) => j.jobNo === w.jobNo)?.productId), after: afterText(state, w) };
        }),
    [state],
  );

  const shown = rows
    .filter((r) => countF === 'all' || String(r.steps.length) === countF)
    .filter((r) => procF === 'all' || r.steps.some((x) => x.stage === procF))
    .filter((r) => doneF === 'all' || (doneF === 'done' ? r.pct === 100 : r.pct < 100))
    .filter((r) => matches(q, r.w.jobNo, r.w.challanNo, r.product?.name, r.w.itemDescription, searchable(r.job?.customer)));

  const spec = (): SheetSpec => ({
      filename: 'Job-Card-Report',
      sheet: 'Job Card Report',
      form: FORM_FORMATS.report,
      title: 'Job Work — Job Card Report',
      info: [[`Batches :- ${shown.length}`, `Printed :- ${fmtDate(new Date().toISOString())}`]],
      widths: [16, 24, 18, 14, 26, 26, 26, 26, 12, 22, 20],
      blocks: [
        {
          headers: ['Job No.', 'Item', 'Customer', 'Processes', ...ORDER.map((k) => STAGE_LABEL[k]), 'Done %', 'QC', 'Now at'],
          align: ['left', 'left', 'left', 'center', 'left', 'left', 'left', 'left', 'center', 'left', 'left'],
          rows: shown.map((r) => ({
            cells: [
              r.w.jobNo,
              r.product?.name ?? '',
              canSee('party_names') ? r.job?.customer ?? '' : '',
              COUNT_LABEL[r.steps.length] ?? `${r.steps.length} processes`,
              ...ORDER.map((k) => r.steps.find((x) => x.stage === k)?.text ?? 'Not required'),
              r.pct,
              r.after.qc,
              r.after.nowAt,
            ],
          })),
        },
      ],
      checkedBy: currentUserName(),
    });
  const exportXlsx = () => downloadFormSheet(spec());

  if (rows.length === 0) return <div className="card"><Empty icon={ClipboardList} title="No job cards yet" text="Once parts are received, each batch's processes and their progress are reported here." /></div>;

  const procs = ORDER.filter((k) => rows.some((r) => r.steps.some((x) => x.stage === k)));
  return (
    <div className="card">
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search job, customer, challan, item…' : 'Search job, challan, item…'} />
        <FilterMenu
          groups={[
            { label: 'Processes', value: countF, onChange: setCountF, options: [{ value: 'all', label: 'Any number' }, ...[1, 2, 3, 4].filter((n) => rows.some((r) => r.steps.length === n)).map((n) => ({ value: String(n), label: COUNT_LABEL[n], count: rows.filter((r) => r.steps.length === n).length }))] },
            { label: 'Includes', value: procF, onChange: setProcF, options: [{ value: 'all', label: 'All processes' }, ...procs.map((k) => ({ value: k, label: STAGE_LABEL[k] }))] },
            { label: 'Progress', value: doneF, onChange: setDoneF, options: [{ value: 'all', label: 'All' }, { value: 'open', label: 'In progress' }, { value: 'done', label: 'All processes done' }] },
          ]}
        />
        <button className="btn" onClick={() => void exportXlsx()}>
          <FileSpreadsheet size={15} /> Excel
        </button>
        <button className="btn" onClick={() => printSpec(spec())}>
          <FileText size={15} /> PDF
        </button>
      </div>
      {shown.length === 0 ? (
        <Empty icon={ClipboardList} title="No matches" text="Try a different search or filter." />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Job No.</th>
                <th>Item</th>
                <Conf g="party_names">
                  <th>Customer</th>
                </Conf>
                <th>Processes</th>
                <th>Progress of each process</th>
                <th>QC</th>
                <th>Now at</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.w.jobNo}>
                  <td className="nowrap">
                    <JobLink jobNo={r.w.jobNo} />
                    <div className="sub">{r.w.challanNo ? `Challan ${r.w.challanNo}` : ''}</div>
                  </td>
                  <td>
                    <div className="strong">{r.product?.name ?? '—'}</div>
                    <div className="sub">{r.w.receivedQty} PCS received</div>
                  </td>
                  <Conf g="party_names">
                    <td>{r.job?.customer || '—'}</td>
                  </Conf>
                  <td className="nowrap">
                    <div className="strong">{COUNT_LABEL[r.steps.length]}</div>
                    <div className="progress-bar-wrap" style={{ width: 90, marginTop: 6 }} title={`${r.pct}% of the chosen processes done`}>
                      <div className="progress-bar" style={{ width: `${r.pct}%` }} />
                    </div>
                    <div className="sub">{r.pct}% done</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {r.steps.map((x) => (
                        <div key={x.stage} style={{ minWidth: 130 }}>
                          <span className={chipClass(x.state)}>{STAGE_LABEL[x.stage]}</span>
                          <div className="sub">{x.text}</div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div>{r.after.qc}</div>
                    <div className="sub">{r.after.dispatch}</div>
                  </td>
                  <td className="nowrap">{r.after.nowAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
