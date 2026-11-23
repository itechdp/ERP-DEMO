import { useMemo } from 'react';
import { ClipboardList, Send } from 'lucide-react';
import { canSee, useAccess, Write } from '../auth/access';
import { useStore } from '../store/StoreContext';
import { useOrders } from '../salesmod/hooks';
import { Badge, go } from '../components/ui';
import { fmtDate, fmtNum, todayISO } from '../components/format';

const SHOWN = 8;

/**
 * Dashboard → Pending Sales Orders: the orders still waiting for production (Confirmed, or In Production with more to make),
 * soonest delivery first. "Send to Production" opens Workflow → Cutting → New Job Card with the order already chosen.
 * Only for people who may see Sales Orders; the button only for those who may create job cards (Write on Cutting).
 */
export function PendingOrders() {
  const { canRead } = useAccess();
  if (!canRead('sales_orders')) return null;
  return <PendingOrdersCard />;
}

function PendingOrdersCard() {
  const { state, openAction } = useStore();
  const { orders, loading, error } = useOrders();
  const party = canSee('party_names');
  const today = todayISO();

  const pending = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'Confirmed' || o.status === 'In Production')
        .sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999') || a.soNo.localeCompare(b.soNo)),
    [orders],
  );
  // job cards already made for each order
  const jobsOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of state.jobs) if (j.salesOrderNo) m.set(j.salesOrderNo, (m.get(j.salesOrderNo) ?? 0) + 1);
    return m;
  }, [state.jobs]);

  return (
    <div className="card mb-lg">
      <div className="card-head">
        <div>
          <h3>Pending Sales Orders</h3>
          <div className="text-xs muted">Orders waiting for production — soonest delivery first</div>
        </div>
        <div className="right">
          {pending.length > 0 && <span className="chip">{fmtNum(pending.length)} pending</span>}
          <button className="btn btn-subtle btn-sm" onClick={() => go('sales-order')}>
            All orders
          </button>
        </div>
      </div>
      {loading && !orders.length ? (
        <div className="card-center-msg">Loading orders…</div>
      ) : error ? (
        <div className="card-center-msg">{error}</div>
      ) : pending.length === 0 ? (
        <div className="card-center-msg">
          <ClipboardList size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          No sales orders are waiting for production.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Sales Order</th>
                {party && <th>Customer</th>}
                <th>Products</th>
                <th className="r">Qty</th>
                <th>Delivery</th>
                <th>Status</th>
                <th className="act" />
              </tr>
            </thead>
            <tbody>
              {pending.slice(0, SHOWN).map((o) => {
                const late = !!o.deliveryDate && o.deliveryDate < today;
                const jobs = jobsOf.get(o.soNo) ?? 0;
                return (
                  <tr key={o.id}>
                    <td>
                      <div className="mono strong">{o.soNo}</div>
                      <div className="sub">{fmtDate(o.soDate)}</div>
                    </td>
                    {party && <td>{o.customer || '—'}</td>}
                    <td>
                      {o.products || '—'}
                      {o.lineCount > 1 && <div className="sub">{o.lineCount} lines</div>}
                    </td>
                    <td className="r num">{o.totalQty ? fmtNum(o.totalQty) : '—'}</td>
                    <td className="nowrap">
                      {o.deliveryDate ? fmtDate(o.deliveryDate) : '—'}
                      {late && <div className="sub"><span className="chip chip-hot">Overdue</span></div>}
                    </td>
                    <td>
                      <Badge status={o.status} />
                      {jobs > 0 && <div className="sub">{jobs} job card{jobs === 1 ? '' : 's'}</div>}
                    </td>
                    <td className="r nowrap">
                      <Write res="cutting">
                        <button className="btn btn-primary btn-sm" onClick={() => openAction({ kind: 'newJob', soNo: o.soNo })} title={`New job card for ${o.soNo}`}>
                          <Send size={14} /> Send to Production
                        </button>
                      </Write>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pending.length > SHOWN && (
            <div className="text-xs muted" style={{ padding: '10px 14px' }}>
              {pending.length - SHOWN} more — see <button className="link-btn" onClick={() => go('sales-order')}>all sales orders</button>.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
