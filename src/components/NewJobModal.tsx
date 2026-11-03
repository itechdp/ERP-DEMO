import * as api from '../db/api';
import { useMemo, useState } from 'react';
import { Layers, PackagePlus, Scissors } from 'lucide-react';
import { useStore } from '../store/StoreContext';
import { canSee } from '../auth/access';
import { useOrders } from '../salesmod/hooks';
import { useDies } from '../dies/DieContext';
import { withDocNo } from '../db/client';
import { DocNoField, useDocNo } from '../components/DocNoField';
import { fifoLots, materialKey, parseMaterialKey, STAGE_LABEL } from '../store/engine';
import { entryStage, useProductFlows } from '../products/flow';
import { useStock } from '../stock/service';
import type { ERPState } from '../store/types';
import { findMaterial, pieceWeightKg } from '../store/materials';
import { Field, Modal, NumInput, go } from './ui';
import { fmtNum, todayISO } from './format';

/** FIFO allocation preview (read-only) */
export function fifoPreview(s: ERPState, key: string, qty: number) {
  let left = qty;
  const rows: { lotId: string; inwardDate: string; take: number; available: number }[] = [];
  for (const l of fifoLots(s, key)) {
    if (left <= 0) break;
    const take = Math.min(l.availableQty, left);
    rows.push({ lotId: l.id, inwardDate: l.inwardDate, take, available: l.availableQty });
    left -= take;
  }
  return { rows, short: Math.max(0, left) };
}

export function FifoPreview({ keyId, qty }: { keyId: string; qty: number }) {
  const { state } = useStore();
  if (!keyId || !(qty > 0)) return null;
  const { rows, short } = fifoPreview(state, keyId, qty);
  return (
    <div className={`callout ${short ? 'err' : 'info'}`}>
      <Layers size={16} />
      <div>
        <b>FIFO issue plan:</b>{' '}
        {rows.map((r, i) => (
          <span key={r.lotId}>
            {i > 0 && ' + '}
            <span className="mono">{r.lotId}</span> ({r.take} of {r.available} PCS, inward {r.inwardDate})
          </span>
        ))}
        {short > 0 && <div>Short by {short} PCS — add a Raw Material Inward first.</div>}
      </div>
    </div>
  );
}

/** ISO timestamp for a chosen date, keeping the current time of day */
export const tsFor = (date: string, nowTs: string) => {
  if (!date || date === nowTs.slice(0, 10)) return nowTs;
  const n = new Date(nowTs);
  const d = new Date(date + 'T00:00:00');
  d.setHours(n.getHours(), n.getMinutes(), n.getSeconds());
  return d > n ? nowTs : d.toISOString();
};

/** New Job Card — the same header fields as the client's paper Process Route Card. */
export function NewJobModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, openAction } = useStore();
  if (!state.products.length)
    return (
      <Modal
        dialog
        open={open}
        onClose={onClose}
        icon={PackagePlus}
        title="No products yet"
        subtitle="A job card is made for a product, so add the product first."
        footer={
          <>
            <button className="btn" onClick={onClose}>
              Close
            </button>
            <button className="btn btn-primary" onClick={() => (onClose(), (window.location.hash = '/products'))}>
              Go to Product Master
            </button>
          </>
        }
      >
        <p>Open <b>Product Master</b> and add your first product (code, raw material, cutting length, finished weight and heat-treatment settings). Director and Plant Head can do this.</p>
      </Modal>
    );
  return <NewJobForm open={open} onClose={onClose} openAction={openAction} />;
}

function NewJobForm({ open, onClose, openAction }: { open: boolean; onClose: () => void; openAction: ReturnType<typeof useStore>['openAction'] }) {
  const { state, masters, run, openTrace, busy } = useStore();
  const pf = useProductFlows();
  const st = useStock();
  const p0 = state.products[0];
  const [productId, setProductId] = useState(p0.id);
  const product = state.products.find((p) => p.id === productId)!;
  const [matKey, setMatKey] = useState(materialKey(p0.material, p0.od));
  const [cutLen, setCutLen] = useState(String(p0.cuttingLength));
  const [weightG, setWeightG] = useState<string | null>(null);
  const [planned, setPlanned] = useState('');
  const [dieNo, setDieNo] = useState(p0.dieNo);
  const [machineNo, setMachineNo] = useState('');
  const [date, setDate] = useState(todayISO());
  const { data: dieData } = useDies();
  const [customer, setCustomer] = useState('');
  const [soNo, setSoNo] = useState('');
  const { orders } = useOrders();
  const openOrders = orders.filter((o) => o.status === 'Confirmed' || o.status === 'In Production');
  const pickOrder = (no: string) => {
    setSoNo(no);
    const o = openOrders.find((x) => x.soNo === no);
    if (o?.customer) setCustomer(o.customer);
  };

  const materials = useMemo(() => {
    const m = new Map<string, number>();
    // every product's raw material is listed, even before it has stock
    for (const p of state.products) m.set(materialKey(p.material, p.od), 0);
    for (const l of state.rawMaterials) {
      const k = materialKey(l.material, l.od);
      m.set(k, (m.get(k) ?? 0) + l.availableQty);
    }
    return [...m.entries()];
  }, [state.rawMaterials, state.products]);

  const doc = useDocNo('job', open);
  const avail = materials.find(([k]) => k === matKey)?.[1] ?? 0;
  const mat = parseMaterialKey(matKey);
  const spec = findMaterial(mat.material);
  const autoWeightG = spec && Number(cutLen) > 0 ? Math.round(pieceWeightKg(mat.od, Number(cutLen), spec.density) * 1000) : 0;
  const weightShown = weightG ?? (autoWeightG ? String(autoWeightG) : '');
  const plannedN = Number(planned);
  // where this product starts: Cutting uses raw bar (net of what other job cards already planned); a later process uses our own stock of parts
  const entry = entryStage(pf.of(productId));
  const fromParts = entry !== 'cutting';
  const rawRow = st.rawOf(mat.material, mat.od);
  const rawFree = rawRow ? rawRow.free : avail;
  const partsAvail = st.semiOf(productId, entry)?.available ?? 0;
  const limit = fromParts ? partsAvail : rawFree;
  const errPlanned = planned === '' ? null : !(plannedN > 0) || !Number.isInteger(plannedN) ? 'Enter a whole quantity' : plannedN > limit ? (fromParts ? `Only ${limit} PCS in stock for ${STAGE_LABEL[entry]}` : `Only ${limit} PCS free${rawRow && rawRow.reserved ? ` (${rawRow.reserved} already planned)` : ''}`) : null;
  const invalid = planned === '' || !!errPlanned || !(Number(cutLen) > 0);

  const pickProduct = (id: string) => {
    const p = state.products.find((x) => x.id === id)!;
    setProductId(id);
    setMatKey(materialKey(p.material, p.od));
    setCutLen(String(p.cuttingLength));
    setDieNo(p.dieNo);
    setWeightG(null);
  };

  const submit = async () => {
    let created = '';
    const ok = await withDocNo(doc.custom, () => run(
      async (now) => {
        created = await api.createJob(
          { productId, plannedQty: plannedN, customer: customer || undefined, salesOrderNo: soNo || undefined, materialKey: matKey, cuttingLength: Number(cutLen), pieceWeightG: Number(weightShown) || undefined, dieNo, machineNo },
          tsFor(date, now),
        );
      },
      { title: 'Job card created', message: fromParts ? `${plannedN} PCS of ${product.name} taken from our stock — it starts at ${STAGE_LABEL[entry]}.` : `${plannedN} PCS of ${product.name} to cut. Enter the cutting result on the Cutting page.` },
    ));
    if (ok) {
      onClose();
      setTimeout(() => openTrace(created), 250);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      icon={Scissors}
      title="New Job Card"
      subtitle="Same fields as the Process Route Card. The Job Card No. stays with the material up to Dispatch."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={invalid || busy} onClick={submit}>
            Create Job Card
          </button>
        </>
      }
    >
      <div className="form-grid three">
        <DocNoField label="Job Card No." no={doc.no} setNo={doc.setNo} />
        <Field label="Date">
          <input className="input" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {canSee('party_names') && (
          <Field label="Customer" hint="Leave empty to use the product's customer">
            <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">{product.defaultCustomer ? `${product.defaultCustomer} (product's customer)` : '— none —'}</option>
              {[...new Set([...masters.customers, ...(customer ? [customer] : [])])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}
        {openOrders.length > 0 && (
          <Field label="Sales Order" hint="Which order this job card is for">
            <select value={soNo} onChange={(e) => pickOrder(e.target.value)}>
              <option value="">— not for an order —</option>
              {openOrders.map((o) => (
                <option key={o.id} value={o.soNo}>{o.soNo}{canSee('party_names') && o.customer ? ` — ${o.customer}` : ''}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Item Name" required>
          <select value={productId} onChange={(e) => pickProduct(e.target.value)}>
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {!fromParts && (
        <Field label="Material / Bar OD" required hint={`${fmtNum(rawFree)} PCS free${rawRow && rawRow.reserved ? ` · ${fmtNum(rawRow.reserved)} planned` : ''}`}>
          <select
            value={matKey}
            onChange={(e) => {
              setMatKey(e.target.value);
              setWeightG(null);
            }}
          >
            {materials.map(([k, a]) => (
              <option key={k} value={k}>
                {k.split('|')[0]} — Ø{k.split('|')[1]} ({a} PCS)
              </option>
            ))}
          </select>
        </Field>
        )}
        {!fromParts && (
        <Field label="Length" required>
          <NumInput
            value={cutLen}
            onChange={(v) => {
              setCutLen(v);
              setWeightG(null);
            }}
            suffix="mm"
            step="any"
          />
        </Field>
        )}
        {!fromParts && (
        <Field label="Weight per piece" hint={autoWeightG ? `Auto from Ø${mat.od} × ${cutLen} mm` : undefined}>
          <NumInput value={weightShown} onChange={setWeightG} suffix="g" />
        </Field>
        )}
        <Field label={fromParts ? `Qty to ${STAGE_LABEL[entry]}` : 'Qty to Cut'} required error={errPlanned} hint={fromParts ? `${fmtNum(partsAvail)} PCS in our stock` : undefined}>
          <NumInput value={planned} onChange={setPlanned} bad={!!errPlanned} autoFocus />
        </Field>
        <Field label="Die No.">
          <input className="input mono" list="job-die-list" value={dieNo} onChange={(e) => setDieNo(e.target.value)} placeholder="Optional — pick a forging die" />
          <datalist id="job-die-list">
            {dieData.forgingDies.filter((d) => d.status === 'Available' || d.status === 'In Production').map((d) => (
              <option key={d.code} value={d.code}>{d.status}</option>
            ))}
          </datalist>
        </Field>
        <Field label="Machine No.">
          <select value={machineNo} onChange={(e) => setMachineNo(e.target.value)}>
            <option value="">Optional</option>
            {[...masters.machines.cutting, ...masters.machines.forging, ...masters.machines.trimming].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
      </div>

      {fromParts ? (
        <div className={`callout ${partsAvail > 0 ? 'info' : 'warn'}`}>
          <PackagePlus size={16} />
          <div style={{ flex: 1 }}>
            {product.name} starts at <b>{STAGE_LABEL[entry]}</b>, so the pieces come from our stock of parts: <b>{fmtNum(partsAvail)} PCS</b> ready for {STAGE_LABEL[entry]}.
            {partsAvail === 0 && ' Add the stock on this product in Product Master first.'}
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => { onClose(); go('products'); }}>
            Product Master
          </button>
        </div>
      ) : avail === 0 ? (
        <div className="callout warn">
          <PackagePlus size={16} />
          <div style={{ flex: 1 }}>
            No stock of <b>{mat.material} Ø{mat.od} mm</b>. Add a raw material inward first.
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => openAction({ kind: 'inward', material: mat.material, od: mat.od })}>
            Add Raw Material Inward
          </button>
        </div>
      ) : (
        <FifoPreview keyId={matKey} qty={plannedN} />
      )}
    </Modal>
  );
}
