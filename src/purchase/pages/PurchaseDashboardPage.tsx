import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  FileCheck,
  FileText,
  Plus,
  Printer,
  RefreshCw,
  Send,
  ShoppingBag,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Conf, Write, canSee, useAccess } from '../../auth/access';
import { Badge, Kpi, PageHeader, Priority } from '../../components/ui';
import { fmtDate, fmtNum } from '../../components/format';
import { useStore } from '../../store/StoreContext';
import { usePurchaseDashboard } from '../hooks/usePurchase';
import { fetchPayablesKpi } from '../services/invoiceService';
import { decidePO, fetchPODetail } from '../services/poService';
import { printPoWithAttachments } from '../printPo';
import { daysSince } from '../reports/config';

const inr = (v: number) => `₹ ${v.toLocaleString('en-IN')}`;

export function PurchaseDashboardPage({ navigate }: { navigate: (r: string) => void }) {
  const { orders, urgent, kpis, loading, reload } = usePurchaseDashboard();
  const { user, canWrite, canRead } = useAccess();
  // payables figures; stay empty (and the tiles hidden) when invoices are not available to this person or not installed yet
  const [payables, setPayables] = useState<{ outstanding: number; openInvoices: number; overdueInvoices: number; overdueAmount: number } | null>(null);
  useEffect(() => {
    if (!canRead('purchase_invoices')) return;
    fetchPayablesKpi().then(setPayables).catch(() => setPayables(null));
  }, [canRead]);
  const { toast } = useStore();
  const [acting, setActing] = useState(false);

  const pendingApprovals = orders.filter((o) => o.status === 'Approval Pending');
  // late deliveries, worst first; and the urgent / critical orders that are late or due within 3 days (the in-app alert)
  const overdueOrders = orders
    .filter((o) => o.isOverdue)
    .map((o) => ({ o, late: daysSince(o.deliveryDate) }))
    .sort((a, b) => b.late - a.late);
  const dueSoon = (o: { deliveryDate?: string | null; isOverdue?: boolean }) => !o.isOverdue && !!o.deliveryDate && daysSince(o.deliveryDate) >= -3 && daysSince(o.deliveryDate) <= 0;
  const alertCount = urgent.filter((o) => o.isOverdue || dueSoon(o)).length;
  const canApprove = canWrite('purchase_approvals');

  const quickDecide = async (id: number, approve: boolean, poNo: string) => {
    try {
      setActing(true);
      const userName = user?.name || user?.email || 'Plant Head';
      await decidePO(id, approve, approve ? 'Approved via Dashboard' : 'Rejected via Dashboard', userName);
      toast({
        kind: approve ? 'success' : 'info',
        title: approve ? 'PO Approved' : 'PO Returned to Draft',
        message: `${poNo} has been processed.`,
      });
      void reload();
    } catch (e) {
      toast({
        kind: 'error',
        title: 'Action failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Plant Head Overview"
        title="Purchase & Procurement Dashboard"
        actions={
          <>
            <button className="btn btn-subtle" onClick={() => reload()} disabled={loading}>
              <RefreshCw size={14} /> Refresh
            </button>
            <Write res="procurement_po">
              <button className="btn btn-primary" onClick={() => navigate('purchase-orders?new=1')}>
                <Plus size={15} /> New Purchase Order
              </button>
            </Write>
          </>
        }
      />

      {/* KPI Cards */}
      <div className="kpis">
        <Kpi
          label="PRs Pending Approval"
          value={kpis.pendingPRs}
          unit="requisitions"
          hint={kpis.pendingPRs > 0 ? 'Review & approve PRs' : 'No PRs awaiting review'}
          icon={FileText}
          tone={kpis.pendingPRs > 0 ? 'amber' : 'blue'}
          onClick={() => navigate('purchase-requisitions')}
        />
        <Kpi
          label="Open Procurements"
          value={kpis.openRFQs}
          unit="open"
          hint={kpis.openRFQs > 0 ? 'Awaiting supplier quotes' : 'All procurements responded/closed'}
          icon={Send}
          tone={kpis.openRFQs > 0 ? 'teal' : 'blue'}
          onClick={() => navigate('rfqs')}
        />
        <Kpi
          label="Pending PO Approvals"
          value={kpis.pendingApprovals}
          unit="orders"
          hint={kpis.pendingApprovals > 0 ? 'Requires management review' : 'All caught up'}
          icon={Clock}
          tone={kpis.pendingApprovals > 0 ? 'amber' : 'blue'}
          onClick={() => navigate('purchase-orders')}
        />
        <Kpi
          label="Approved (Not Released)"
          value={kpis.approvedNotReleased}
          unit="orders"
          hint="Ready for release to vendor"
          icon={FileCheck}
          tone="blue"
          onClick={() => navigate('purchase-orders')}
        />
        <Kpi
          label="Active Open Orders"
          value={kpis.openOrders}
          unit="orders"
          hint="In process / awaiting delivery"
          icon={ShoppingBag}
          tone="teal"
          onClick={() => navigate('purchase-orders')}
        />
        <Kpi
          label="Overdue Orders"
          value={kpis.overdue}
          unit="orders"
          hint={kpis.overdue > 0 ? 'Passed promised delivery date' : 'No overdue orders'}
          icon={AlertCircle}
          tone={kpis.overdue > 0 ? 'red' : 'blue'}
          onClick={() => navigate('purchase-orders')}
        />
        {payables && (
          <>
            <Kpi
              label="Payables Outstanding"
              value={payables.openInvoices}
              unit="invoices"
              hint={canSee('purchase_rates') ? `₹ ${payables.outstanding.toLocaleString('en-IN', { maximumFractionDigits: 0 })} still to pay` : 'Posted invoices not fully paid'}
              icon={Wallet}
              tone={payables.openInvoices > 0 ? 'amber' : 'blue'}
              onClick={() => navigate('supplier-payables')}
            />
            <Kpi
              label="Invoices Overdue"
              value={payables.overdueInvoices}
              unit="invoices"
              hint={payables.overdueInvoices > 0 ? (canSee('purchase_rates') ? `₹ ${payables.overdueAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} past due date` : 'Past their due date') : 'Nothing past its due date'}
              icon={AlertCircle}
              tone={payables.overdueInvoices > 0 ? 'red' : 'blue'}
              onClick={() => navigate('purchase-invoices')}
            />
          </>
        )}
      </div>

      {alertCount > 0 && (
        <div className="callout warn" style={{ marginTop: 0, marginBottom: 16 }}>
          <AlertTriangle size={16} />
          <div>
            <b>{alertCount} urgent or critical {alertCount === 1 ? 'order is' : 'orders are'}</b> late or due within 3 days. See the list below.
          </div>
        </div>
      )}

      {/* Overdue deliveries: the five latest orders first */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div className="card-title-group">
            <AlertCircle size={18} className={overdueOrders.length > 0 ? 'text-red' : 'muted'} />
            <h3 style={{ margin: 0 }}>Overdue Deliveries</h3>
            {overdueOrders.length > 0 && <span className="badge b-red">{overdueOrders.length} late</span>}
          </div>
          <div className="right">
            {canRead('purchase_reports') && (
              <button className="btn btn-sm btn-subtle" onClick={() => navigate('purchase-reports?r=overdue-po')}>
                Overdue report
              </button>
            )}
          </div>
        </div>
        <div className="card-body" style={{ padding: overdueOrders.length === 0 ? '0 22px 14px' : '0 22px 20px' }}>
          {overdueOrders.length === 0 ? (
            <div className="card-center-msg">No order has passed its delivery date.</div>
          ) : (
            <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>PO Number</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <th style={{ width: 120 }}>Delivery Date</th>
                    <th style={{ width: 110 }} className="r">Days Late</th>
                    <th style={{ width: 95 }} className="r">Pending</th>
                    <th style={{ width: 90 }}>Priority</th>
                    <th className="act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueOrders.slice(0, 5).map(({ o, late }) => (
                    <tr key={o.id}>
                      <td className="strong nowrap">{o.poNo}</td>
                      <Conf g="party_names">
                        <td>{o.supplierName || '—'}</td>
                      </Conf>
                      <td className="nowrap">{o.deliveryDate ? fmtDate(o.deliveryDate) : '—'}</td>
                      <td className="r">
                        <span className="badge b-red">{late} {late === 1 ? 'day' : 'days'}</span>
                      </td>
                      <td className="r num text-amber font-medium">{fmtNum(o.pendingQty || 0)}</td>
                      <td>
                        <Priority p={o.urgency} />
                      </td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button className="icon-btn" title="View PO Details" aria-label={`View PO ${o.poNo}`} onClick={() => navigate(`purchase-orders?id=${o.id}`)}>
                            <Eye size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {overdueOrders.length > 5 && <div className="text-xs muted" style={{ padding: '8px 12px' }}>Showing the 5 latest of {overdueOrders.length}. The rest are in the Overdue report.</div>}
            </div>
          )}
        </div>
      </div>

      {/* Urgent / Critical Open POs Panel */}
      <div className="card" style={{ marginBottom: 20, borderLeft: urgent.length > 0 ? '4px solid #ef4444' : undefined }}>
        <div className="card-head">
          <div className="card-title-group">
            <AlertTriangle size={18} className={urgent.length > 0 ? 'text-red' : 'muted'} />
            <h3 style={{ margin: 0 }}>Urgent &amp; Critical Open Orders</h3>
            {urgent.length > 0 && <span className="badge b-red">{urgent.length} Requires Attention</span>}
          </div>
          <div className="right">
            <button className="btn btn-sm btn-subtle" onClick={() => navigate('purchase-orders')}>
              View All POs
            </button>
          </div>
        </div>

        <div className="card-body" style={{ padding: urgent.length === 0 ? '0 22px 14px' : '0 22px 20px' }}>
          {urgent.length === 0 ? (
            <div className="card-center-msg">
              No critical or urgent purchase orders are currently open.
            </div>
          ) : (
            <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>PO Number</th>
                    <th style={{ width: 90 }}>Priority</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <th style={{ width: 110 }}>Delivery Date</th>
                    <th style={{ width: 95 }} className="r">Ordered</th>
                    <th style={{ width: 95 }} className="r">Pending</th>
                    <Conf g="purchase_rates">
                      <th style={{ width: 120 }} className="r">Total Value</th>
                    </Conf>
                    <th style={{ width: 130 }} className="center">Status</th>
                    <th className="act">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {urgent.map((o) => (
                    <tr key={o.id}>
                      <td className="strong">{o.poNo}</td>
                      <td>
                        <Priority p={o.urgency} />
                      </td>
                      <Conf g="party_names">
                        <td className="strong">{o.supplierName || '—'}</td>
                      </Conf>
                      <td className="nowrap">
                        {o.deliveryDate ? fmtDate(o.deliveryDate) : '—'}
                        {o.isOverdue && <span className="badge b-red text-xs ml-1">Overdue {daysSince(o.deliveryDate)}d</span>}
                        {dueSoon(o) && (
                          <span className="badge b-amber text-xs ml-1">{daysSince(o.deliveryDate) === 0 ? 'Due today' : `Due in ${-daysSince(o.deliveryDate)}d`}</span>
                        )}
                      </td>
                      <td className="r num">{fmtNum(o.orderedQty || 0)}</td>
                      <td className="r num text-amber font-medium">{fmtNum(o.pendingQty || 0)}</td>
                      <Conf g="purchase_rates">
                        <td className="r num strong">{inr(o.totalAmount)}</td>
                      </Conf>
                      <td className="center">
                        <Badge status={o.status} />
                      </td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button
                            className="icon-btn"
                            title="View PO Details"
                            aria-label={`View PO ${o.poNo}`}
                            onClick={() => navigate(`purchase-orders?id=${o.id}`)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="Print Purchase Order"
                            aria-label={`Print PO ${o.poNo}`}
                            onClick={async () => {
                              try {
                                const detail = await fetchPODetail(o.id);
                                await printPoWithAttachments(detail, toast);
                              } catch (e) {
                                toast({ kind: 'error', title: 'Could not load PO for print', message: String(e) });
                              }
                            }}
                          >
                            <Printer size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Pending Approvals Review Section */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div className="card-title-group">
            <Clock size={18} className={pendingApprovals.length > 0 ? 'text-amber' : 'muted'} />
            <h3 style={{ margin: 0 }}>Pending Approval Action Required</h3>
            <span className="chip">{pendingApprovals.length} pending</span>
          </div>
        </div>

        <div className="card-body" style={{ padding: pendingApprovals.length === 0 ? '0 22px 14px' : '0 22px 20px' }}>
          {pendingApprovals.length === 0 ? (
            <div className="card-center-msg">
              All purchase orders are up to date. No pending approvals waiting for review.
            </div>
          ) : (
            <div className="table-wrap" style={{ borderRadius: 8, border: '1px solid var(--border)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>PO Number</th>
                    <th style={{ width: 95 }}>PO Date</th>
                    <Conf g="party_names">
                      <th>Supplier</th>
                    </Conf>
                    <th style={{ width: 90 }}>Priority</th>
                    <Conf g="purchase_rates">
                      <th style={{ width: 120 }} className="r">Amount</th>
                    </Conf>
                    <th>Created By</th>
                    <th className="act">Review / Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingApprovals.map((po) => (
                    <tr key={po.id}>
                      <td className="strong">
                        {po.poNo}
                        {po.revNo > 0 && <span className="chip text-xs ml-1">R{po.revNo}</span>}
                      </td>
                      <td className="nowrap">{fmtDate(po.poDate)}</td>
                      <Conf g="party_names">
                        <td className="strong">{po.supplierName || '—'}</td>
                      </Conf>
                      <td>
                        <Priority p={po.urgency} />
                      </td>
                      <Conf g="purchase_rates">
                        <td className="r num strong">{inr(po.totalAmount)}</td>
                      </Conf>
                      <td>{po.createdBy || 'Purchase Team'}</td>
                      <td className="act nowrap">
                        <div className="icon-actions">
                          <button
                            className="icon-btn"
                            title="Review Details"
                            aria-label={`Review PO ${po.poNo}`}
                            onClick={() => navigate(`purchase-orders?id=${po.id}`)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            className="icon-btn"
                            title="Print Purchase Order"
                            aria-label={`Print PO ${po.poNo}`}
                            onClick={async () => {
                              try {
                                const detail = await fetchPODetail(po.id);
                                await printPoWithAttachments(detail, toast);
                              } catch (e) {
                                toast({ kind: 'error', title: 'Could not load PO for print', message: String(e) });
                              }
                            }}
                          >
                            <Printer size={16} />
                          </button>
                          {canApprove && (
                            <>
                              <button
                                className="icon-btn text-good"
                                title="Approve PO"
                                aria-label={`Approve PO ${po.poNo}`}
                                onClick={() => quickDecide(po.id, true, po.poNo)}
                                disabled={acting}
                              >
                                <CheckCircle size={16} />
                              </button>
                              <button
                                className="icon-btn danger"
                                title="Reject to Draft"
                                aria-label={`Reject PO ${po.poNo}`}
                                onClick={() => quickDecide(po.id, false, po.poNo)}
                                disabled={acting}
                              >
                                <XCircle size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
