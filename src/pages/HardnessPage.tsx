import * as api from '../db/api';
import { canSee, searchable, Write, Conf, colOk, searchableCol } from '../auth/access';
import { useMemo, useState } from 'react';
import { ClipboardCheck, Eye, Printer, Plus, Trash2 } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import {
  HARDNESS_FORM,
  HARDNESS_SCALES,
  hardnessVerdict,
  readingResult,
  requiredText,
  getProduct,
  type HardnessVerdict,
} from '../store/engine';
import { useProductFlows } from '../products/flow';
import { HARDNESS_MATERIALS, hardnessGrades, hardnessSpecForRawMaterial, isHardnessMaterial } from '../store/hardnessSpecs';
import type { HardnessReport, HardnessScale } from '../store/types';
import { Badge, Empty, Field, Modal, NumInput, rowTone, Search, FilterMenu, Confirm } from '../components/ui';
import { tsFor } from '../components/NewJobModal';
import { printHtml } from '../components/printHtml';
import { fmtDate, matches, todayISO } from '../components/format';

const DEFAULT_READINGS = 1; // a new report starts with one row; "Add row" adds more (the paper sheet has 10)
const MAX_READINGS = 50;

// ===================================================== register (QC tab) ===
export function HardnessRegister() {
  const { state, openAction, run } = useStore();
  const [deleting, setDeleting] = useState<HardnessReport | null>(null);
  const [q, setQ] = useState('');
  const [v, setV] = useState<'all' | HardnessVerdict>('all');
  const [compF, setCompF] = useState('all');
  const all = state.hardnessReports;
  const count = (x: HardnessVerdict) => all.filter((r) => hardnessVerdict(r) === x).length;
  const rows = useMemo(
    () =>
      all
        .filter((r) => v === 'all' || hardnessVerdict(r) === v)
        .filter((r) => compF === 'all' || r.component === compF)
        .filter((r) => matches(q, r.id, r.component, r.material, searchableCol(r.cycleNo, 'hardness.cycle_drawing'), r.jobNo, r.checkedBy, searchable(r.supplier)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    [all, q, v, compF],
  );

  return (
    <>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Search report, component, cycle no., job…" />
        <FilterMenu
          groups={[
            {
              label: 'Result',
              value: v,
              onChange: (x) => setV(x as 'all' | HardnessVerdict),
              options: [
                { value: 'all', label: 'All', count: all.length },
                { value: 'Pass', label: 'Pass', count: count('Pass') },
                { value: 'Fail', label: 'Fail', count: count('Fail') },
                { value: 'Incomplete', label: 'Incomplete', count: count('Incomplete') },
              ],
            },
            { label: 'Component', value: compF, onChange: setCompF, options: [{ value: 'all', label: 'All components' }, ...[...new Set(all.map((r) => r.component))].sort().map((c) => ({ value: c, label: c }))] },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <Empty
          icon={ClipboardCheck}
          title={all.length ? 'No reports match' : 'No hardness reports yet'}
          text={all.length ? 'Try a different search or filter.' : 'Record the hardness readings taken after heat treatment — same layout as the paper report (F QC 03).'}
          action={
            !all.length && (
              <Write res="qc"><button className="btn btn-primary" onClick={() => openAction({ kind: 'hardness' })}>
                <Plus size={15} /> New Hardness Report
              </button></Write>
            )
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="tbl compact">
            <thead>
              <tr>
                <th>Report No.</th>
                <th>Date</th>
                <th>Component</th>
                <th>Material</th>
                <Conf col="hardness.cycle_drawing">
                  <th>Cycle No.</th>
                </Conf>
                <th className="r">Inspected</th>
                <th>Required</th>
                <th>Readings</th>
                <th>Checked By</th>
                <th>Result</th>
                <th className="act">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const vals = r.readings.filter((x): x is number => x !== null);
                const verdict = hardnessVerdict(r);
                const open = () => openAction({ kind: 'hardness', id: r.id, view: true });
                return (
                  <tr key={r.id} className={`row-click ${rowTone(verdict)}`} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} title={`Open ${r.id}`}>
                    <td className="mono strong">{r.id}</td>
                    <td className="nowrap">{fmtDate(r.date)}</td>
                    <td className="strong">
                      {r.component}
                      {r.jobNo && <div className="sub mono">{r.jobNo}</div>}
                    </td>
                    <td>{r.material || '—'}</td>
                    <Conf col="hardness.cycle_drawing">
                      <td>{r.cycleNo || '—'}</td>
                    </Conf>
                    <td className="r">{r.inspectedQty}</td>
                    <td className="nowrap">{requiredText(r)}</td>
                    <td className="nowrap">{vals.length ? `${Math.min(...vals)} – ${Math.max(...vals)} ${r.scale}` : '—'}</td>
                    <td>{r.checkedBy}</td>
                    <td>
                      <Badge status={verdict} />
                    </td>
                    <td className="r nowrap">
                      <div className="icon-actions">
                        <button
                          className="icon-btn"
                          title="View"
                          aria-label={`View ${r.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            open();
                          }}
                        >
                          <Eye size={16} />
                        </button>
                        <Write res="qc">
                          <button
                            className="icon-btn danger"
                            title="Delete"
                            aria-label={`Delete ${r.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleting(r);
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </Write>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Confirm
        open={!!deleting}
        title="Delete hardness report"
        message={deleting ? `Delete ${deleting.id} · ${deleting.component}? Its readings are deleted with it.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run(() => api.deleteHardnessReport(deleting.id), { title: 'Hardness report deleted', message: `${deleting.id} · ${deleting.component}` })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

// ============================================================ the form ===
export function HardnessForm({ id, jobNo, viewOnly, onClose }: { id?: string; jobNo?: string; viewOnly?: boolean; onClose: () => void }) {
  const { state, run, masters } = useStore();
  const pf = useProductFlows();
  const cur = id ? state.hardnessReports.find((r) => r.id === id) : undefined;
  const [f, setF] = useState(() => ({
    jobNo: cur?.jobNo ?? jobNo ?? '',
    date: cur?.date ?? todayISO(),
    component: cur?.component ?? '',
    material: cur && isHardnessMaterial(cur.material) ? cur.material : '',
    grade: cur?.grade ?? '',
    supplier: canSee('party_names') ? cur?.supplier ?? '' : '',   // a hidden party name is never loaded into the form
    inwardQty: cur ? String(cur.inwardQty) : '',
    inspectedQty: cur ? String(cur.inspectedQty) : '',
    cycleNo: cur?.cycleNo ?? '',
    drawingNo: cur?.drawingNo ?? '',
    checkedBy: cur?.checkedBy ?? '',
    scale: (cur?.scale ?? 'HRB') as HardnessScale,
    min: cur ? String(cur.min) : '80',
    max: cur ? String(cur.max) : '90',
    remarks: cur?.remarks ?? '',
  }));
  const doc = useDocNo('hardness', !id);
  const [count, setCount] = useState(String(cur?.readings.length ?? DEFAULT_READINGS));
  const [vals, setVals] = useState<string[]>(() => cur?.readings.map((x) => (x === null ? '' : String(x))) ?? []);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // number of readings is its own choice (paper sheet: 10) — not tied to the inspected quantity
  const n = Math.min(MAX_READINGS, Math.max(0, Math.floor(Number(count)) || 0));
  const reading = (i: number) => vals[i] ?? '';
  const limits = { min: Number(f.min), max: Number(f.max) };
  const limitsOk = Number.isFinite(limits.min) && Number.isFinite(limits.max) && limits.min > 0 && limits.min <= limits.max;
  const parsed = Array.from({ length: n }, (_, i) => (reading(i).trim() === '' ? null : Number(reading(i))));
  const verdict = limitsOk ? hardnessVerdict({ ...limits, readings: parsed }) : 'Incomplete';

  const grades = hardnessGrades(f.material);
  // choosing a material / grade fills the required range (still editable afterwards)
  const pickMaterial = (m: string) => {
    const g = hardnessGrades(m)[0];
    setF((x) => ({ ...x, material: m, grade: g?.grade ?? '', ...(g ? { min: String(g.min), max: String(g.max), scale: g.scale } : {}) }));
  };
  const pickGrade = (grade: string) => {
    const g = grades.find((x) => x.grade === grade);
    setF((x) => ({ ...x, grade, ...(g ? { min: String(g.min), max: String(g.max), scale: g.scale } : {}) }));
  };

  const pickJob = (no: string) => {
    if (!no) return set('jobNo', '');
    const job = state.jobs.find((j) => j.jobNo === no)!;
    const p = getProduct(state, job.productId);
    const lot = state.rawMaterials.find((l) => l.id === job.issues[0]?.lotId);
    const qc = state.qc.find((r) => r.jobNo === no);
    const hs = hardnessSpecForRawMaterial(p.material);
    // a product with its own required range (Product Master) uses that range instead of the material's
    const own = pf.of(job.productId);
    const range = own.hardnessRequired && own.hardnessMin && own.hardnessMax ? { min: String(own.hardnessMin), max: String(own.hardnessMax), scale: own.hardnessScale } : {};
    setF((x) => ({
      ...x,
      jobNo: no,
      component: p.name,
      ...(hs ? { material: hs.family, grade: hs.grade, min: String(hs.min), max: String(hs.max), scale: hs.scale } : {}),
      ...range,
      supplier: canSee('party_names') ? lot?.supplier ?? x.supplier : '',
      inwardQty: qc ? String(qc.input) : x.inwardQty,
    }));
  };

  const submit = async () => {
    const readings = parsed;
    const ok = await withDocNo(id ? undefined : doc.custom, () => run(
      (now) =>
        api.saveHardnessReport(
          { jobNo: f.jobNo || undefined, date: f.date, component: f.component, material: f.material, grade: f.grade, supplier: canSee('party_names') ? f.supplier : cur?.supplier ?? '', inwardQty: Number(f.inwardQty) || 0, inspectedQty: Number(f.inspectedQty), cycleNo: f.cycleNo, drawingNo: f.drawingNo, checkedBy: f.checkedBy, scale: f.scale, min: limits.min, max: limits.max, readings, remarks: f.remarks },
          tsFor(f.date, now),
          id,
        ),
      { title: id ? 'Hardness report updated' : 'Hardness report saved', message: `${f.component} — ${verdict === 'Pass' ? 'all readings OK' : verdict === 'Fail' ? 'some readings are out of range' : 'readings incomplete'}.` },
    ));
    if (ok) onClose();
  };

  const addRow = () => setCount(String(Math.min(MAX_READINGS, n + 1)));
  const removeRow = () => {
    setVals((a) => a.slice(0, Math.max(1, n - 1)));
    setCount(String(Math.max(1, n - 1)));
  };
  const focusNext = (i: number) => {
    const go = () => (document.querySelector(`[data-reading="${i + 1}"]`) as HTMLInputElement | null)?.focus();
    if (i + 1 >= n && n < MAX_READINGS) {
      addRow();
      setTimeout(go, 0);
    } else go();
  };
  // only Aluminium / Brass / Copper jobs are reported on this form
  const jobs = state.jobs.filter((j) => j.currentStage !== 'scrapped' && (hardnessSpecForRawMaterial(getProduct(state, j.productId).material) || pf.of(j.productId).hardnessRequired));

  return (
    <Modal
      open
      size="lg"
      icon={ClipboardCheck}
      viewOnly={!!viewOnly && !!cur}
      viewActions={
        cur && (
          <button className="btn btn-primary" onClick={() => printHtml(`Hardness Report ${cur.id}`, sheetHtml(cur), HIR_CSS)}>
            <Printer size={15} /> Print
          </button>
        )
      }
      title={cur ? `${viewOnly ? 'View' : 'Edit'} ${cur.id}` : 'New Hardness Inspection Report'}
      subtitle={`Format ${HARDNESS_FORM.formatNo} · Rev. ${HARDNESS_FORM.revision}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {cur ? 'Save changes' : 'Save report'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        {!id && <DocNoField label="Report No." no={doc.no} setNo={doc.setNo} />}
        <Field label="Production Job (optional)" hint={canSee('party_names') ? 'Pick a job to fill component, material, supplier and qty automatically' : 'Pick a job to fill component, material and qty automatically'}>
          <select value={f.jobNo} onChange={(e) => pickJob(e.target.value)} disabled={!!cur}>
            <option value="">— Not linked to a job —</option>
            {jobs.map((j) => (
              <option key={j.jobNo} value={j.jobNo}>
                {j.jobNo} · {getProduct(state, j.productId).name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date" required>
          <input className="input" type="date" max={todayISO()} value={f.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        <Field label="Component Name" required>
          <input className="input" value={f.component} onChange={(e) => set('component', e.target.value)} />
        </Field>
        <Field label="Material" required>
          <select value={f.material} onChange={(e) => pickMaterial(e.target.value)}>
            <option value="">Select material…</option>
            {HARDNESS_MATERIALS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Material Grade" hint={f.grade ? 'Required hardness below is set from this grade' : undefined}>
          <select value={f.grade} onChange={(e) => pickGrade(e.target.value)} disabled={!f.material}>
            <option value="">{f.material ? 'Select grade…' : 'Select material first'}</option>
            {grades.map((g) => (
              <option key={g.grade} value={g.grade}>
                {g.grade} — {g.min} to {g.max} {g.scale}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inward Qty">
          <NumInput value={f.inwardQty} onChange={(v) => set('inwardQty', v)} />
        </Field>
        <Field label="Inspected Qty" required>
          <NumInput value={f.inspectedQty} onChange={(v) => set('inspectedQty', v)} />
        </Field>
        {canSee('party_names') && (
          <Field label="Supplier Name">
            <input className="input" value={f.supplier} onChange={(e) => set('supplier', e.target.value)} />
          </Field>
        )}
        {colOk('hardness.cycle_drawing') && (
          <>
            <Field label="Hardness Cycle No.">
              <input className="input" value={f.cycleNo} onChange={(e) => set('cycleNo', e.target.value)} />
            </Field>
            <Field label="Drawing No.">
              <input className="input" value={f.drawingNo} onChange={(e) => set('drawingNo', e.target.value)} />
            </Field>
          </>
        )}
        <Field label="Checked By" required>
          <input className="input" list="hir-checkers" value={f.checkedBy} onChange={(e) => set('checkedBy', e.target.value)} />
          <datalist id="hir-checkers">
            {masters.inspectors.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>
        </Field>
        <div className="field full">
          <label>
            Required Hardness <span className="req">*</span>
          </label>
          <div className="hir-range">
            <NumInput suffix="from" step="any" value={f.min} onChange={(v) => set('min', v)} bad={!limitsOk} />
            <NumInput suffix="to" step="any" value={f.max} onChange={(v) => set('max', v)} bad={!limitsOk} />
            <select value={f.scale} onChange={(e) => set('scale', e.target.value as HardnessScale)} aria-label="Hardness scale">
              {HARDNESS_SCALES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="hir-readings-head">
        <h4>Hardness readings</h4>
        <span className={`badge ${verdict === 'Pass' ? 'b-green' : verdict === 'Fail' ? 'b-red' : 'b-amber'}`}>{verdict}</span>
        <span className="muted">Press Enter to move to the next reading (a new row is added after the last one). Result is worked out from the required range.</span>
      </div>
      {n === 0 ? (
        <div className="muted" style={{ padding: '8px 2px' }}>
          Enter the number of readings to get that many rows.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl compact mini-tbl hir-edit">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Sr. No.</th>
                <th>Required Hardness</th>
                <th style={{ width: 160 }}>Hardness</th>
                <th style={{ width: 110 }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((val, i) => {
                const res = limitsOk ? readingResult(limits, val) : null;
                return (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{limitsOk ? requiredText({ ...limits, scale: f.scale }) : '—'}</td>
                    <td>
                      <input
                        className={`input num ${res === 'Not OK' ? 'bad' : ''}`}
                        data-reading={i}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={reading(i)}
                        autoFocus={i === 0 && !cur}
                        onChange={(e) =>
                          setVals((a) => {
                            const next = a.slice();
                            for (let k = 0; k < n; k++) next[k] ??= '';
                            next[i] = e.target.value;
                            return next;
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusNext(i);
                          }
                        }}
                      />
                    </td>
                    <td>{res ? <Badge status={res} /> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 18, alignItems: 'center', margin: '10px 2px 0' }}>
        <button type="button" className="btn-link" onClick={addRow} disabled={n >= MAX_READINGS}>
          + Add row
        </button>
        {n > 1 && (
          <button type="button" className="btn-link" style={{ color: 'var(--text-3)' }} onClick={removeRow}>
            Remove last row
          </button>
        )}
        <span className="muted" style={{ fontSize: 12.5 }}>
          {n} {n === 1 ? 'reading' : 'readings'}{n >= MAX_READINGS ? ` (maximum ${MAX_READINGS})` : ''}
        </span>
      </div>
      <div className="form-grid" style={{ marginTop: 16 }}>
        <Field label="Remarks" full>
          <textarea value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

// ===================================================== the paper sheet ===
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');

export const HIR_CSS = `
.hir,.hir *{font-weight:800!important}
.hir{background:#fff;color:#000;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:13px;max-width:760px;margin:0 auto}
.hir table{border-collapse:collapse;width:100%}
.hir td,.hir th{border:1.5px solid #243a73;padding:7px 10px;text-align:left;vertical-align:middle}
.hir .brand{display:flex;align-items:center;justify-content:flex-start}
.hir .logo-img{height:52px;max-width:260px;width:auto;object-fit:contain;display:block}
.hir .fmt{font-weight:700;text-align:center}.hir .fmt small{display:block;font-size:11px;margin-top:6px}
.hir .addr{font-size:12px}.hir .title{text-align:center;font-weight:800;letter-spacing:.02em}
.hir .lbl{font-weight:700;width:19%}.hir .val{width:31%;font-weight:600;color:#0f1f6b}
.hir .rd th{text-align:center;font-weight:800}.hir .rd td{text-align:center;height:34px;font-weight:600;color:#0f1f6b}
.hir .rd td.ok{color:#0a7a3d}.hir .rd td.no{color:#c4161c}
.hir .foot td{height:92px;vertical-align:bottom;text-align:right;font-weight:600}
.hir .verdict{margin-top:8px;font-weight:800}.hir .rem{margin-top:6px;font-size:12px;color:#000}
`;

export function sheetHtml(r: HardnessReport) {
  const verdict = hardnessVerdict(r);
  const rows = r.readings
    .map((v, i) => {
      const res = readingResult(r, v);
      return `<tr><td>${i + 1}</td><td>${esc(requiredText(r))}</td><td>${v ?? ''}</td><td class="${res === 'OK' ? 'ok' : res ? 'no' : ''}">${res ?? ''}</td></tr>`;
    })
    .join('');
  const F = HARDNESS_FORM;
  return `<div class="hir">
  <table>
    <tr><td colspan="2" style="width:62%"><div class="brand"><img class="logo-img" src="/everest-logo.png" alt="Everest Auto Forge"/></div></td>
        <td colspan="2" class="fmt">Format No. : ${esc(F.formatNo)}<small>Rev. No. &amp; Dt. : ${esc(F.revision)}</small></td></tr>
    <tr><td colspan="4" class="addr">Factory Address :${esc(F.address)}</td></tr>
    <tr><td colspan="4" class="title">${esc(F.title)}</td></tr>
    <tr><td class="lbl">Component Name :-</td><td class="val">${esc(r.component)}</td><td class="lbl">Inward Qty.</td><td class="val">${r.inwardQty || ''}</td></tr>
    <tr><td class="lbl">Material :-</td><td class="val">${esc(r.material)}${r.grade ? ' · ' + esc(r.grade) : ''}</td><td class="lbl">Inspected Qty. :-</td><td class="val">${r.inspectedQty}</td></tr>
    <tr><td class="lbl">Date :</td><td class="val">${esc(ddmmyyyy(r.date))}</td>${canSee('party_names') ? `<td class="lbl">Supplier Name :-</td><td class="val">${esc(r.supplier)}</td>` : '<td class="lbl"></td><td class="val"></td>'}</tr>
    <tr>${colOk('hardness.cycle_drawing') ? `<td class="lbl">Hardness Cycle No.</td><td class="val">${esc(r.cycleNo)}</td>` : '<td class="lbl"></td><td class="val"></td>'}<td class="lbl">Checked By :-</td><td class="val">${esc(r.checkedBy)}</td></tr>
    ${colOk('hardness.cycle_drawing') ? `<tr><td class="lbl">Drawing No.</td><td class="val" colspan="3">${esc(r.drawingNo)}</td></tr>` : ''}
  </table>
  <table class="rd">
    <tr><th style="width:9%">Sr.No.</th><th>Required Hardness</th><th style="width:24%">Hardness</th><th style="width:22%">Result</th></tr>
    ${rows}
  </table>
  <table class="foot"><tr><td>For, ${esc(F.company)}</td></tr></table>
  <div class="verdict">Overall result: ${verdict === 'Pass' ? 'PASS — all readings within range' : verdict === 'Fail' ? 'FAIL — reading(s) out of range' : 'INCOMPLETE — readings pending'} · Report ${esc(r.id)}${r.jobNo ? ' · Job ' + esc(r.jobNo) : ''}</div>
  ${r.remarks ? `<div class="rem">Remarks: ${esc(r.remarks)}</div>` : ''}
</div>`;
}

