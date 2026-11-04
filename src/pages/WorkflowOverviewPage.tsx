import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Handshake, Layers, PackageX, Wrench, X } from 'lucide-react';
import { canSee } from '../auth/access';
import { Badge, Empty, FilterMenu, JobLink, PageHeader, SummaryLine, Tabs, go } from '../components/ui';
import { usePaged } from '../components/Pager';
import { useFurnaces } from '../furnaces/service';
import { fmtDate, fmtNum, matches, todayISO } from '../components/format';
import { ListButtons } from '../export/docOutput';
import { FORM_FORMATS } from '../export/xlsxSheet';
import { supabase } from '../db/client';
import { jobPriority, priorityChip, priorityName } from '../planning/priority';
import { useOrders, useQuotations } from '../salesmod/hooks';
import { STAGE_LABEL, getProduct, jobSummary, stageRecords } from '../store/engine';
import { useStore } from '../store/StoreContext';
import { useStock } from '../stock/service';
import { Search } from '../components/ui';

type View = 'jobs' | 'orders' | 'stock' | 'rework';

const BOARD = ['cutting', 'forging', 'trimming', 'heatTreatment', 'qc', 'finishedGoods'] as const;

/**
 * Main Menu → Workflow Overview. The whole workflow reflected on one page, for the owner: what has been won and not started, what is in
 * production and where, how urgent it is, what is stuck in QC or waiting for rework, what is ready to dispatch, and what stock is low.
 * Read-only — it only gathers what the other pages hold. Job work is marked with an amber tag; Job Work Out is NOT shown here
 * (it lives on its own page only).
 */
export function WorkflowOverviewPage() {
  const { state } = useStore();
  const { orders } = useOrders();
  const { quotations } = useQuotations();
  const stock = useStock();
  const [view, setView] = useState<View>('jobs');
  const [q, setQ] = useState('');
  const [sentBack, setSentBack] = useState<Record<string, number>>({});
  const [stage, setStage] = useState<(typeof BOARD)[number] | null>(null);
  const today = todayISO();
  const names = canSee('party_names');

  // rejected pieces already sent for rework, per job (migration 66)
  useEffect(() => {
    void supabase
      .from('v_qc_rework')
      .select('job_no, qty')
      .then(({ data, error }) => {
        if (error) return setSentBack({});
        const m: Record<string, number> = {};
        for (const r of data ?? []) m[String(r.job_no)] = (m[String(r.job_no)] ?? 0) + Number(r.qty);
        setSentBack(m);
      });
  }, [state]);

  const jobs = useMemo(
    () =>
      state.jobs
        .map((j) => ({ j, s: jobSummary(state, j.jobNo), jw: state.jobWork.some((w) => w.jobNo === j.jobNo) }))
        .filter((x) => x.s.status !== 'Dispatched' && x.j.currentStage !== 'scrapped')
        .sort((a, b) => jobPriority(a.j) - jobPriority(b.j) || (a.j.dueDate || '9999').localeCompare(b.j.dueDate || '9999')),
    [state],
  );
  const overdue = (due: string) => !!due && due < today;

  // approved by the customer = a quotation marked Won, or a confirmed sales order; "not started" = no job card yet
  const orderRows = useMemo(() => {
    const fromOrders = orders
      .filter((o) => o.status === 'Confirmed' || o.status === 'In Production')
      .map((o) => {
        const linked = state.jobs.filter((j) => j.salesOrderNo === o.soNo);
        const made = linked.reduce((t, j) => t + j.plannedQty, 0);
        const sent = linked.reduce((t, j) => t + state.dispatches.filter((d) => d.jobNo === j.jobNo && d.status === 'Dispatched').reduce((a, d) => a + d.qty, 0), 0);
        return { key: o.soNo, ref: o.soNo, from: o.quotationNo ?? '', customer: o.customer, items: o.products, qty: o.totalQty, due: o.deliveryDate ?? '', jobs: linked.length, made, sent, status: o.status === 'In Production' ? 'In production' : linked.length ? 'In production' : 'Waiting for a job card' };
      });
    const wonNoOrder = quotations
      .filter((x) => x.status === 'Won' && !x.orderNo)
      .map((x) => ({ key: x.docNo, ref: x.docNo, from: '', customer: x.customer, items: x.products, qty: x.totalQty, due: '', jobs: 0, made: 0, sent: 0, status: 'Won — no sales order yet' }));
    return [...wonNoOrder, ...fromOrders].filter((r) => matches(q, r.ref, r.items, names ? r.customer : ''));
  }, [orders, quotations, state, q, names]);

  const waitingStart = orderRows.filter((r) => r.status !== 'In production').length;
  const inQc = jobs.filter((x) => x.j.currentStage === 'qc').length;
  const ready = jobs.filter((x) => x.s.status === 'Ready for Dispatch').length;
  const urgent = jobs.filter((x) => x.j.priority === 'Urgent').length;
  const late = jobs.filter((x) => overdue(x.j.dueDate)).length;
  const reworkRows = state.qc
    .filter((r) => r.status !== 'QC Pending' && r.rejected > 0)
    .map((r) => ({ r, waiting: r.rejected - (sentBack[r.jobNo] ?? 0), sent: sentBack[r.jobNo] ?? 0 }));
  const reworkWaiting = reworkRows.reduce((t, x) => t + x.waiting, 0);
  const lowRaw = stock.raw.filter((x) => x.status !== 'ok');
  const lowParts = stock.semi.filter((x) => x.status !== 'ok');
  const lowCount = lowRaw.length + lowParts.length;

  const shownJobs = jobs.filter((x) => matches(q, x.j.jobNo, x.s.product.name, names ? x.j.customer : '', x.j.salesOrderNo));
  const pj = usePaged(shownJobs, q);
  const po = usePaged(orderRows, q);
  const pr = usePaged(reworkRows, 'rework');
  const lowAll = [...lowRaw.map((x) => ({ kind: 'raw' as const, x })), ...lowParts.map((x) => ({ kind: 'parts' as const, x }))];
  const ps = usePaged(lowAll, 'stock');

  return (
    <>
      <PageHeader
        eyebrow="Main Menu"
        title="Workflow Overview"
        subtitle="Everything that is going on, on one page."
        actions={
          <ListButtons
            doc={() => ({
              filename: 'Workflow-Overview',
              title: 'Workflow Overview',
              form: FORM_FORMATS.report,
              rows: shownJobs.map((x) => ({ job: x.j.jobNo, order: x.j.salesOrderNo ?? '', product: x.s.product.name, customer: names ? x.j.customer : '', kind: x.jw ? 'Job work' : 'Our order', qty: x.j.plannedQty, stage: STAGE_LABEL[x.j.currentStage], urgency: priorityName(jobPriority(x.j)), due: x.j.dueDate, status: x.s.status })),
              cols: [{ label: 'Job No.', key: 'job' }, { label: 'Sales Order', key: 'order' }, { label: 'Product', key: 'product', width: 26 }, { label: 'Customer', key: 'customer', width: 24 }, { label: 'Type', key: 'kind' }, { label: 'Qty (PCS)', key: 'qty', kind: 'num' }, { label: 'Now at', key: 'stage' }, { label: 'Urgency', key: 'urgency' }, { label: 'Due', key: 'due', kind: 'date' }, { label: 'Status', key: 'status' }],
            })}
          />
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body" style={{ padding: '14px 20px' }}>
          <SummaryLine
            items={[
              { label: waitingStart === 1 ? 'approved order not started' : 'approved orders not started', value: waitingStart, tone: waitingStart ? 'bad' : undefined },
              { label: 'job cards running', value: jobs.length, tone: 'info' },
              { label: 'urgent', value: urgent, tone: urgent ? 'bad' : undefined },
              { label: 'overdue', value: late, tone: late ? 'bad' : undefined },
              { label: 'in QC', value: inQc },
              { label: 'PCS waiting for a rework decision', value: fmtNum(reworkWaiting), tone: reworkWaiting ? 'bad' : undefined },
              { label: 'ready to dispatch', value: ready, tone: ready ? 'good' : undefined },
              { label: 'items low on stock', value: lowCount, tone: lowCount ? 'bad' : undefined },
            ]}
          />
        </div>
      </div>

      {/* where the work is right now */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
        {BOARD.map((st) => {
          const here = jobs.filter((x) => x.j.currentStage === st);
          const qty = here.reduce((t, x) => t + x.s.currentQty, 0);
          const jw = here.filter((x) => x.jw).length;
          return (
            <button key={st} type="button" className={`card stage-card ${stage === st ? 'on' : ''}`} style={{ padding: '12px 16px' }} onClick={() => setStage(stage === st ? null : st)} aria-pressed={stage === st} title={`Show everything in ${STAGE_LABEL[st]}`}>
              <div className="muted text-sm">{STAGE_LABEL[st]}</div>
              <div className="strong" style={{ fontSize: 24, lineHeight: 1.2 }}>{here.length}</div>
              <div className="muted text-sm">
                {here.length ? `${fmtNum(qty)} PCS` : 'nothing here'}
                {jw > 0 && <span className="chip chip-jw">{jw} job work</span>}
              </div>
            </button>
          );
        })}
      </div>

      {stage && <StageDetail stage={stage} onClose={() => setStage(null)} />}

      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 12 }}>
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'jobs', label: 'In production', count: jobs.length },
              { value: 'orders', label: 'Approved orders', count: orderRows.length },
              { value: 'rework', label: 'Rejected / rework', count: reworkRows.length },
              { value: 'stock', label: 'Low stock', count: lowCount },
            ]}
          />
          {(view === 'jobs' || view === 'orders') && <Search value={q} onChange={setQ} placeholder="Search job, order, product…" />}
        </div>

        {view === 'jobs' &&
          (shownJobs.length === 0 ? (
            <Empty icon={Layers} title="No job cards running" text="Job cards that are in production appear here." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Job No.</th>
                    <th>{names ? 'Product / Customer' : 'Product'}</th>
                    <th>Order</th>
                    <th className="r">Qty</th>
                    <th>Now at</th>
                    <th>Urgency</th>
                    <th>Due</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pj.rows.map((x) => (
                    <tr key={x.j.jobNo}>
                      <td><JobLink jobNo={x.j.jobNo} /></td>
                      <td>
                        <div className="strong">{x.s.product.name}</div>
                        {names && <div className="sub">{x.j.customer}</div>}
                      </td>
                      <td className="mono">{x.j.salesOrderNo ?? '—'}</td>
                      <td className="r">{fmtNum(x.j.plannedQty)}</td>
                      <td>{STAGE_LABEL[x.j.currentStage]}</td>
                      <td><span className={priorityChip(jobPriority(x.j))}>{priorityName(jobPriority(x.j))}</span></td>
                      <td className="nowrap">
                        {x.j.dueDate ? fmtDate(x.j.dueDate) : '—'}
                        {overdue(x.j.dueDate) && <span className="chip chip-hot" style={{ marginLeft: 6 }}>overdue</span>}
                      </td>
                      <td><Badge status={x.s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pj.pager}
            </div>
          ))}

        {view === 'orders' &&
          (orderRows.length === 0 ? (
            <Empty icon={ClipboardCheck} title="No approved orders waiting" text="Quotations the customer accepted (Won) and confirmed sales orders appear here until they are delivered." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Order / Quotation</th>
                    <th>{names ? 'Customer / Items' : 'Items'}</th>
                    <th className="r">Ordered</th>
                    <th className="r">Job cards</th>
                    <th className="r">Planned</th>
                    <th className="r">Dispatched</th>
                    <th>Delivery</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {po.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="mono strong">{r.ref}</td>
                      <td>
                        {names && <div className="strong">{r.customer}</div>}
                        <div className="sub">{r.items}</div>
                      </td>
                      <td className="r">{fmtNum(r.qty)}</td>
                      <td className="r">{r.jobs}</td>
                      <td className="r">{fmtNum(r.made)}</td>
                      <td className="r">{fmtNum(r.sent)}</td>
                      <td className="nowrap">{r.due ? fmtDate(r.due) : '—'}</td>
                      <td><span className={r.status === 'In production' ? 'chip chip-up' : 'chip chip-wait'}>{r.status}</span></td>
                      <td className="r">
                        <button className="btn-link" onClick={() => go(r.ref.startsWith('SO') ? 'sales-order' : 'sales-quotation')}>Open</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {po.pager}
            </div>
          ))}

        {view === 'rework' &&
          (reworkRows.length === 0 ? (
            <Empty icon={Wrench} title="Nothing rejected" text="Pieces QC rejects, and what was sent back for rework, appear here." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Job No.</th><th>Product</th><th className="r">Rejected</th><th className="r">Sent for rework</th><th className="r">Waiting for a decision</th><th>Reason</th><th /></tr>
                </thead>
                <tbody>
                  {pr.rows.map(({ r, waiting, sent }) => (
                    <tr key={r.jobNo}>
                      <td><JobLink jobNo={r.jobNo} /></td>
                      <td>{getProduct(state, state.jobs.find((j) => j.jobNo === r.jobNo)?.productId ?? '').name}</td>
                      <td className="r">{fmtNum(r.rejected)}</td>
                      <td className="r">{fmtNum(sent)}</td>
                      <td className="r">{waiting > 0 ? <span className="chip chip-hot">{fmtNum(waiting)}</span> : 0}</td>
                      <td>{r.rejectionReason || '—'}</td>
                      <td className="r"><button className="btn-link" onClick={() => go('qc')}>Open QC</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pr.pager}
            </div>
          ))}

        {view === 'stock' &&
          (lowCount === 0 ? (
            <Empty icon={PackageX} title="Stock is fine" text="Raw bar and parts that reach their minimum show up here. Set the minimum in Product Master or on the raw stock." />
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr><th>Item</th><th>Kind</th><th className="r">In stock</th><th className="r">Minimum</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {ps.rows.filter((e) => e.kind === 'raw').map((e) => e.x as (typeof lowRaw)[number]).map((x) => (
                    <tr key={`${x.material}|${x.od}`}>
                      <td className="strong">{x.material} Ø{x.od}</td>
                      <td>Raw bar</td>
                      <td className="r">{fmtNum(x.free)} PCS free</td>
                      <td className="r">{fmtNum(x.min)}</td>
                      <td><span className={x.status === 'out' ? 'chip chip-hot' : 'chip chip-wait'}>{x.status === 'out' ? 'Out of stock' : 'Low'}</span></td>
                      <td className="r"><button className="btn-link" onClick={() => go('raw-inventory')}>Open</button></td>
                    </tr>
                  ))}
                  {ps.rows.filter((e) => e.kind === 'parts').map((e) => e.x as (typeof lowParts)[number]).map((x) => (
                    <tr key={`${x.productId}|${x.stage}`}>
                      <td className="strong">{getProduct(state, x.productId).name}</td>
                      <td>Parts for {STAGE_LABEL[x.stage]}</td>
                      <td className="r">{fmtNum(x.available)} PCS</td>
                      <td className="r">{fmtNum(x.min)}</td>
                      <td><span className={x.status === 'out' ? 'chip chip-hot' : 'chip chip-wait'}>{x.status === 'out' ? 'Out of stock' : 'Low'}</span></td>
                      <td className="r"><button className="btn-link" onClick={() => go('products')}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ps.pager}
            </div>
          ))}
      </div>
      <div className="muted text-sm" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Handshake size={13} /> <span className="chip chip-jw" style={{ marginLeft: 0 }}>Job work</span> marks the customer's own batches. Work given out to others is on the Job Work Out page only.
        {late > 0 && <><AlertTriangle size={13} style={{ marginLeft: 12 }} /> {late} job card{late === 1 ? ' is' : 's are'} past the due date.</>}
      </div>
    </>
  );
}


// ------------------------------------------------------------------------------------------------ one stage, in full
type Row = {
  key: string;
  jobNo: string;
  product: string;
  customer: string;
  order: string;
  qty: number;
  out: number | null;
  loss: number | null;
  status: string;
  machine: string;
  operator: string;
  furnace: string;
  started: string;
  level: number;
  due: string;
  jw: boolean;
};
const PROCESS = ['cutting', 'forging', 'trimming', 'heatTreatment'] as const;
const STATUS_LABEL: Record<string, string> = { Pending: 'Waiting', 'In Progress': 'In progress', Completed: 'Finished' };

/** everything that is in one stage (or has been through it): each process record with its machine, operator, status, urgency and due date */
function StageDetail({ stage, onClose }: { stage: (typeof BOARD)[number]; onClose: () => void }) {
  const { state } = useStore();
  const fu = useFurnaces();
  const names = canSee('party_names');
  const today = todayISO();
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('open');
  const [urgF, setUrgF] = useState('all');
  const [typeF, setTypeF] = useState('all');
  const [custF, setCustF] = useState('all');
  const [machF, setMachF] = useState('all');
  const isProcess = (PROCESS as readonly string[]).includes(stage);

  const all: Row[] = useMemo(() => {
    const jobOf = (no: string) => state.jobs.find((j) => j.jobNo === no);
    const base = (no: string) => {
      const j = jobOf(no);
      return { jobNo: no, product: j ? getProduct(state, j.productId).name : '', customer: j?.customer ?? '', order: j?.salesOrderNo ?? '', level: j ? jobPriority(j) : 3, due: j?.dueDate ?? '', jw: state.jobWork.some((w) => w.jobNo === no) };
    };
    if (isProcess) {
      return stageRecords(state, stage as (typeof PROCESS)[number]).map((r) => ({
        ...base(r.jobNo),
        key: r.id,
        qty: r.input,
        out: r.status === 'Completed' ? r.output : null,
        loss: r.status === 'Completed' ? r.loss : null,
        status: r.status,
        machine: r.machine,
        operator: r.operator,
        furnace: stage === 'heatTreatment' ? fu.furnaces.find((f) => f.id === fu.loadOfJob(r.jobNo)?.furnaceId)?.name ?? '' : '',
        started: r.startedAt ?? '',
      }));
    }
    if (stage === 'qc') {
      return state.qc.map((r) => ({ ...base(r.jobNo), key: r.id, qty: r.input, out: r.status === 'QC Pending' ? null : r.accepted, loss: r.status === 'QC Pending' ? null : r.rejected, status: r.status, machine: '', operator: r.inspector, furnace: '', started: r.inspectedAt ?? '' }));
    }
    return state.finishedGoods.map((f) => ({ ...base(f.jobNo), key: f.id, qty: f.qty, out: f.dispatchedQty, loss: null, status: f.dispatchedQty >= f.qty ? 'Dispatched' : f.dispatchedQty > 0 ? 'Partially Dispatched' : f.reservedQty > 0 ? 'Reserved' : 'Available', machine: '', operator: '', furnace: '', started: f.receivedAt ?? '' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, stage, fu.furnaces, fu.loads]);

  // "open" = not finished yet (what is happening now); the other options show what was finished too
  const isOpen = (r: Row) => (isProcess ? r.status !== 'Completed' : stage === 'qc' ? r.status === 'QC Pending' : r.status !== 'Dispatched');
  const rows = all
    .filter((r) => (statusF === 'open' ? isOpen(r) : statusF === 'all' || r.status === statusF))
    .filter((r) => urgF === 'all' || String(r.level) === urgF)
    .filter((r) => typeF === 'all' || (typeF === 'jw' ? r.jw : !r.jw))
    .filter((r) => custF === 'all' || r.customer === custF)
    .filter((r) => machF === 'all' || r.machine === machF)
    .filter((r) => matches(q, r.jobNo, r.product, names ? r.customer : '', r.order, r.machine, r.operator))
    .sort((a, b) => a.level - b.level || (a.due || '9999').localeCompare(b.due || '9999'));
  const paged = usePaged(rows, `${stage}|${q}|${statusF}|${urgF}|${typeF}|${custF}|${machF}`);

  const distinct = (pick: (r: Row) => string) => [...new Set(all.map(pick).filter(Boolean))].sort();
  const statuses = distinct((r) => r.status);
  const groups = [
    { label: 'Status', value: statusF, onChange: setStatusF, options: [{ value: 'open', label: 'Happening now', count: all.filter(isOpen).length }, { value: 'all', label: 'All (including finished)', count: all.length }, ...statuses.map((v) => ({ value: v, label: isProcess ? STATUS_LABEL[v] ?? v : v, count: all.filter((r) => r.status === v).length }))] },
    { label: 'Urgency', value: urgF, onChange: setUrgF, options: [{ value: 'all', label: 'Any' }, ...[1, 2, 3].map((n) => ({ value: String(n), label: priorityName(n), count: all.filter((r) => r.level === n).length }))] },
    { label: 'Type', value: typeF, onChange: setTypeF, options: [{ value: 'all', label: 'All' }, { value: 'own', label: 'Our orders' }, { value: 'jw', label: 'Job work' }] },
    ...(names && distinct((r) => r.customer).length ? [{ label: 'Customer', value: custF, onChange: setCustF, options: [{ value: 'all', label: 'All customers' }, ...distinct((r) => r.customer).map((v) => ({ value: v, label: v }))] }] : []),
    ...(isProcess && distinct((r) => r.machine).length ? [{ label: 'Machine', value: machF, onChange: setMachF, options: [{ value: 'all', label: 'All machines' }, ...distinct((r) => r.machine).map((v) => ({ value: v, label: v }))] }] : []),
  ];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head" style={{ gap: 12 }}>
        <h3>{STAGE_LABEL[stage]} — {rows.length} {rows.length === 1 ? 'entry' : 'entries'}</h3>
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} title="Close" aria-label="Close this list">
          <X size={18} />
        </button>
      </div>
      <div className="toolbar">
        <Search value={q} onChange={setQ} placeholder="Search job, product, machine…" />
        <FilterMenu groups={groups as never} />
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
          <ListButtons
            doc={() => ({
              filename: `Workflow-${STAGE_LABEL[stage].replace(/\s+/g, '-')}`,
              title: `${STAGE_LABEL[stage]} — Workflow Overview`,
              form: FORM_FORMATS.report,
              rows: rows.map((r) => ({ ...r, customer: names ? r.customer : '', type: r.jw ? 'Job work' : 'Our order', urgency: priorityName(r.level), status: isProcess ? STATUS_LABEL[r.status] ?? r.status : r.status })),
              cols: [{ label: 'Job No.', key: 'jobNo' }, { label: 'Product', key: 'product', width: 26 }, { label: 'Customer', key: 'customer', width: 24 }, { label: 'Order', key: 'order' }, { label: 'Type', key: 'type' }, { label: 'Qty In', key: 'qty', kind: 'num' }, { label: 'Qty Out', key: 'out', kind: 'num' }, { label: 'Loss', key: 'loss', kind: 'num' }, { label: 'Status', key: 'status' }, { label: 'Machine', key: 'machine' }, { label: 'Operator', key: 'operator' }, { label: 'Urgency', key: 'urgency' }, { label: 'Due', key: 'due', kind: 'date' }],
            })}
          />
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty icon={Layers} title={`Nothing ${statusF === 'open' ? 'happening' : 'found'} in ${STAGE_LABEL[stage]}`} text="Change the status filter to see finished entries too." />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Job No.</th>
                <th>{names ? 'Product / Customer' : 'Product'}</th>
                <th className="r">Qty in</th>
                <th className="r">{stage === 'finishedGoods' ? 'Dispatched' : stage === 'qc' ? 'Accepted' : 'Qty out'}</th>
                <th>Status</th>
                {isProcess && <th>Machine / Operator</th>}
                {stage === 'heatTreatment' && <th>Furnace</th>}
                {stage === 'qc' && <th>Inspector</th>}
                <th>Urgency</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((r) => (
                <tr key={r.key}>
                  <td><JobLink jobNo={r.jobNo} />{r.order && <div className="sub">Order {r.order}</div>}</td>
                  <td>
                    <div className="strong">{r.product}</div>
                    {names && <div className="sub">{r.customer}</div>}
                  </td>
                  <td className="r">{fmtNum(r.qty)}</td>
                  <td className="r">{r.out == null ? <span className="muted">—</span> : fmtNum(r.out)}{r.loss ? <div className="sub loss">−{r.loss} {stage === 'qc' ? 'rejected' : 'loss'}</div> : null}</td>
                  <td><Badge status={r.status} /></td>
                  {isProcess && <td>{r.machine || '—'}<div className="sub">{r.operator || ''}</div></td>}
                  {stage === 'heatTreatment' && <td>{r.furnace || '—'}</td>}
                  {stage === 'qc' && <td>{r.operator || '—'}</td>}
                  <td><span className={priorityChip(r.level)}>{priorityName(r.level)}</span></td>
                  <td className="nowrap">
                    {r.due ? fmtDate(r.due) : '—'}
                    {r.due && r.due < today && isOpen(r) && <span className="chip chip-hot" style={{ marginLeft: 6 }}>overdue</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.pager}
        </div>
      )}
    </div>
  );
}
