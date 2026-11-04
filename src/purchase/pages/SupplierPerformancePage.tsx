import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, RefreshCw, X } from 'lucide-react';
import { Conf, canSee, useAccess } from '../../auth/access';
import { Badge, Empty, OverlayHost, PageHeader, Search } from '../../components/ui';
import { fmtDate, fmtNum, matches } from '../../components/format';
import { fetchSupplierPerformance, fetchSupplierPOs } from '../services/receiptService';
import type { SupplierPerformance } from '../types';
import { BAND_BADGE, SCORE_TIP, SCORE_WEIGHTS, band, partScores, shortagePct, supplierScore, THRESHOLDS } from '../reports/scoring';
import { usePaged } from '../../components/Pager';

type Row = Record<string, unknown>;
type SortKey = 'name' | 'poCount' | 'totalPurchaseValue' | 'onTimePct' | 'qualityPct' | 'rejectionPct' | 'priceIndex' | 'shortage' | 'avgResponseHrs' | 'score';

const inr = (v: number) => '₹ ' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);

function Pill({ tone, children }: { tone: keyof typeof BAND_BADGE; children: React.ReactNode }) {
  return <span className={`badge ${BAND_BADGE[tone]}`}>{children}</span>;
}

export function SupplierPerformancePage({ navigate }: { navigate: (r: string) => void }) {
  const [rows, setRows] = useState<SupplierPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'score', asc: false });
  const [open, setOpen] = useState<SupplierPerformance | null>(null);
  const showParty = canSee('party_names');
  const { canRead } = useAccess();

  const load = async () => {
    setLoading(true);
    try {
      setRows(await fetchSupplierPerformance());
      setError(null);
    } catch {
      setRows([]);
      setError('Supplier performance could not be loaded right now.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const scored = useMemo(() => rows.map((r) => ({ ...r, score: supplierScore(r) })), [rows]);

  const shown = useMemo(() => {
    const val = (r: (typeof scored)[number]): number | string => {
      const v = r[sort.key as keyof typeof r];
      return v == null ? (sort.asc ? Infinity : -Infinity) : (v as number | string);
    };
    return scored
      .filter((r) => matches(q, showParty ? r.name : '', r.code, r.paymentTerms))
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const c = typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number);
        return sort.asc ? c : -c;
      });
  }, [scored, q, sort, showParty]);
  const pg = usePaged(shown, shown.length);

  const th = (key: SortKey, label: string, right = true, tip?: string) => (
    <th className={right ? 'r' : undefined} title={tip}>
      <button className="link-btn" style={{ color: 'inherit', font: 'inherit', textTransform: 'inherit', letterSpacing: 'inherit' }} onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : false }))}>
        {label}
        {sort.key === key && (sort.asc ? <ArrowUp size={12} style={{ marginLeft: 4 }} /> : <ArrowDown size={12} style={{ marginLeft: 4 }} />)}
      </button>
    </th>
  );

  return (
    <>
      <PageHeader
        eyebrow="Purchase & Procurement"
        title="Supplier Performance"
        actions={
          <>
            <button className="btn btn-subtle" onClick={load} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            {canRead('purchase_reports') && (
              <button className="btn btn-subtle" onClick={() => navigate('purchase-reports?r=supplier-performance')}>
                Open as report
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="card-head">
          <div className="table-search-row">
            <Search value={q} onChange={setQ} placeholder="Search supplier…" />
          </div>
          <div className="right text-xs muted">{shown.length} suppliers</div>
        </div>

        {loading ? (
          <div className="card-center-msg">Loading supplier performance…</div>
        ) : error ? (
          <Empty title="Not available" text={error} action={<button className="btn" onClick={load}>Try again</button>} />
        ) : shown.length === 0 ? (
          <Empty title="No suppliers to show" text={rows.length === 0 ? 'Suppliers appear here once they exist in the Supplier Master.' : 'No supplier matches your search.'} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  {showParty ? th('name', 'Supplier', false) : <th>Supplier</th>}
                  {th('poCount', 'POs')}
                  <Conf g="purchase_rates">{th('totalPurchaseValue', 'Purchase Value')}</Conf>
                  {th('onTimePct', 'On-time', true, 'POs fully received on or before the delivery date, out of POs whose date has come')}
                  {th('qualityPct', 'Accepted', true, 'Accepted weight ÷ weight that has had incoming QC')}
                  {th('rejectionPct', 'Rejected', true, 'Rejected weight ÷ weight that has had incoming QC')}
                  {th('priceIndex', 'Price Index', true, 'Rate ÷ lowest rate paid for the same item and grade in the last 12 months; 1.00 is best')}
                  {th('shortage', 'Shortage', true, 'Quantity ordered but not received on closed or past-due lines')}
                  {th('avgResponseHrs', 'Response', true, 'Average hours from RFQ sent to quotation received')}
                  {th('score', 'Score', true, SCORE_TIP)}
                  <th className="act">View</th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((r) => {
                  const sh = shortagePct(r);
                  return (
                    <tr key={r.supplierId}>
                      <td className="strong">
                        {showParty ? r.name : '—'}
                        <div className="text-xs muted">{r.code}</div>
                      </td>
                      <td className="r num">{fmtNum(r.poCount)}</td>
                      <Conf g="purchase_rates">
                        <td className="r num nowrap">{inr(r.totalPurchaseValue)}</td>
                      </Conf>
                      <td className="r">
                        <Pill tone={band('onTimePct', r.onTimePct)}>{pct(r.onTimePct)}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('qualityPct', r.qualityPct)}>{pct(r.qualityPct)}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('rejectionPct', r.rejectionPct)}>{pct(r.rejectionPct)}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('priceIndex', r.priceIndex)}>{r.priceIndex == null ? '—' : r.priceIndex.toFixed(2)}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('shortagePct', sh)}>{r.shortage > 0 ? fmtNum(r.shortage) : sh == null ? '—' : '0'}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('responseHrs', r.avgResponseHrs)}>{r.avgResponseHrs == null ? '—' : r.avgResponseHrs < 1 ? '< 1 h' : `${r.avgResponseHrs} h`}</Pill>
                      </td>
                      <td className="r">
                        <Pill tone={band('score', r.score)}>{r.score == null ? '—' : r.score}</Pill>
                      </td>
                      <td className="act">
                        <div className="icon-actions">
                          <button className="icon-btn" title="Scorecard" aria-label={`Scorecard ${r.name}`} onClick={() => setOpen(r)}>
                            <Eye size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pg.pager}
          </div>
        )}
      </div>

      <div className="text-xs muted" style={{ marginTop: 12, lineHeight: 1.6 }}>
        Colours: on-time {THRESHOLDS.onTimePct.good}%+ good, {THRESHOLDS.onTimePct.warn}–{THRESHOLDS.onTimePct.good}% watch, below {THRESHOLDS.onTimePct.warn}% poor · accepted {THRESHOLDS.qualityPct.good}%+ good · rejected up to {THRESHOLDS.rejectionPct.good}% good ·
        price index up to {THRESHOLDS.priceIndex.good} good · response up to {THRESHOLDS.responseHrs.good} h good. A dash means there is nothing to judge yet. The score appears once a supplier has delivery or quality history.
      </div>

      {open && <Scorecard s={{ ...open, score: supplierScore(open) }} onClose={() => setOpen(null)} navigate={navigate} showParty={showParty} />}
    </>
  );
}

function Scorecard({ s, onClose, navigate, showParty }: { s: SupplierPerformance & { score: number | null }; onClose: () => void; navigate: (r: string) => void; showParty: boolean }) {
  const [pos, setPos] = useState<Row[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSupplierPOs(s.supplierId)
      .then((r) => alive && setPos(r))
      .catch(() => alive && setPos([]));
    return () => {
      alive = false;
    };
  }, [s.supplierId]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const parts = partScores(s);
  const line = (label: string, weight: number, part: number | null, text: string) => (
    <tr>
      <td>{label}</td>
      <td className="r muted">{weight}</td>
      <td className="r">{text}</td>
      <td className="r strong">{part == null ? '—' : Math.round(part)}</td>
    </tr>
  );

  return (
    <OverlayHost>
      <div className="drawer-overlay" onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-label="Supplier scorecard">
        <div className="drawer-head">
          <div className="row">
            <div>
              <div className="k">Supplier scorecard</div>
              <h2 style={{ fontFamily: 'inherit', fontSize: 22 }}>{showParty ? s.name : s.code}</h2>
              <div className="prod">
                {s.code}
                {s.paymentTerms ? ` · ${s.paymentTerms}` : ''}
              </div>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="drawer-body">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 34, fontWeight: 700 }}>{s.score ?? '—'}</span>
            <span className="muted" title={SCORE_TIP}>
              overall score out of 100
            </span>
          </div>

          <table className="tbl" style={{ marginBottom: 20 }}>
            <thead>
              <tr>
                <th>Measure</th>
                <th className="r">Weight</th>
                <th className="r">Result</th>
                <th className="r">Points</th>
              </tr>
            </thead>
            <tbody>
              {line('On-time delivery', SCORE_WEIGHTS.onTime, parts.onTime, s.onTimeCount + s.lateCount > 0 ? `${s.onTimePct}% (${s.onTimeCount} on time, ${s.lateCount} late)` : 'nothing due yet')}
              {line('Quality acceptance', SCORE_WEIGHTS.quality, parts.quality, s.qualityPct == null ? 'no QC yet' : `${s.qualityPct}% accepted, ${s.rejectionPct}% rejected`)}
              {line('Price competitiveness', SCORE_WEIGHTS.price, parts.price, s.priceIndex == null ? 'no orders in 12 months' : `index ${s.priceIndex.toFixed(2)}`)}
              {line('Response time', SCORE_WEIGHTS.response, parts.response, s.avgResponseHrs == null ? 'no RFQ replies' : `${s.avgResponseHrs} h average`)}
              {line('Quantity shortage', SCORE_WEIGHTS.shortage, parts.shortage, s.shortageBase > 0 ? `${fmtNum(s.shortage)} of ${fmtNum(s.shortageBase)} short` : 'nothing judged yet')}
            </tbody>
          </table>

          <h4 style={{ margin: '0 0 8px' }}>Recent purchase orders</h4>
          {pos == null ? (
            <div className="muted">Loading…</div>
          ) : pos.length === 0 ? (
            <div className="muted">No purchase orders for this supplier yet.</div>
          ) : (
            <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>PO</th>
                  <th>Delivery</th>
                  <th className="r">Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={String(p.id)}>
                    <td className="strong nowrap">
                      <button className="link-btn" onClick={() => navigate(`purchase-orders?id=${p.id}`)}>
                        {String(p.po_no)}
                      </button>
                    </td>
                    <td className="nowrap">
                      {p.delivery_date ? fmtDate(String(p.delivery_date)) : '—'}
                      {p.is_overdue === true && <span className="badge b-red text-xs ml-1">Overdue</span>}
                    </td>
                    <td className="r num">
                      {fmtNum(Number(p.received_qty || 0))} / {fmtNum(Number(p.ordered_qty || 0))}
                    </td>
                    <td>
                      <Badge status={String(p.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </aside>
    </OverlayHost>
  );
}
