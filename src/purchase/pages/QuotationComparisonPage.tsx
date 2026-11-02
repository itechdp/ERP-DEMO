import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  CheckCircle,
  Plus,
  Printer,
  RefreshCw,
  TrendingDown,
} from 'lucide-react';
import { Conf, Write, useAccess } from '../../auth/access';
import {
  Badge,
  Empty,
  PageHeader,
  Field,
} from '../../components/ui';
import { fmtNum } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { useComparison, usePurchaseRequisitions, useRFQs } from '../hooks/usePurchase';
import { setQuotationStatus } from '../services/quotationService';
import type { SQStatus } from '../types';
import { printPage } from '../../native/native';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;

export function QuotationComparisonPage({
  query,
  navigate,
}: {
  query?: URLSearchParams;
  navigate: (r: string) => void;
}) {
  const prIdParam = Number(query?.get('pr_id')) || undefined;
  const rfqIdParam = Number(query?.get('rfq_id')) || undefined;

  const [activePRId, setActivePRId] = useState<number | undefined>(prIdParam);
  const [activeRFQId, setActiveRFQId] = useState<number | undefined>(rfqIdParam);

  const { requisitions } = usePurchaseRequisitions();
  const { rfqs } = useRFQs();
  const { matrix, loading, error, reload } = useComparison(activePRId, activeRFQId);

  const { user } = useAccess();
  const { toast } = useStore();
  const [acting, setActing] = useState(false);

  const userName = user?.name || user?.email || 'User';

  useEffect(() => {
    if (prIdParam) setActivePRId(prIdParam);
    if (rfqIdParam) setActiveRFQId(rfqIdParam);
  }, [prIdParam, rfqIdParam]);

  const handleStatusChange = async (sqId: number, status: SQStatus) => {
    try {
      setActing(true);
      await setQuotationStatus(sqId, status, userName);
      toast({
        kind: 'success',
        title: 'Status Updated',
        message: `Quotation status updated to ${status}.`,
      });
      void reload();
    } catch (e) {
      toast({ kind: 'error', title: 'Update failed', message: String(e) });
    } finally {
      setActing(false);
    }
  };

  const suppliers = matrix?.suppliers || [];
  const items = matrix?.items || [];

  // Determine global lowest total amount
  const lowestTotal = useMemo(() => {
    const amounts = suppliers.map((s) => s.totalAmount).filter((a) => a > 0);
    return amounts.length ? Math.min(...amounts) : 0;
  }, [suppliers]);

  return (
    <>
      <PageHeader
        eyebrow="Evaluation & Decision Matrix"
        title="Quotation Comparison"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => window.history.back()}>
              <ArrowLeft size={14} /> Back
            </button>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              className="btn btn-subtle"
              onClick={() => void printPage()}
              disabled={suppliers.length === 0}
            >
              <Printer size={14} /> Print Comparison
            </button>
          </>
        }
      />

      {/* Target Selector Card if not set */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-body form-page" style={{ padding: '18px 22px' }}>
         <div className="form-grid">
          <Field label="Compare by Purchase Requisition (PR)">
            <select
              value={activePRId || ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                setActivePRId(val);
                setActiveRFQId(undefined);
              }}
            >
              <option value="">-- Select Requisition --</option>
              {requisitions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.prNo} — {p.department || 'Stores'} ({p.itemCount} items) [{p.status}]
                </option>
              ))}
            </select>
          </Field>

          <Field label="Or compare by Procurement">
            <select
              value={activeRFQId || ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : undefined;
                setActiveRFQId(val);
                setActivePRId(undefined);
              }}
            >
              <option value="">-- Select RFQ --</option>
              {rfqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.rfqNo} {r.prNo ? `(PR: ${r.prNo})` : ''} [{r.status}]
                </option>
              ))}
            </select>
          </Field>
         </div>
        </div>
      </div>

      {!activePRId && !activeRFQId ? (
        <div className="card">
          <Empty
            title="Select a Purchase Requisition or Procurement"
            text="Choose an approved requisition or request for quotation above to view the competitive price comparison matrix."
          />
        </div>
      ) : loading ? (
        <div className="card">
          <div className="card-center-msg">Analyzing and loading quotation comparison matrix…</div>
        </div>
      ) : error ? (
        <div className="card">
          <div className="card-center-msg text-red">{error}</div>
        </div>
      ) : suppliers.length === 0 ? (
        <div className="card">
          <Empty
            title="No quotations received for this requisition"
            text="No suppliers have submitted quotations against this PR or RFQ yet. Enter supplier quotes to see the price comparison."
            action={
              <button
                className="btn btn-primary"
                onClick={() =>
                  navigate(
                    `supplier-quotations?new=1&rfq_id=${activeRFQId || ''}&pr_id=${activePRId || ''}`
                  )
                }
              >
                <Plus size={15} /> Enter Supplier Quotation
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* Supplier Summary Cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fit, minmax(min(280px, 100%), 1fr))`,
              gap: 16,
              marginBottom: 24,
            }}
          >
            {suppliers.map((s) => {
              const isBestOverall = lowestTotal > 0 && s.totalAmount === lowestTotal;
              return (
                <div
                  key={s.sqId}
                  className="card"
                  style={{
                    margin: 0,
                    border: isBestOverall ? '2px solid #10b981' : undefined,
                    boxShadow: isBestOverall ? '0 4px 14px rgba(16, 185, 129, 0.15)' : undefined,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Building2 size={16} className="text-accent" />
                          <h4 style={{ margin: 0 }}>{s.supplierName}</h4>
                        </div>
                        <div className="text-xs muted mono" style={{ marginTop: 2 }}>
                          {s.sqNo}
                        </div>
                      </div>
                      <Badge status={s.status} />
                    </div>

                    {isBestOverall && (
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: 'rgba(16, 185, 129, 0.12)',
                          color: '#10b981',
                          fontWeight: 600,
                          fontSize: 12,
                          marginBottom: 10,
                        }}
                      >
                        <TrendingDown size={14} /> Overall Lowest Quote (L1)
                      </div>
                    )}

                    <Conf g="purchase_rates">
                      <div style={{ marginTop: 6, marginBottom: 14 }}>
                        <div className="text-xs muted">Total Quoted Amount</div>
                        <div className="mono strong" style={{ fontSize: 22, color: isBestOverall ? '#10b981' : 'var(--text-1)' }}>
                          {inr(s.totalAmount)}
                        </div>
                      </div>
                    </Conf>

                    <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div>
                        <span className="muted">Quoted Items: </span>
                        <span className="strong">{s.itemsQuotedCount} / {items.length}</span>
                      </div>
                      <div>
                        <span className="muted">Lead Time: </span>
                        <span>{s.leadDays ? `${s.leadDays} days` : 'Not specified'}</span>
                      </div>
                      <div>
                        <span className="muted">Payment Terms: </span>
                        <span>{s.paymentTerms || '30 Days'}</span>
                      </div>
                      {s.deliveryTerms && (
                        <div>
                          <span className="muted">Delivery: </span>
                          <span>{s.deliveryTerms}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '12px 20px',
                      background: 'var(--surface-2)',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Write res="supplier_quotations">
                        {s.status !== 'Selected' && (
                          <button
                            className="btn btn-xs btn-subtle"
                            style={{ flex: 1 }}
                            onClick={() => handleStatusChange(s.sqId, 'Selected')}
                            disabled={acting}
                          >
                            <CheckCircle size={13} /> Select
                          </button>
                        )}
                        {s.status !== 'Shortlisted' && s.status !== 'Selected' && (
                          <button
                            className="btn btn-xs btn-subtle"
                            style={{ flex: 1 }}
                            onClick={() => handleStatusChange(s.sqId, 'Shortlisted')}
                            disabled={acting}
                          >
                            Shortlist
                          </button>
                        )}
                      </Write>
                    </div>

                    {/* Create PO from this quotation button - Strictly guarded */}
                    <Write res="procurement_po">
                      <button
                        className="btn btn-sm btn-primary"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => navigate(`purchase-orders?new=1&from_sq=${s.sqId}`)}
                      >
                        <Plus size={14} /> Create PO
                      </button>
                    </Write>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Matrix Comparison Table */}
          <div className="card">
            <div className="card-head">
              <h3>Line Item Rate Comparison Matrix ({items.length} items)</h3>
              <div className="right text-xs muted">
                <span className="badge b-green" style={{ marginRight: 6 }}>L1</span> Lowest rate for each item highlighted in green
              </div>
            </div>

            <div className="table-wrap">
              <table className="tbl" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th style={{ minWidth: 200 }}>Item Description &amp; Specs</th>
                    <th className="center" style={{ width: 80 }}>UOM</th>
                    <th className="right" style={{ width: 110 }}>Required Qty</th>
                    {suppliers.map((s) => (
                      <th
                        key={s.sqId}
                        className="right"
                        style={{
                          minWidth: 160,
                          background: lowestTotal > 0 && s.totalAmount === lowestTotal ? 'rgba(16, 185, 129, 0.05)' : undefined,
                        }}
                      >
                        <div className="strong">{s.supplierName}</div>
                        <div className="text-xs muted mono font-normal">{s.sqNo}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.prItemId}>
                      <td className="mono muted">{idx + 1}</td>
                      <td>
                        <div className="strong">{it.item}</div>
                        <div className="text-xs muted">
                          {[it.grade, it.size].filter(Boolean).join(' • ') || 'Standard spec'}
                        </div>
                      </td>
                      <td className="center mono">{it.uom}</td>
                      <td className="right mono strong">{fmtNum(it.requiredQty)}</td>

                      {suppliers.map((s) => {
                        const quote = it.quotes[s.sqId];
                        if (!quote) {
                          return (
                            <td key={s.sqId} className="right muted">
                              —
                            </td>
                          );
                        }

                        const isLowest = quote.isLowest;
                        const lineTotal = quote.rate * it.requiredQty;
                        const pctOver =
                          it.lowestRate && it.lowestRate > 0 && !isLowest
                            ? Math.round(((quote.rate - it.lowestRate) / it.lowestRate) * 100)
                            : 0;

                        return (
                          <td
                            key={s.sqId}
                            className="right mono"
                            style={{
                              background: isLowest ? 'rgba(16, 185, 129, 0.08)' : undefined,
                              borderLeft: isLowest ? '2px solid #10b981' : undefined,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                              {isLowest && (
                                <span className="badge b-green" style={{ padding: '1px 5px', fontSize: 10 }}>
                                  L1
                                </span>
                              )}
                              <span className={isLowest ? 'strong text-green' : ''}>
                                {inr(quote.rate)}
                              </span>
                            </div>
                            <div className="text-xs muted" style={{ marginTop: 2 }}>
                              Total: {inr(lineTotal)}
                              {!isLowest && pctOver > 0 && (
                                <span style={{ color: '#ef4444', marginLeft: 4 }}>
                                  (+{pctOver}%)
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)', fontWeight: 600 }}>
                    <td colSpan={4} className="strong right">
                      Total Quoted Amount:
                    </td>
                    {suppliers.map((s) => {
                      const isBestOverall = lowestTotal > 0 && s.totalAmount === lowestTotal;
                      return (
                        <td
                          key={s.sqId}
                          className="right mono"
                          style={{
                            fontSize: 14,
                            color: isBestOverall ? '#10b981' : 'var(--text-1)',
                            background: isBestOverall ? 'rgba(16, 185, 129, 0.12)' : undefined,
                          }}
                        >
                          <Conf g="purchase_rates">
                            {inr(s.totalAmount)}
                          </Conf>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
