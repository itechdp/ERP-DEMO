import { useState } from 'react';
import { PackageX, Undo2 } from 'lucide-react';
import * as api from '../db/api';
import { useStore } from '../store/StoreContext';
import type { FinishedGood, RawMaterialLot } from '../store/types';
import { Field, Modal, NumInput } from './ui';
import { fmtNum } from './format';

const KINDS: { value: api.RawAdjustKind; label: string; hint: string }[] = [
  { value: 'count_up', label: 'Stock count — found more', hint: 'More pieces on the shelf than the system shows' },
  { value: 'count_down', label: 'Stock count — missing', hint: 'Fewer pieces on the shelf than the system shows' },
  { value: 'scrap', label: 'Scrap / damaged', hint: 'Pieces thrown away; counted as a loss' },
  { value: 'supplier_return', label: 'Returned to supplier', hint: 'Pieces sent back to the supplier' },
];

/** Raw Inventory → a lot: a stock-count difference, scrap, or a return to the supplier. Writes a ledger line with the reason. */
export function RawAdjustModal({ lot, onClose }: { lot: RawMaterialLot; onClose: () => void }) {
  const { run, busy } = useStore();
  const [kind, setKind] = useState<api.RawAdjustKind>('count_down');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(qty);
  const decrease = kind !== 'count_up';
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : decrease && n > lot.availableQty ? `Only ${fmtNum(lot.availableQty)} PCS are in stock` : null;
  const valid = n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.adjustRawStock(lot.id, kind, n, reason), { title: 'Stock adjusted', message: `${lot.id} · ${KINDS.find((k) => k.value === kind)?.label} · ${n} PCS` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={PackageX}
      title={`Adjust stock — ${lot.id}`}
      subtitle={`${lot.material} Ø${lot.od} mm · ${fmtNum(lot.availableQty)} PCS in stock`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            Save adjustment
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="What happened" required hint={KINDS.find((k) => k.value === kind)?.hint}>
          <select value={kind} onChange={(e) => setKind(e.target.value as api.RawAdjustKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="Reason" required full hint="Goes on the quantity ledger with your name and the time">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counted on 3 Nov — 4 bars short" />
        </Field>
      </div>
    </Modal>
  );
}

/** Finished Goods → goods a customer sent back. They leave "dispatched" and are available again. */
export function ReturnGoodsModal({ fg, onClose }: { fg: FinishedGood; onClose: () => void }) {
  const { run, busy } = useStore();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(qty);
  const err = qty === '' ? null : !(n > 0) || !Number.isInteger(n) ? 'Enter a whole number' : n > fg.dispatchedQty ? `Only ${fmtNum(fg.dispatchedQty)} PCS were dispatched` : null;
  const valid = n > 0 && Number.isInteger(n) && !err && reason.trim() !== '';
  const submit = async () => {
    if (await run(() => api.returnFinishedGoods(fg.id, n, reason), { title: 'Return recorded', message: `${fg.id} · ${n} PCS back in Finished Goods` })) onClose();
  };
  return (
    <Modal
      dialog
      open
      onClose={onClose}
      icon={Undo2}
      title={`Customer return — ${fg.id}`}
      subtitle={`${fmtNum(fg.dispatchedQty)} PCS dispatched so far`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>
            Record return
          </button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Quantity returned" required error={err}>
          <NumInput value={qty} onChange={setQty} suffix="PCS" bad={!!err} autoFocus />
        </Field>
        <Field label="Reason" required full hint="Goes on the quantity ledger with your name and the time">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer rejected — thread damage" />
        </Field>
      </div>
    </Modal>
  );
}
