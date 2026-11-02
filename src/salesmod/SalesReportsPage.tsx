import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { useAccess } from '../auth/access';
import { Badge, Empty, Field, FilterMenu, PageHeader, Search, Tabs } from '../components/ui';
import { fmtDate, fmtNum, matches } from '../components/format';
import { useStore } from '../store/StoreContext';
import { downloadXlsx } from '../export/xlsx';
import { printReport } from '../purchase/reports/print';
import { fetchItems, fetchPriceHistory, fetchQuotations } from './service';
import { REPORT_BY_ID, REPORT_GROUPS, SALES_REPORTS, type Row, type SalesCol, type SalesReportDef, type Source } from './reports';

const s = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v) || 0);

function show(c: SalesCol, v: unknown): string {
  if (v == null || v === '') return '—';
  switch (c.kind) {
    case 'date': return fmtDate(s(v).slice(0, 10));
    case 'money': return '₹ ' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    case 'pct': return `${Number(v)}%`;
    case 'num': return Number.isInteger(Number(v)) ? fmtNum(Number(v)) : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    default: return s(v);
  }
}

/** rounds a chart maximum up to 1, 2, 2.5, 5 or 10 times a power of ten, so the grid lines land on tidy numbers */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
const axisMoney = (v: number) => (v >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : v >= 1e3 ? `₹${+(v / 1e3).toFixed(1)} K` : `₹${v}`);

/** monthly bars in a bordered panel: all quotations of the month (light) with the part that was won on top (green) */
function MonthlyChart({ rows, money }: { rows: Row[]; money: boolean }) {
  if (rows.length === 0) return null;
  const key = money ? 'amount' : 'quotations';
  const wonKey = money ? 'won_value' : 'won';
  const top = niceMax(Math.max(...rows.map((r) => num(r[key]))));
  const W = 1000, H = 300, L = 78, R = 16, T = 18, B = 40;
  const plotH = H - T - B;
  const slot = (W - L - R) / rows.length;
  const bw = Math.min(90, slot * 0.5);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const fmt = (v: number) => (money ? axisMoney(v) : String(Math.round(v)));
  const y = (v: number) => T + plotH - (v / top) * plotH;
  return (
    <div style={{ margin: '0 22px 18px', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px 8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        <div className="strong">{money ? 'Quotation value by month' : 'Quotations by month'}</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }} className="muted">
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#9ccfce', marginRight: 6 }} />All quotations</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: '#16a34a', marginRight: 6 }} />Won</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Monthly quotations chart" style={{ display: 'block', maxHeight: 340 }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '4 4'} />
            <text x={L - 10} y={y(t) + 4} fontSize="12" textAnchor="end" fill="var(--text-3)">{fmt(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const total = num(r[key]);
          const won = Math.min(total, num(r[wonKey]));
          const x = L + i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              <rect x={x} y={y(total)} width={bw} height={Math.max(0, y(0) - y(total))} rx={4} fill="#9ccfce" />
              {won > 0 && <rect x={x} y={y(won)} width={bw} height={Math.max(0, y(0) - y(won))} rx={4} fill="#16a34a" />}
              <text x={x + bw / 2} y={y(total) - 6} fontSize="12" fontWeight="600" textAnchor="middle" fill="var(--text)">{fmt(total)}</text>
              <text x={x + bw / 2} y={H - 14} fontSize="12.5" textAnchor="middle" fill="var(--text-2)">{s(r.month)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SalesReportsPage({ query }: { query?: URLSearchParams }) {
  const { can, user } = useAccess();
  const { toast } = useStore();
  const offered = useMemo(() => SALES_REPORTS.filter((r) => (r.needs ?? []).every((g) => can(g))), [can]);
  const first = query?.get('r');
  const [reportId, setReportId] = useState(() => (first && offered.some((r) => r.id === first) ? first : offered[0]?.id ?? 'quotation-summary'));
  const def: SalesReportDef = REPORT_BY_ID[reportId] ?? offered[0];

  const [src, setSrc] = useState<Source>({ q: [], items: [], history: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [customer, setCustomer] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [product, setProduct] = useState('');
  const [status, setStatus] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [qs, items, history] = await Promise.all([fetchQuotations(), fetchItems(), can('sales_rates') ? fetchPriceHistory().catch(() => []) : Promise.resolve([])]);
      setSrc({ q: qs, items, history });
      setError(null);
    } catch (e) {
      setSrc({ q: [], items: [], history: [] });
      setError(e instanceof Error ? e.message : 'The reports could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customers = useMemo(() => [...new Set([...src.q.map((x) => x.customer), ...src.history.map((x) => x.customer)].filter(Boolean))].sort(), [src]);
  const salespeople = useMemo(() => [...new Set(src.q.map((x) => x.salesperson).filter(Boolean))].sort(), [src]);
  const products = useMemo(() => [...new Set(src.items.map((x) => x.product).filter(Boolean))].sort(), [src]);
  const statuses = useMemo(() => [...new Set(src.q.map((x) => x.displayStatus))].sort(), [src]);

  /** the filters, applied to the source the report reads */
  const filtered: Source = useMemo(() => {
    const date = (d: string) => (!from || d.slice(0, 10) >= from) && (!to || d.slice(0, 10) <= to);
    const inQ = (x: Source['q'][number]) => date(x.qtDate) && (!customer || x.customer === customer) && (!salesperson || x.salesperson === salesperson)
      && (!status || x.displayStatus === status) && (!product || x.products.split(', ').includes(product));
    const qIds = new Set(src.q.filter(inQ).map((x) => x.id));
    return {
      q: src.q.filter(inQ),
      items: src.items.filter((i) => qIds.has(i.quotationId) && (!product || i.product === product)),
      history: src.history.filter((h) => date(h.qtDate) && (!customer || h.customer === customer) && (!product || h.product === product)),
    };
  }, [src, from, to, customer, salesperson, product, status]);

  const cols = useMemo(() => def.cols.filter((c) => !c.secret || can(c.secret)), [def, can]);
  const built = useMemo(() => def.build(filtered), [def, filtered]);
  const result = useMemo(() => (q.trim() ? built.filter((r) => matches(q, ...cols.map((c) => show(c, r[c.key])))) : built), [built, q, cols]);
  const totals = useMemo(() => {
    if (!cols.some((c) => c.total) || result.length === 0) return null;
    const t: Row = {};
    for (const c of cols) if (c.total) t[c.key] = result.reduce((a, r) => a + num(r[c.key]), 0);
    return t;
  }, [cols, result]);

  const pick = (g: string) => {
    const f = offered.find((r) => r.group === g);
    if (f) {
      setReportId(f.id);
      setQ('');
    }
  };

  const groups = [
    can('party_names') && { label: 'Customer', value: customer, onChange: setCustomer, options: [{ value: '', label: 'All customers' }, ...customers.map((v) => ({ value: v, label: v }))] },
    def.uses !== 'history' && { label: 'Salesperson', value: salesperson, onChange: setSalesperson, options: [{ value: '', label: 'All salespeople' }, ...salespeople.map((v) => ({ value: v, label: v }))] },
    { label: 'Product', value: product, onChange: setProduct, options: [{ value: '', label: 'All products' }, ...products.map((v) => ({ value: v, label: v }))] },
    def.uses !== 'history' && { label: 'Status', value: status, onChange: setStatus, options: [{ value: '', label: 'All statuses' }, ...statuses.map((v) => ({ value: v, label: v }))] },
  ].filter(Boolean) as Parameters<typeof FilterMenu>[0]['groups'];

  const exportExcel = () => {
    if (result.length === 0) return toast({ kind: 'info', title: 'Nothing to export', message: 'This report has no rows for the current filters.' });
    void downloadXlsx(`${def.id}-${new Date().toISOString().slice(0, 10)}`, def.title, cols, result, totals, user?.name || user?.email || '');
  };
  const print = () => {
    if (result.length === 0) return toast({ kind: 'info', title: 'Nothing to print', message: 'This report has no rows for the current filters.' });
    const set = (label: string, v: string): [string, string][] => (v ? [[label, v]] : []);
    printReport({
      title: def.title, group: def.group, cols, rows: result, totals, show: show as never, heading: 'SALES REPORT',
      filters: [...set('From', from ? fmtDate(from) : ''), ...set('To', to ? fmtDate(to) : ''), ...set('Customer', customer), ...set('Salesperson', salesperson), ...set('Product', product), ...set('Status', status), ...set('Search', q.trim())],
      printedBy: user?.name || user?.email || '', note: def.note,
    });
  };

  if (!def) return <div className="card"><Empty title="No reports available" text="Ask the Director for access." /></div>;

  return (
    <>
      <PageHeader
        eyebrow="Sales & Orders"
        title="Sales Reports"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => load()} disabled={loading}><RefreshCw size={14} /> Refresh</button>
            <button className="btn btn-subtle" onClick={print} disabled={loading}><Printer size={14} /> Print / PDF</button>
            <button className="btn btn-primary" onClick={exportExcel} disabled={loading}><Download size={14} /> Export Excel</button>
          </>
        }
      />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: '16px 22px 18px' }}>
          <Tabs value={def.group} onChange={pick} items={REPORT_GROUPS.filter((g) => offered.some((r) => r.group === g)).map((g) => ({ value: g, label: g, count: offered.filter((r) => r.group === g).length }))} />
          <div className="rp-pills">
            {offered.filter((r) => r.group === def.group).map((r) => (
              <button key={r.id} className={`btn btn-sm ${r.id === reportId ? 'btn-primary' : 'btn-subtle'}`} onClick={() => { setReportId(r.id); setQ(''); }}>{r.title}</button>
            ))}
          </div>
          <div className="rp-dates">
            <Field label="From date"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To date"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder={`Search ${def.title.toLowerCase()}, or a quotation no…`} />
            <FilterMenu groups={groups} />
          </div>
          <div className="right text-xs muted">{result.length} {result.length === 1 ? 'row' : 'rows'}</div>
        </div>
        {def.note && <div className="text-xs muted" style={{ padding: '0 22px 10px' }}>{def.note}</div>}
        {def.chart === 'monthly' && !loading && <MonthlyChart rows={result} money={can('sales_rates')} />}
        {loading ? (
          <div className="card-center-msg">Loading report…</div>
        ) : error ? (
          <Empty title="Report not available" text={error} action={<button className="btn" onClick={() => load()}>Try again</button>} />
        ) : result.length === 0 ? (
          <Empty title="No rows" text={src.q.length === 0 ? 'There is nothing to report on yet.' : 'No rows match the filters.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>{cols.map((c) => <th key={c.key} className={c.kind === 'num' || c.kind === 'money' || c.kind === 'pct' ? 'r' : undefined}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {result.map((r, i) => (
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
                    {cols.map((c, i) => <td key={c.key} className={c.total ? 'r num strong nowrap' : 'strong'}>{i === 0 ? 'Total' : c.total ? show(c, totals[c.key]) : ''}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
