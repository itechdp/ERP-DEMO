import * as api from '../db/api';
import { Conf, Write, canSee, searchable, useAccess, searchableCol } from '../auth/access';
import { useState } from 'react';
import { ClipboardList, Eye, FileText, Handshake, PackageOpen, Plus, Printer, Truck, X, Trash2 } from 'lucide-react';
import { printJobWorkReturn } from '../jobwork/print';
import { useStore } from '../store/StoreContext';
import { withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { dispatchDeleteReason } from '../store/deletable';
import { fgAvailable, getProduct, isToday, round3 } from '../store/engine';
import type { Dispatch } from '../store/types';
import { Badge, Empty, Field, JobLink, Modal, PageHeader, rowTone, Search, SummaryLine, FilterMenu, Confirm } from '../components/ui';
import { tsFor } from '../components/NewJobModal';
import { printRouteCard } from '../components/routeCard';
import { fmtDate, fmtKg, fmtNum, matches, todayISO } from '../components/format';
import { printPage } from '../native/native';

type Filter = 'all' | 'Ready for Dispatch' | 'Dispatched' | 'today';

export function DispatchPage() {
  const { state, openTrace, openAction, run } = useStore();
  const [deleting, setDeleting] = useState<Dispatch | null>(null);
  const { can } = useAccess();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [custF, setCustF] = useState('all');
  const newDispatch = (fgId = '') => openAction({ kind: 'dispatch', fgId });
  const [shipping, setShipping] = useState<Dispatch | null>(null);
  const [viewing, setViewing] = useState<Dispatch | null>(null);

  const ds = state.dispatches;
  const today = ds.filter((d) => d.status === 'Dispatched' && isToday(d.dispatchedAt));
  const ready = ds.filter((d) => d.status === 'Ready for Dispatch');
  const shipped = ds.filter((d) => d.status === 'Dispatched');
  const customers = [...new Set(ds.map((d) => d.customer).filter(Boolean))].sort();
  const fgAvail = state.finishedGoods.reduce((t, f) => t + fgAvailable(f), 0);

  const rows = ds
    .filter((d) => (filter === 'all' ? true : filter === 'today' ? today.includes(d) : d.status === filter))
    .filter((d) => custF === 'all' || d.customer === custF)
    .filter((d) => matches(q, d.dispatchNo, d.jobNo, searchable(d.customer), searchableCol(d.vehicleNo, 'dispatch.vehicle'), getProduct(state, d.productId).name, searchable(d.invoiceNo, 'invoices')));

  return (
    <>
      <PageHeader
        eyebrow="Workflow · Step 8 of 8"
        title="Dispatch"
        flow="dispatched"
        actions={
          <button className="btn btn-primary" onClick={() => newDispatch()}>
            <Plus size={16} /> New Dispatch
          </button>
        }
      />
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Dispatch Register</h3>
          </div>
          {(ds.length > 0 || fgAvail > 0) && (
            <div className="right">
              <SummaryLine
                items={[
                  { label: 'PCS dispatched today', value: fmtNum(today.reduce((t, d) => t + d.qty, 0)), tone: 'good' },
                  { label: `PCS dispatched in total (${fmtKg(round3(shipped.reduce((t, d) => t + d.weight, 0)))})`, value: fmtNum(shipped.reduce((t, d) => t + d.qty, 0)) },
                  { label: 'PCS in FG to dispatch', value: fmtNum(fgAvail), tone: 'info' },
                ]}
              />
            </div>
          )}
        </div>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder={can('party_names') ? 'Search dispatch, job, customer, vehicle…' : 'Search dispatch, job, vehicle…'} />
          <FilterMenu
            groups={[
              {
                label: 'Status',
                value: filter,
                onChange: (v) => setFilter(v as Filter),
                options: [
                  { value: 'all', label: 'All', count: ds.length },
                  ...(ready.length ? [{ value: 'Ready for Dispatch', label: 'Ready for Dispatch', count: ready.length }] : []),
                  { value: 'Dispatched', label: 'Dispatched', count: shipped.length },
                  { value: 'today', label: 'Today', count: today.length },
                ],
              },
              ...(can('party_names') && customers.length ? [{ label: 'Customer', value: custF, onChange: setCustF, options: [{ value: 'all', label: 'All customers' }, ...customers.map((c) => ({ value: c, label: c }))] }] : []),
            ]}
          />
        </div>
        {rows.length === 0 ? (
          <Empty icon={Truck} title="No dispatches in this view" text="Create a dispatch from available finished goods." action={<button className="btn btn-primary" onClick={() => newDispatch()}><Plus size={15} /> New Dispatch</button>} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Dispatch No.</th>
                  <th>Job No.</th>
                  <th>{can('party_names') ? 'Customer / Product' : 'Product'}</th>
                  <th className="r">Quantity</th>
                  <th className="r">Bags</th>
                  <th className="r">Weight</th>
                  <Conf col="dispatch.vehicle">
                    <th>Vehicle</th>
                  </Conf>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="act">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const p = getProduct(state, d.productId);
                  return (
                    <tr key={d.dispatchNo} className={rowTone(d.status)}>
                      <td>
                        <div className="mono strong">{d.dispatchNo}</div>
                        <Conf g="invoices">
                          <div className="sub">{d.invoiceNo}</div>
                        </Conf>
                      </td>
                      <td>
                        <JobLink jobNo={d.jobNo} />
                      </td>
                      <td>
                        <Conf g="party_names">
                          <div className="strong">{d.customer}</div>
                        </Conf>
                        <div className="sub">{p.name}</div>
                      </td>
                      <td className="r qty-cell">{fmtNum(d.qty)}</td>
                      <td className="r num">
                        {d.bags.length}
                        <div className="sub">{d.bags[0]?.qty} / bag</div>
                      </td>
                      <td className="r num nowrap">{fmtKg(d.weight)}</td>
                      <Conf col="dispatch.vehicle">
                        <td className="mono nowrap">{d.vehicleNo || <span className="muted">—</span>}</td>
                      </Conf>
                      <td className="nowrap">{fmtDate(d.date)}</td>
                      <td>
                        <Badge status={d.status} />
                      </td>
                      <td className="r nowrap">
                        {d.status === 'Ready for Dispatch' && (
                          <button className="btn btn-sm btn-success" onClick={() => setShipping(d)}>
                            <Truck size={13} /> Dispatch
                          </button>
                        )}
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle', marginLeft: 4 }} title="Print process route card" onClick={() => printRouteCard(state, d.jobNo)}>
                          <ClipboardList size={16} />
                        </button>
                        {(() => {
                          const jw = state.jobWork.find((w) => w.jobNo === d.jobNo);
                          return jw ? (
                            <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle' }} title="Print return challan (job work)" onClick={() => printJobWorkReturn(state, d, jw)}>
                              <Handshake size={16} />
                            </button>
                          ) : null;
                        })()}
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle' }} title="Packing list" onClick={() => setViewing(d)}>
                          <FileText size={16} />
                        </button>
                        <button className="icon-btn" style={{ display: 'inline-grid', verticalAlign: 'middle' }} title="View traceability" onClick={() => openTrace(d.jobNo)}>
                          <Eye size={16} />
                        </button>
                        <Write res="dispatch">
                          <button className="icon-btn danger" style={{ display: 'inline-grid', verticalAlign: 'middle' }} title={dispatchDeleteReason(d) ?? 'Delete dispatch'} aria-label={`Delete ${d.dispatchNo}`} disabled={!!dispatchDeleteReason(d)} onClick={() => setDeleting(d)}>
                            <Trash2 size={16} />
                          </button>
                        </Write>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {shipping && <ShipModal d={shipping} onClose={() => setShipping(null)} />}
      {viewing && <PackingList d={viewing} onClose={() => setViewing(null)} />}
      <Confirm
        open={!!deleting}
        title="Delete dispatch"
        message={deleting ? `Delete ${deleting.dispatchNo}? It has not left the plant, so its ${fmtNum(deleting.qty)} PCS go back to available finished goods.` : ''}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => deleting && void run((ts) => api.deleteDispatch(deleting.dispatchNo, ts), { title: 'Dispatch deleted', message: `${deleting.dispatchNo} · ${fmtNum(deleting.qty)} PCS back to finished goods` })}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** Packing / dispatch as on the route card: Vehicle No. and one row per bag (qty + weight). */
export function NewDispatchModal({ fgId: initial, onClose }: { fgId: string; onClose: () => void }) {
  const { state, run } = useStore();
  const lots = state.finishedGoods.filter((f) => fgAvailable(f) > 0);
  const [fgId, setFgId] = useState(lots.find((f) => f.id === initial)?.id ?? lots[0]?.id ?? '');
  const fg = lots.find((f) => f.id === fgId);
  const product = fg ? getProduct(state, fg.productId) : null;
  const avail = fg ? fgAvailable(fg) : 0;
  const doc = useDocNo('dispatch', true);
  const [vehicle, setVehicle] = useState('');
  const [date, setDate] = useState(todayISO());
  const [bags, setBags] = useState<{ qty: string; weight: string }[]>([{ qty: '', weight: '' }]);

  const unitKg = product?.finishedWeight ?? 0;
  const rows = bags.map((b) => {
    const q = Number(b.qty);
    const autoKg = q > 0 ? round3(q * unitKg) : 0;
    return { q, kg: Number(b.weight) > 0 ? Number(b.weight) : autoKg, autoKg, bad: b.qty !== '' && (!(q > 0) || !Number.isInteger(q)) };
  });
  const totalQty = rows.reduce((t, r) => t + (r.q > 0 ? r.q : 0), 0);
  const totalKg = round3(rows.reduce((t, r) => t + r.kg, 0));
  const over = totalQty > avail;
  const invalid = !fg || !vehicle.trim() || totalQty === 0 || over || rows.some((r) => r.bad || !(r.q > 0));

  const setBag = (i: number, k: 'qty' | 'weight', v: string) => setBags((list) => list.map((b, j) => (j === i ? { ...b, [k]: v } : b)));

  const submit = async () => {
    const ok = await withDocNo(doc.custom, () => run(
      (now) => api.createDispatch({ fgId, vehicleNo: vehicle, date, status: 'Dispatched', bags: rows.map((r) => ({ qty: r.q, weight: r.kg })) }, tsFor(date, now)),
      { title: 'Goods dispatched', message: `${totalQty} PCS in ${bags.length} bag${bags.length === 1 ? '' : 's'} on ${vehicle.toUpperCase()}.` },
    ));
    if (ok) onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Truck}
      title="Dispatch"
      subtitle="Bag-wise packing, as on the route card."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-success" disabled={invalid} onClick={submit}>
            <Truck size={15} /> Dispatch {totalQty > 0 ? `${fmtNum(totalQty)} PCS` : ''}
          </button>
        </>
      }
    >
      {lots.length === 0 ? (
        <Empty icon={PackageOpen} title="No finished goods available" text="Complete QC on a job to add stock to Finished Goods." />
      ) : (
        <>
          <div className="form-grid three">
            <DocNoField label="Dispatch No." no={doc.no} setNo={doc.setNo} />
            <Field label="Job Card No." required hint={product ? `${product.name} · ${fmtNum(avail)} PCS available` : undefined}>
              <select value={fgId} onChange={(e) => setFgId(e.target.value)}>
                {lots.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.jobNo} · {getProduct(state, f.productId).name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Vehicle No." required>
              <input className="input mono" placeholder="GJ13AX3059" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
            </Field>
          </div>

          <div className="section-label">Bags</div>
          <table className="bag-tbl">
            <thead>
              <tr>
                <th>Bag</th>
                <th>Qty (PCS)</th>
                <th>Weight (KG)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {bags.map((b, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <input className={`input num ${rows[i].bad ? 'bad' : ''}`} type="number" min={1} value={b.qty} autoFocus={i === bags.length - 1 && i > 0} onChange={(e) => setBag(i, 'qty', e.target.value)} />
                  </td>
                  <td>
                    <input className="input num" type="number" min={0} step="any" value={b.weight} placeholder={rows[i].autoKg ? String(rows[i].autoKg) : ''} onChange={(e) => setBag(i, 'weight', e.target.value)} />
                  </td>
                  <td>
                    {bags.length > 1 && (
                      <button className="icon-btn" title="Remove bag" onClick={() => setBags((list) => list.filter((_, j) => j !== i))}>
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <button className="btn btn-sm btn-soft" onClick={() => setBags((list) => [...list, { qty: list[list.length - 1]?.qty ?? '', weight: '' }])}>
                    <Plus size={14} /> Add bag
                  </button>
                </td>
                <td className={`strong num ${over ? 'loss' : ''}`}>{fmtNum(totalQty)} PCS</td>
                <td className="strong num">{totalKg.toFixed(3)} KG</td>
                <td />
              </tr>
            </tfoot>
          </table>
          {over && <div className="callout err">Total {fmtNum(totalQty)} PCS is more than the {fmtNum(avail)} PCS available for this job.</div>}
          {!over && totalQty > 0 && <div className="hint muted" style={{ marginTop: 10, fontSize: 12.5 }}>Weight left blank is calculated from {unitKg} kg per piece.</div>}
        </>
      )}
    </Modal>
  );
}

function ShipModal({ d, onClose }: { d: Dispatch; onClose: () => void }) {
  const { run } = useStore();
  const [vehicle, setVehicle] = useState(d.vehicleNo);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Dispatch ${d.dispatchNo}`}
      subtitle={`${d.qty} PCS · ${d.bags.length} bags · ${fmtKg(d.weight)} ${canSee('party_names') ? ` → ${d.customer}` : ''}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-success"
            disabled={!vehicle.trim()}
            onClick={async () => {
              if (await run((ts) => api.markDispatched(d.dispatchNo, vehicle, ts), { title: 'Goods dispatched', message: `${d.dispatchNo}: ${d.qty} PCS left on ${vehicle.toUpperCase()}.` })) onClose();
            }}
          >
            <Truck size={15} /> Confirm Dispatch
          </button>
        </>
      }
    >
      <Field label="Vehicle Number" required>
        <input className="input mono" autoFocus placeholder="GJ05AB1234" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} />
      </Field>
    </Modal>
  );
}

function PackingList({ d, onClose }: { d: Dispatch; onClose: () => void }) {
  const { state } = useStore();
  const p = getProduct(state, d.productId);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Packing List — ${d.dispatchNo}`}
      subtitle={canSee('party_names') ? `${d.customer} · ${fmtDate(d.date)}` : fmtDate(d.date)}
      footer={
        <>
          <button className="btn" onClick={() => printRouteCard(state, d.jobNo)}>
            <ClipboardList size={15} /> Print Route Card
          </button>
          <button className="btn" onClick={() => void printPage()}>
            <Printer size={15} /> Print Packing List
          </button>
        </>
      }
    >
      <div className="info-strip">
        <div>
          <div className="l">Job No.</div>
          <div className="v mono">{d.jobNo}</div>
        </div>
        <div>
          <div className="l">Product</div>
          <div className="v">{p.name}</div>
        </div>
        <Conf col="dispatch.vehicle">
          <div>
            <div className="l">Vehicle</div>
            <div className="v mono">{d.vehicleNo || '—'}</div>
          </div>
        </Conf>
        <Conf g="invoices">
          <div>
            <div className="l">Invoice</div>
            <div className="v mono">{d.invoiceNo}</div>
          </div>
        </Conf>
        <Conf g="sales_rates">
          <div>
            <div className="l">Amount</div>
            <div className="v mono">{d.salesRate ? `₹ ${(d.qty * d.salesRate).toLocaleString('en-IN')}` : '—'}</div>
          </div>
        </Conf>
        <div>
          <div className="l">Status</div>
          <div className="v">
            <Badge status={d.status} />
          </div>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>Bag No.</th>
            <th>Product</th>
            <th>Job No.</th>
            <th className="r">Quantity</th>
            <th className="r">Weight</th>
          </tr>
        </thead>
        <tbody>
          {d.bags.map((b) => (
            <tr key={b.no}>
              <td className="mono">
                {d.dispatchNo}/B{String(b.no).padStart(2, '0')}
              </td>
              <td>{p.name}</td>
              <td className="mono">{d.jobNo}</td>
              <td className="r qty-cell">{b.qty} PCS</td>
              <td className="r num">{b.weight.toFixed(3)} KG</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="strong">
              Total ({d.bags.length} bags)
            </td>
            <td className="r qty-cell">{d.qty} PCS</td>
            <td className="r strong num">{d.weight.toFixed(3)} KG</td>
          </tr>
        </tbody>
      </table>
    </Modal>
  );
}
