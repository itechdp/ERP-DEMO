import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Conf } from '../auth/access';
import { dbMessage, supabase } from '../db/client';
import { priorityName, clampPriority } from '../planning/priority';
import { hardnessVerdict } from '../store/engine';
import { useStore } from '../store/StoreContext';
import { lineResult, type DimLine } from '../dimension/types';
import { Badge, go } from './ui';
import { fmtDate, fmtDateTime, fmtNum } from './format';

interface Extras {
  furnace: { id: number; name: string; shift: string; cycleNo: string; startedAt: string; endsAt: string; releasedAt: string | null; loadedBy: string }[];
  plan: { stage: string; rank: number; approvedBy: string; approvedAt: string; doneAt: string | null }[];
  dims: { id: number; reportNo: string; reportDate: string; conclusion: string; result: string }[];
  out: { id: number; outNo: string; vendor: string; item: string; process: string; qty: number; uom: string; dueDate: string; status: string; receivedOn: string }[];
}

type R = Record<string, any>;
const quiet = async <T,>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
  try {
    const { data, error } = await q;
    return error ? [] : ((data ?? []) as T[]); // a table that is not set up yet simply shows nothing
  } catch {
    return [];
  }
};

/** the records of other pages that belong to this job: the furnace run, the planning approval, dimension reports and work given out */
async function fetchExtras(jobNo: string): Promise<Extras> {
  const [loads, furnaces, plan, dims, out] = await Promise.all([
    quiet<R>(supabase.from('v_furnace_loads').select('*').eq('job_no', jobNo).order('started_at')),
    quiet<R>(supabase.from('v_furnaces').select('id, name')),
    quiet<R>(supabase.from('v_production_plan_history').select('*').eq('job_no', jobNo).order('approved_at')),
    quiet<R>(supabase.from('v_dimension_reports').select('id, report_no, report_date, conclusion, lines').eq('job_no', jobNo).order('report_date')),
    quiet<R>(supabase.from('v_job_work_out').select('*').eq('job_no', jobNo).order('out_date')),
  ]);
  const name = new Map(furnaces.map((f) => [Number(f.id), String(f.name)]));
  return {
    furnace: loads.map((l) => ({ id: Number(l.id), name: name.get(Number(l.furnace_id)) ?? 'Furnace', shift: l.shift ?? '', cycleNo: l.cycle_no ?? '', startedAt: l.started_at, endsAt: l.ends_at, releasedAt: l.released_at ?? null, loadedBy: l.loaded_by ?? '' })),
    plan: plan.map((p) => ({ stage: p.stage, rank: Number(p.rank), approvedBy: p.approved_by ?? '', approvedAt: p.approved_at, doneAt: p.done_at ?? null })),
    dims: dims.map((d) => {
      const res = ((d.lines ?? []) as DimLine[]).map((l) => lineResult({ ...l, samples: l.samples ?? [] }));
      return { id: Number(d.id), reportNo: d.report_no, reportDate: d.report_date ?? '', conclusion: d.conclusion ?? '', result: res.includes('NOT OK') ? 'NOT OK' : res.length && res.every((x) => x === 'OK') ? 'OK' : 'Incomplete' };
    }),
    out: out.map((o) => ({ id: Number(o.id), outNo: o.out_no, vendor: o.vendor ?? '', item: o.item ?? '', process: o.process ?? '', qty: Number(o.qty), uom: o.uom ?? 'PCS', dueDate: o.due_date ?? '', status: o.status, receivedOn: o.received_on ?? '' })),
  };
}

/** Job Traceability → the records that live on other pages: hardness and dimension reports, the furnace run, the Heat Treatment approval, work given out. */
export function TraceExtras({ jobNo }: { jobNo: string }) {
  const { state } = useStore();
  const [x, setX] = useState<Extras | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setX(null);
    fetchExtras(jobNo)
      .then((r) => live && setX(r))
      .catch((e) => live && setErr(dbMessage(e)));
    return () => {
      live = false;
    };
  }, [jobNo, state]);

  const hardness = state.hardnessReports.filter((h) => h.jobNo === jobNo);
  const none = !x || (!x.furnace.length && !x.plan.length && !x.dims.length && !x.out.length);
  if (err || (none && !hardness.length)) return null;

  const card = (title: string, sub: string, body: JSX.Element) => (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h3>{title}</h3>
        <span className="sub">{sub}</span>
      </div>
      <div className="table-wrap">{body}</div>
    </div>
  );

  return (
    <>
      {x && x.plan.length > 0 &&
        card('Heat Treatment approval', 'Who approved it, and the priority given', (
          <table className="tbl">
            <thead><tr><th>Approved</th><th>By</th><th>Priority</th><th>Done</th></tr></thead>
            <tbody>
              {x.plan.map((p, i) => (
                <tr key={i}>
                  <td className="nowrap">{fmtDateTime(p.approvedAt)}</td>
                  <td>{p.approvedBy || '—'}</td>
                  <td>{clampPriority(p.rank)} · {priorityName(clampPriority(p.rank))}</td>
                  <td className="nowrap">{p.doneAt ? fmtDateTime(p.doneAt) : <span className="muted">in progress</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {x && x.furnace.length > 0 &&
        card('Furnace', 'Which furnace the batch was in, and for how long', (
          <table className="tbl">
            <thead><tr><th>Furnace</th><th>Shift</th><th>Cycle no.</th><th>Loaded</th><th>Out</th><th>Loaded by</th></tr></thead>
            <tbody>
              {x.furnace.map((f) => (
                <tr key={f.id}>
                  <td className="strong">{f.name}</td>
                  <td>{f.shift || '—'}</td>
                  <td className="mono">{f.cycleNo || '—'}</td>
                  <td className="nowrap">{fmtDateTime(f.startedAt)}</td>
                  <td className="nowrap">{f.releasedAt ? fmtDateTime(f.releasedAt) : <>until {fmtDateTime(f.endsAt)}</>}</td>
                  <td>{f.loadedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {hardness.length > 0 &&
        card('Hardness reports', 'Reports entered for this job', (
          <table className="tbl">
            <thead><tr><th>Report</th><th>Date</th><th>Required</th><th>Result</th></tr></thead>
            <tbody>
              {hardness.map((h) => (
                <tr key={h.id}>
                  <td className="mono strong">{h.id}</td>
                  <td className="nowrap">{fmtDate(h.date)}</td>
                  <td>{h.min} to {h.max} {h.scale}</td>
                  <td><Badge status={hardnessVerdict(h)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {x && x.dims.length > 0 &&
        card('Dimension reports', 'Final-inspection sheets for this job', (
          <table className="tbl">
            <thead><tr><th>Report</th><th>Date</th><th>Conclusion</th><th>Result</th><th /></tr></thead>
            <tbody>
              {x.dims.map((d) => (
                <tr key={d.id}>
                  <td className="mono strong">{d.reportNo}</td>
                  <td className="nowrap">{fmtDate(d.reportDate)}</td>
                  <td>{d.conclusion || '—'}</td>
                  <td><span className={d.result === 'OK' ? 'chip chip-up' : d.result === 'NOT OK' ? 'chip chip-hot' : 'chip chip-wait'}>{d.result}</span></td>
                  <td className="r"><button className="btn-link" onClick={() => go('qc')}>Open QC <ArrowRight size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {x && x.out.length > 0 &&
        card('Work given out (Job Work Out)', 'Entries linked to this job card', (
          <table className="tbl">
            <thead><tr><th>Entry</th><Conf g="party_names"><th>Given to</th></Conf><th>Work</th><th className="r">Qty</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {x.out.map((o) => (
                <tr key={o.id}>
                  <td className="mono strong">{o.outNo}</td>
                  <Conf g="party_names"><td>{o.vendor || '—'}</td></Conf>
                  <td>{[o.item, o.process].filter(Boolean).join(' · ')}</td>
                  <td className="r num">{fmtNum(o.qty)} {o.uom}</td>
                  <td className="nowrap">{o.dueDate ? fmtDate(o.dueDate) : '—'}</td>
                  <td>{o.status === 'Sent' ? 'With others' : o.status === 'Received' ? `Back ${o.receivedOn ? fmtDate(o.receivedOn) : ''}` : o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </>
  );
}
