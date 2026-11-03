import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, FileSpreadsheet, Pencil, Plus, Printer, Ruler, Trash2 } from 'lucide-react';
import { Conf, Write, canSee, currentUserName, searchable } from '../auth/access';
import { Confirm, Empty, Field, Search } from '../components/ui';
import { fmtDate, matches, todayISO } from '../components/format';
import { CustomerSelect } from '../masters/CustomerSelect';
import { useStore } from '../store/StoreContext';
import { getProduct } from '../store/engine';
import { deleteDimensionReport, fetchDimensionReports, saveDimensionReport, type DimInput } from './service';
import { exportDimensionXlsx, printDimensionReport } from './output';
import { CONCLUSIONS, INSTRUMENTS, SAMPLES, blankLine, lineResult, sampleOk, type DimLine, type DimReport, type LineKind } from './types';

const overall = (r: DimReport) => {
  const res = r.lines.map(lineResult);
  return res.includes('NOT OK') ? 'NOT OK' : res.length && res.every((x) => x === 'OK') ? 'OK' : 'Incomplete';
};
const chip = { OK: 'chip chip-up', 'NOT OK': 'chip chip-hot', Incomplete: 'chip chip-wait' } as const;

/** next number to suggest: DIR-<year>-0001, 0002 … (the database still refuses a number that is already used) */
function suggestNo(list: DimReport[]) {
  const y = new Date().getFullYear();
  const re = new RegExp(`^DIR-${y}-(\\d+)$`);
  const max = list.reduce((m, r) => Math.max(m, Number(re.exec(r.reportNo)?.[1] ?? 0)), 0);
  return `DIR-${y}-${String(max + 1).padStart(4, '0')}`;
}

/** QC → Dimension Reports: the register, and the form to add / edit one (same sheet as the paper final-inspection report). */
export function DimensionTab() {
  const { toast } = useStore();
  const [list, setList] = useState<DimReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<DimReport | 'new' | null>(null);
  const [deleting, setDeleting] = useState<DimReport | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await fetchDimensionReports());
    } catch (e) {
      toast({ kind: 'error', title: 'Could not load the dimension reports', message: e instanceof Error ? e.message : String(e) });
    }
    setLoaded(true);
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => list.filter((r) => matches(q, r.reportNo, r.itemName, r.itemNo, r.dieNo, searchable(r.customer))), [list, q]);
  const out = (fn: () => Promise<void>) => fn().catch((e) => toast({ kind: 'error', title: 'Could not export', message: e instanceof Error ? e.message : String(e) }));

  if (editing) return <DimensionForm report={editing === 'new' ? null : editing} suggested={suggestNo(list)} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />;

  const add = (
    <Write res="qc">
      <button className="btn btn-primary" onClick={() => setEditing('new')}>
        <Plus size={15} /> Add Dimension Report
      </button>
    </Write>
  );

  return (
    <>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder={canSee('party_names') ? 'Search report, item, customer, die…' : 'Search report, item, die…'} />
        {add}
      </div>
      {!loaded ? (
        <div className="card-center-msg">Loading…</div>
      ) : rows.length === 0 ? (
        <Empty icon={Ruler} title={list.length ? 'No matches' : 'No dimension reports yet'} text="The final-inspection sheet: parameters, tolerances, five observations and the result." action={list.length ? undefined : add} />
      ) : (
        <div className="table-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Report No.</th>
                <th>Date</th>
                <th>Item</th>
                <Conf g="party_names">
                  <th>Customer</th>
                </Conf>
                <th>Die No.</th>
                <th className="r">Lines</th>
                <th>Result</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono strong">{r.reportNo}</td>
                  <td className="nowrap">{fmtDate(r.reportDate)}</td>
                  <td>
                    <div className="strong">{r.itemName}</div>
                    <div className="sub">{r.itemNo}</div>
                  </td>
                  <Conf g="party_names">
                    <td>{r.customer || '—'}</td>
                  </Conf>
                  <td>{r.dieNo || '—'}</td>
                  <td className="r num">{r.lines.length}</td>
                  <td>
                    <span className={chip[overall(r)]}>{overall(r)}</span>
                    {r.conclusion && <div className="sub">{r.conclusion}</div>}
                  </td>
                  <td className="r nowrap">
                    <div className="icon-actions">
                      <button className="icon-btn" title="View / print" aria-label={`Print ${r.reportNo}`} onClick={() => printDimensionReport(r)}>
                        <Printer size={16} />
                      </button>
                      <button className="icon-btn" title="Excel" aria-label={`Excel ${r.reportNo}`} onClick={() => void out(() => exportDimensionXlsx(r, currentUserName()))}>
                        <FileSpreadsheet size={16} />
                      </button>
                      <Write res="qc">
                        <button className="icon-btn" title="Edit" aria-label={`Edit ${r.reportNo}`} onClick={() => setEditing(r)}>
                          <Pencil size={16} />
                        </button>
                        <button className="icon-btn danger" title="Delete" aria-label={`Delete ${r.reportNo}`} onClick={() => setDeleting(r)}>
                          <Trash2 size={16} />
                        </button>
                      </Write>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Confirm
        open={!!deleting}
        title="Delete dimension report"
        message={deleting ? `Delete ${deleting.reportNo} · ${deleting.itemName}?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          const d = deleting;
          if (!d) return;
          void deleteDimensionReport(d.id)
            .then(async () => {
              toast({ kind: 'success', title: 'Report deleted', message: d.reportNo });
              await load();
            })
            .catch((e) => toast({ kind: 'error', title: 'Could not delete', message: e instanceof Error ? e.message : String(e) }));
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

// ======================================================================= the form
function DimensionForm({ report, suggested, onClose, onSaved }: { report: DimReport | null; suggested: string; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const { state, toast } = useStore();
  const [f, setF] = useState({
    reportNo: report?.reportNo ?? suggested,
    reportDate: report?.reportDate ?? todayISO(),
    itemName: report?.itemName ?? '',
    itemNo: report?.itemNo ?? '',
    customer: canSee('party_names') ? report?.customer ?? '' : '',
    invoiceDate: report?.invoiceDate ?? '',
    invoiceQty: report?.invoiceQty ?? '',
    dieNo: report?.dieNo ?? '',
    jobNo: report?.jobNo ?? '',
    conclusion: report?.conclusion ?? '',
    customerApproval: report?.customerApproval ?? '',
    remarks: report?.remarks ?? '',
    checkedBy: report?.checkedBy ?? currentUserName(),
    reviewedBy: report?.reviewedBy ?? '',
  });
  const [lines, setLines] = useState<DimLine[]>(report?.lines.length ? report.lines : [blankLine()]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, patch: Partial<DimLine>) => setLines((c) => c.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setSample = (i: number, s: number, v: string) => setLines((c) => c.map((l, k) => (k === i ? { ...l, samples: l.samples.map((x, j) => (j === s ? v : x)) } : l)));
  const move = (i: number, d: -1 | 1) =>
    setLines((c) => {
      const j = i + d;
      if (j < 0 || j >= c.length) return c;
      const n = [...c];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const changeKind = (i: number, kind: LineKind) => setLines((c) => c.map((l, k) => (k === i ? { ...blankLine(kind), parameter: l.parameter, spec: l.spec } : l)));

  // picking a job card fills the item, die and customer
  const pickJob = (no: string) => {
    if (!no) return set('jobNo', '');
    const job = state.jobs.find((j) => j.jobNo === no);
    if (!job) return;
    const p = getProduct(state, job.productId);
    setF((x) => ({ ...x, jobNo: no, itemName: p.name, itemNo: p.code, dieNo: job.dieNo ?? p.dieNo, customer: canSee('party_names') ? job.customer : '' }));
  };

  const valid = f.itemName.trim() !== '' && lines.length > 0 && lines.every((l) => l.parameter.trim() !== '');

  const save = async () => {
    setBusy(true);
    try {
      const input: DimInput = { ...f, lines };
      await saveDimensionReport(report?.id ?? null, input, currentUserName());
      toast({ kind: 'success', title: report ? 'Dimension report updated' : 'Dimension report saved', message: f.reportNo || f.itemName });
      await onSaved();
    } catch (e) {
      toast({ kind: 'error', title: 'Could not save the report', message: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };

  const tolDisabled = (l: DimLine) => l.kind !== 'measure';
  return (
    <div>
      <div className="card-head">
        <div>
          <h3>{report ? `Edit ${report.reportNo}` : 'Add Dimension Report'}</h3>
          <div className="sub">The final-inspection sheet. The result of each line is worked out from the tolerances.</div>
        </div>
        <div className="right" style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>
            <ArrowLeft size={15} /> Back
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
            Save report
          </button>
        </div>
      </div>

      <div style={{ padding: '4px 20px 20px' }}>
        <div className="form-grid three">
          <Field label="Inspection Report No." hint="Numbered automatically — you can change it. A number already in use is not accepted.">
            <input className="input mono" value={f.reportNo} onChange={(e) => set('reportNo', e.target.value)} />
          </Field>
          <Field label="Inspection Date" required>
            <input className="input" type="date" value={f.reportDate} onChange={(e) => set('reportDate', e.target.value)} />
          </Field>
          <Field label="Job Card (optional)" hint="Pick a job to fill the item, die and customer">
            <select value={f.jobNo} onChange={(e) => pickJob(e.target.value)}>
              <option value="">— Not linked to a job —</option>
              {state.jobs.map((j) => (
                <option key={j.jobNo} value={j.jobNo}>
                  {j.jobNo} · {getProduct(state, j.productId).name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Item Name" required>
            <input className="input" value={f.itemName} onChange={(e) => set('itemName', e.target.value)} placeholder="e.g. CONTACT CASTED IN EPOXY 1250A" />
          </Field>
          <Field label="Item No.">
            <input className="input" value={f.itemNo} onChange={(e) => set('itemNo', e.target.value)} placeholder="e.g. KA-647 / 5A" />
          </Field>
          {canSee('party_names') && (
            <Field label="Customer Name">
              <CustomerSelect value={f.customer} onChange={(name) => set('customer', name)} />
            </Field>
          )}
          <Field label="Die No.">
            <input className="input" value={f.dieNo} onChange={(e) => set('dieNo', e.target.value)} placeholder="e.g. EAF 231" />
          </Field>
          <Field label="Invoice Date">
            <input className="input" type="date" value={f.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} />
          </Field>
          <Field label="Lot / Invoice Qty.">
            <input className="input" value={f.invoiceQty} onChange={(e) => set('invoiceQty', e.target.value)} />
          </Field>
        </div>

        <div className="section-label" style={{ marginTop: 20 }}>Inspection lines</div>
        <div className="table-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
          <table className="tbl form-tbl" style={{ fontSize: 13, minWidth: 1280 }}>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ width: 118 }}>Type</th>
                <th style={{ minWidth: 150 }}>Parameter *</th>
                <th style={{ width: 150 }}>Measuring instrument</th>
                <th style={{ width: 92 }}>Specification</th>
                <th style={{ width: 82 }}>USL</th>
                <th style={{ width: 82 }}>LSL</th>
                {Array.from({ length: SAMPLES }, (_, s) => (
                  <th key={s} style={{ width: 82 }}>
                    {s + 1}
                  </th>
                ))}
                <th style={{ width: 96 }}>Result</th>
                <th className="act" style={{ width: 112 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const res = lineResult(l);
                return (
                  <tr key={i}>
                    <td className="mono muted">{i + 1}</td>
                    <td>
                      <select value={l.kind} onChange={(e) => changeKind(i, e.target.value as LineKind)} aria-label={`Type of line ${i + 1}`}>
                        <option value="measure">Measured</option>
                        <option value="gonogo">Go &amp; Nogo</option>
                        <option value="text">As per program</option>
                      </select>
                    </td>
                    <td>
                      <input value={l.parameter} onChange={(e) => setLine(i, { parameter: e.target.value })} placeholder="e.g. OD" aria-label={`Parameter ${i + 1}`} />
                    </td>
                    <td>
                      <input value={l.instrument} list="dim-instruments" onChange={(e) => setLine(i, { instrument: e.target.value })} aria-label={`Instrument ${i + 1}`} />
                    </td>
                    <td>
                      <input className="mono" value={l.spec} onChange={(e) => setLine(i, { spec: e.target.value })} placeholder={l.kind === 'measure' ? '90.0' : 'R10 / M12'} aria-label={`Specification ${i + 1}`} />
                    </td>
                    <td>
                      <input className="mono" value={l.usl} disabled={tolDisabled(l)} onChange={(e) => setLine(i, { usl: e.target.value })} aria-label={`USL ${i + 1}`} />
                    </td>
                    <td>
                      <input className="mono" value={l.lsl} disabled={tolDisabled(l)} onChange={(e) => setLine(i, { lsl: e.target.value })} aria-label={`LSL ${i + 1}`} />
                    </td>
                    {l.samples.map((v, s) => (
                      <td key={s}>
                        {l.kind === 'gonogo' ? (
                          <select value={v} onChange={(e) => setSample(i, s, e.target.value)} aria-label={`Observation ${s + 1} of line ${i + 1}`}>
                            <option value="" />
                            <option>OK</option>
                            <option>NOT OK</option>
                          </select>
                        ) : (
                          <input className={`mono ${sampleOk(l, v) === false ? 'bad' : ''}`} value={v} onChange={(e) => setSample(i, s, e.target.value)} aria-label={`Observation ${s + 1} of line ${i + 1}`} />
                        )}
                      </td>
                    ))}
                    <td>
                      {l.kind === 'text' ? (
                        <select value={l.result} onChange={(e) => setLine(i, { result: e.target.value as DimLine['result'] })} aria-label={`Result of line ${i + 1}`}>
                          <option value="OK">OK</option>
                          <option value="NOT OK">NOT OK</option>
                        </select>
                      ) : (
                        <span className={res === 'NOT OK' ? 'chip chip-hot' : res === 'OK' ? 'chip chip-up' : 'chip'}>{res || '—'}</span>
                      )}
                    </td>
                    <td className="act nowrap">
                      <button type="button" className="icon-btn" title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowUp size={14} />
                      </button>
                      <button type="button" className="icon-btn" title="Move down" onClick={() => move(i, 1)} disabled={i === lines.length - 1}>
                        <ArrowDown size={14} />
                      </button>
                      <button type="button" className="icon-btn" title="Duplicate line" onClick={() => setLines((c) => [...c.slice(0, i + 1), { ...l, samples: [...l.samples] }, ...c.slice(i + 1)])}>
                        <Copy size={14} />
                      </button>
                      <button type="button" className="icon-btn text-red" title="Remove line" onClick={() => setLines((c) => (c.length > 1 ? c.filter((_, k) => k !== i) : c))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <datalist id="dim-instruments">
          {INSTRUMENTS.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((c) => [...c, blankLine('measure')])}>
            <Plus size={14} /> Measured line
          </button>
          <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((c) => [...c, blankLine('gonogo')])}>
            <Plus size={14} /> Go &amp; Nogo line
          </button>
          <button type="button" className="btn btn-sm btn-subtle" onClick={() => setLines((c) => [...c, blankLine('text')])}>
            <Plus size={14} /> As-per-program line
          </button>
          <span className="text-xs muted" style={{ alignSelf: 'center' }}>A measured line is OK when every observation is between its LSL and USL.</span>
        </div>

        <div className="form-grid three" style={{ marginTop: 20 }}>
          <Field label="Conclusion">
            <select value={f.conclusion} onChange={(e) => set('conclusion', e.target.value)}>
              <option value="">Lot Accepted / Rejected / Accepted Under deviation</option>
              {CONCLUSIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Customer Approval (if required)">
            <input className="input" value={f.customerApproval} onChange={(e) => set('customerApproval', e.target.value)} />
          </Field>
          <div />
          <Field label="Checked By">
            <input className="input" value={f.checkedBy} onChange={(e) => set('checkedBy', e.target.value)} />
          </Field>
          <Field label="Reviewed By">
            <input className="input" value={f.reviewedBy} onChange={(e) => set('reviewedBy', e.target.value)} />
          </Field>
          <Field label="Remarks (if any)" full>
            <textarea value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
        </div>
      </div>
    </div>
  );
}

