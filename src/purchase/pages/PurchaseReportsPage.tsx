import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { useAccess } from '../../auth/access';
import { Badge, Empty, Field, FilterMenu, PageHeader, Search, Tabs } from '../../components/ui';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { fetchReportRows } from '../services/receiptService';
import { REPORT_BY_ID, REPORT_GROUPS, REPORTS, type ReportCol, type ReportDef } from '../reports/config';
import { downloadXlsx } from '../../export/xlsx';
import { printReport } from '../reports/print';
import { usePaged } from '../../components/Pager';

type Row = Record<string, unknown>;

const s = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);
const money = (v: unknown) => (v == null || v === '' ? '—' : '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** Text shown for one cell (also used for search and print). */
function show(c: ReportCol, v: unknown): string {
  if (v == null || v === '') return '—';
  switch (c.kind) {
    case 'date':
      return fmtDate(s(v).slice(0, 10));
    case 'money':
      return money(v);
    case 'pct':
      return `${Number(v)}%`;
    case 'num':
      return Number.isInteger(Number(v)) ? fmtNum(Number(v)) : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    default:
      return s(v);
  }
}

const distinct = (rows: Row[], key?: string) => (key ? [...new Set(rows.map((r) => s(r[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : []);

export function PurchaseReportsPage({ query, navigate }: { query?: URLSearchParams; navigate: (r: string) => void }) {
  const { can, canRead, user } = useAccess();
  const { toast } = useStore();

  // a report tied to another page (Supplier Performance) is offered only to roles that may open that page
  const offered = REPORTS.filter((r) => !r.resource || canRead(r.resource));
  const [reportId, setReportId] = useState(() => (query?.get('r') && REPORT_BY_ID[query.get('r')!] && offered.some((r) => r.id === query.get('r')) ? query.get('r')! : 'po-register'));
  const def: ReportDef = REPORT_BY_ID[reportId];

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplier, setSupplier] = useState('');
  const [material, setMaterial] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [urgency, setUrgency] = useState('');

  const load = async (d: ReportDef) => {
    setLoading(true);
    try {
      setRows(await fetchReportRows(d.view));
      setError(null);
    } catch (e) {
      setRows([]);
      setError('This report could not be loaded right now.');
      void e;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setQ('');
    setFrom('');
    setTo('');
    setSupplier('');
    setMaterial('');
    setGrade('');
    setStatus('');
    setUrgency('');
    void load(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  const cols = useMemo(() => def.cols.filter((c) => !c.secret || can(c.secret)), [def, can]);

  // rows the report is about, before the user's filters (they feed the filter dropdowns)
  const scope = useMemo(() => rows.filter((r) => !def.where || def.where(r)), [rows, def]);

  const result = useMemo(() => {
    let r = scope;
    if (def.dateKey && from) r = r.filter((x) => s(x[def.dateKey!]).slice(0, 10) >= from);
    if (def.dateKey && to) r = r.filter((x) => s(x[def.dateKey!]).slice(0, 10) <= to);
    if (def.supplierKey && supplier) r = r.filter((x) => s(x[def.supplierKey!]) === supplier);
    if (def.materialKey && material) r = r.filter((x) => s(x[def.materialKey!]) === material);
    if (def.gradeKey && grade) r = r.filter((x) => s(x[def.gradeKey!]) === grade);
    if (def.statusKey && status) r = r.filter((x) => s(x[def.statusKey!]) === status);
    if (def.urgencyKey && urgency) r = r.filter((x) => s(x[def.urgencyKey!]) === urgency);
    if (def.transform) r = def.transform(r);
    if (def.sort) {
      const { key, asc } = def.sort;
      r = [...r].sort((a, b) => {
        const x = a[key];
        const y = b[key];
        const c = typeof x === 'number' || typeof y === 'number' ? num(x) - num(y) : s(x).localeCompare(s(y));
        return asc ? c : -c;
      });
    }
    if (q.trim()) r = r.filter((x) => matches(q, ...cols.map((c) => show(c, x[c.key]))));
    return r;
  }, [scope, def, from, to, supplier, material, grade, status, urgency, q, cols]);
  const pg = usePaged(result, result.length);

  const totals = useMemo(() => {
    if (!cols.some((c) => c.total) || result.length === 0) return null;
    const t: Row = {};
    for (const c of cols) if (c.total) t[c.key] = result.reduce((a, r) => a + num(r[c.key]), 0);
    return t;
  }, [cols, result]);

  const groups = [
    def.supplierKey && can('party_names') && { label: 'Supplier', value: supplier, onChange: setSupplier, options: [{ value: '', label: 'All suppliers' }, ...distinct(scope, def.supplierKey).map((v) => ({ value: v, label: v }))] },
    def.materialKey && { label: 'Material', value: material, onChange: setMaterial, options: [{ value: '', label: 'All materials' }, ...distinct(scope, def.materialKey).map((v) => ({ value: v, label: v }))] },
    def.gradeKey && { label: 'Grade', value: grade, onChange: setGrade, options: [{ value: '', label: 'All grades' }, ...distinct(scope, def.gradeKey).map((v) => ({ value: v, label: v }))] },
    def.statusKey && { label: 'Status', value: status, onChange: setStatus, options: [{ value: '', label: 'All statuses' }, ...distinct(scope, def.statusKey).map((v) => ({ value: v, label: v }))] },
    def.urgencyKey && { label: 'Urgency', value: urgency, onChange: setUrgency, options: [{ value: '', label: 'All urgencies' }, ...['Normal', 'Urgent', 'Critical'].map((v) => ({ value: v, label: v }))] },
  ].filter(Boolean) as Parameters<typeof FilterMenu>[0]['groups'];

  const exportExcel = () => {
    if (result.length === 0) return toast({ kind: 'info', title: 'Nothing to export', message: 'This report has no rows for the current filters.' });
    void downloadXlsx(`${def.id}-${new Date().toISOString().slice(0, 10)}`, def.title ?? def.id, cols, result, totals, user?.name || user?.email || '');
  };

  const print = () => {
    if (result.length === 0) return toast({ kind: 'info', title: 'Nothing to print', message: 'This report has no rows for the current filters.' });
    const set = (label: string, v: string): [string, string][] => (v ? [[label, v]] : []);
    printReport({
      title: def.title,
      group: def.group,
      cols,
      rows: result,
      totals,
      show,
      filters: [
        ...set('From', from ? fmtDate(from) : ''),
        ...set('To', to ? fmtDate(to) : ''),
        ...set('Supplier', supplier),
        ...set('Material', material),
        ...set('Grade', grade),
        ...set('Status', status),
        ...set('Urgency', urgency),
        ...set('Search', q.trim()),
      ],
      printedBy: user?.name || user?.email || '',
      note: def.note,
    });
  };

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Purchase Reports"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => load(def)} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="btn btn-subtle" onClick={print} disabled={loading}>
              <Printer size={14} /> Print / PDF
            </button>
            <button className="btn btn-primary" onClick={exportExcel} disabled={loading}>
              <Download size={14} /> Export Excel
            </button>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: '16px 22px 18px' }}>
          <Tabs
            value={def.group}
            onChange={(g) => {
              const first = offered.find((r) => r.group === g);
              if (first) setReportId(first.id);
            }}
            items={REPORT_GROUPS.filter((g) => offered.some((r) => r.group === g)).map((g) => ({ value: g, label: g, count: offered.filter((r) => r.group === g).length }))}
          />
          <div className="rp-pills">
            {offered
              .filter((r) => r.group === def.group)
              .map((r) => (
                <button key={r.id} className={`btn btn-sm ${r.id === reportId ? 'btn-primary' : 'btn-subtle'}`} onClick={() => setReportId(r.id)}>
                  {r.title}
                </button>
              ))}
          </div>
          {def.dateKey && (
            <div className="rp-dates">
              <Field label="From date">
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To date">
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder={`Search ${def.title.toLowerCase()}…`} />
            {groups.length > 0 && <FilterMenu groups={groups} />}
          </div>
          <div className="right text-xs muted">
            {result.length} {result.length === 1 ? 'row' : 'rows'}
          </div>
        </div>
        {def.note && <div className="text-xs muted" style={{ padding: '0 22px 10px' }}>{def.note}</div>}

        {loading ? (
          <div className="card-center-msg">Loading report…</div>
        ) : error ? (
          <Empty title="Report not available" text={error} action={<button className="btn" onClick={() => load(def)}>Try again</button>} />
        ) : result.length === 0 ? (
          <Empty title="No rows" text={rows.length === 0 ? 'There is nothing to report on yet.' : 'No rows match the filters.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c.key} className={c.kind === 'num' || c.kind === 'money' || c.kind === 'pct' ? 'r' : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c.key} className={c.kind === 'num' || c.kind === 'money' || c.kind === 'pct' ? 'r num nowrap' : c.kind === 'date' ? 'nowrap' : undefined}>
                        {c.kind === 'badge' && r[c.key] ? <Badge status={s(r[c.key])} /> : show(c, r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
                {totals && (
                  <tr className="total-row">
                    {cols.map((c, i) => (
                      <td key={c.key} className={c.total ? 'r num strong nowrap' : 'strong'}>
                        {i === 0 ? 'Total' : c.total ? show(c, totals[c.key]) : ''}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {pg.pager}
          </div>
        )}
      </div>
      {canRead('supplier_performance') && (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-subtle" onClick={() => navigate('supplier-performance')}>
            Open Supplier Performance
          </button>
        </div>
      )}
    </>
  );
}
